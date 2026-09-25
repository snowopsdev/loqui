const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const yaml = require("js-yaml");
const { validateRelease } = require("../../scripts/validate-release.cjs");
const { assembleRelease } = require("../../scripts/assemble-release.cjs");
const { run: draftRelease } = require("../../scripts/release-draft.cjs");

const version = "0.1.0-beta.1";
const tag = `v${version}`;
const commit = "a".repeat(40);
const env = {
  RELEASE_TAG: tag,
  RELEASE_COMMIT: commit,
  GITHUB_REF: `refs/tags/${tag}`,
  GITHUB_REPOSITORY: "snowopsdev/loqui",
  GH_TOKEN: "fixture-token",
};
const hash = (bytes) => crypto.createHash("sha512").update(bytes).digest("base64");
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-release-test-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const write = (name, content) => fs.writeFileSync(path.join(cwd, name), content);
  fs.mkdirSync(path.join(cwd, "release"));
  fs.mkdirSync(path.join(cwd, "licenses"));
  write("package.json", JSON.stringify({ version }));
  write("package-lock.json", JSON.stringify({ version, packages: { "": { version } } }));
  write("CHANGELOG.md", `# Changelog\n\n## ${version}\n\nRelease fixture.\n`);
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "licenses/test.txt"])
    write(name, "fixture license\n");
  write("runtime-assets.json", "{}\n");
  const names = {
    zip: `Loqui-${version}-mac-arm64.zip`,
    dmg: `Loqui-${version}-mac-arm64.dmg`,
    appImage: `Loqui-${version}-linux-x64.AppImage`,
    tar: `Loqui-${version}-linux-x64.tar.gz`,
  };
  for (const name of Object.values(names)) write(`release/${name}`, `fixture bytes: ${name}`);
  write(`release/${names.zip}.blockmap`, "fixture zip blockmap");
  write(
    "release/SBOM.cdx.json",
    JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", components: [] })
  );
  for (const [platform, list] of [
    ["mac", [names.zip, names.dmg]],
    ["linux", [names.appImage]],
  ]) {
    const entries = list.map((url) => {
      const bytes = fs.readFileSync(path.join(cwd, "release", url));
      return {
        url,
        sha512: hash(bytes),
        size: bytes.length,
        ...(url === names.appImage ? { blockMapSize: 4 } : {}),
      };
    });
    write(
      `release/beta-${platform}.yml`,
      yaml.dump({ version, files: entries, path: entries[0].url, sha512: entries[0].sha512 })
    );
  }
  const updateMetadata = (platform, change) => {
    const name = path.join(cwd, "release", `beta-${platform}.yml`);
    const data = yaml.load(fs.readFileSync(name, "utf8"));
    change(data);
    fs.writeFileSync(name, yaml.dump(data));
  };
  return {
    cwd,
    write,
    names,
    updateMetadata,
    assemble: () => assembleRelease({ cwd, env, git: () => commit }),
  };
}

function gitFixture({ ancestor = true, taggedCommit = commit } = {}) {
  const calls = [];
  return {
    calls,
    git(args) {
      calls.push(args);
      if (args[0] === "merge-base" && !ancestor) throw Error("Not on main");
      if (args[0] === "rev-parse") return args[1] === "HEAD" ? commit : taggedCommit;
      return "";
    },
  };
}

test("release validation rejects unreleased and prefix-only changelog entries before Git/network work", (t) => {
  const f = fixture(t);
  for (const heading of [`## ${version} (unreleased)`, `## ${version}0`, `### ${version}`]) {
    f.write("CHANGELOG.md", `${heading}\nentry\n`);
    const git = gitFixture();
    assert.throws(
      () => validateRelease({ cwd: f.cwd, env, git: git.git }),
      /changelog|unreleased/i
    );
    assert.equal(git.calls.length, 0);
  }
});

test("release validation enforces tag/version agreement, main ancestry and checked-out tag", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      validateRelease({
        cwd: f.cwd,
        env: { ...env, RELEASE_TAG: "v0.1.0-beta.2" },
        git: gitFixture().git,
      }),
    /ref|match/
  );
  f.write("package-lock.json", JSON.stringify({ version: "9.0.0", packages: { "": { version } } }));
  assert.throws(
    () => validateRelease({ cwd: f.cwd, env, git: gitFixture().git }),
    /versions must match/
  );
  f.write("package-lock.json", JSON.stringify({ version, packages: { "": { version } } }));
  assert.throws(
    () => validateRelease({ cwd: f.cwd, env, git: gitFixture({ ancestor: false }).git }),
    /Not on main/
  );
  assert.throws(
    () =>
      validateRelease({ cwd: f.cwd, env, git: gitFixture({ taggedCommit: "b".repeat(40) }).git }),
    /not the release tag/
  );
  assert.deepEqual(validateRelease({ cwd: f.cwd, env, git: gitFixture().git }), {
    tag,
    version,
    commit,
  });
  f.write("CHANGELOG.md", `## ${version} - 2026-09-23\nentry\n`);
  assert.equal(validateRelease({ cwd: f.cwd, env, git: gitFixture().git }).version, version);
});

test("assembly rejects missing platform and updater artifacts without producing a checksum manifest", (t) => {
  for (const missing of ["zip", "appImage", "tar", "blockmap", "metadata"]) {
    const f = fixture(t);
    const file =
      missing === "blockmap"
        ? `${f.names.zip}.blockmap`
        : missing === "metadata"
          ? "beta-linux.yml"
          : f.names[missing];
    fs.unlinkSync(path.join(f.cwd, "release", file));
    assert.throws(f.assemble, /Incomplete release/);
    assert.equal(fs.existsSync(path.join(f.cwd, "release", "SHA256SUMS")), false);
  }
});

test("assembly rejects incomplete updater lists, wrong channel/version, traversal and missing embedded blockmap metadata", (t) => {
  for (const mutate of [
    (f) =>
      f.updateMetadata("mac", (data) => {
        data.files = [];
      }),
    (f) =>
      f.updateMetadata("linux", (data) => {
        data.version = "0.1.0";
      }),
    (f) =>
      f.updateMetadata("mac", (data) => {
        data.path = f.names.dmg;
      }),
    (f) =>
      f.updateMetadata("mac", (data) => {
        data.files[0].url = "../private";
      }),
    (f) =>
      f.updateMetadata("mac", (data) => {
        data.files[1] = data.files[0];
      }),
    (f) =>
      f.updateMetadata("linux", (data) => {
        delete data.files[0].blockMapSize;
      }),
    (f) => f.write("release/latest-mac.yml", "version: 0.1.0\n"),
  ]) {
    const f = fixture(t);
    mutate(f);
    assert.throws(f.assemble, /Updater|updater|channel|blockmap/);
    assert.equal(fs.existsSync(path.join(f.cwd, "release", "SHA256SUMS")), false);
  }
});

test("assembly rejects changed ZIP/Linux bytes and bad primary checksums rather than silently repairing them", (t) => {
  for (const target of ["zip", "appImage", "primary"]) {
    const f = fixture(t);
    if (target === "primary")
      f.updateMetadata("mac", (data) => {
        data.sha512 = "wrong";
      });
    else f.write(`release/${f.names[target]}`, "corrupt archive");
    assert.throws(f.assemble, /integrity mismatch|primary checksum mismatch/);
  }
});

test("complete assembly refreshes only post-stapling DMG metadata and checksums every final asset", (t) => {
  const f = fixture(t);
  f.write(`release/${f.names.dmg}`, "signed and stapled DMG bytes");
  const result = f.assemble();
  assert.equal(result.channel, "beta");
  const metadata = yaml.load(fs.readFileSync(path.join(f.cwd, "release/beta-mac.yml"), "utf8"));
  assert.equal(
    metadata.files.find((entry) => entry.url === f.names.dmg).sha512,
    hash("signed and stapled DMG bytes")
  );
  const sums = fs.readFileSync(path.join(f.cwd, "release/SHA256SUMS"), "utf8").trim().split("\n");
  assert.equal(sums.length, fs.readdirSync(path.join(f.cwd, "release")).length - 1);
  for (const line of sums) {
    const [expected, name] = line.split("  ");
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(f.cwd, "release", name)))
      .digest("hex");
    assert.equal(actual, expected);
  }
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.cwd, "release/build-provenance.json"))).commit,
    commit
  );
});

function draftFixture(
  f,
  {
    release = null,
    releaseStatus,
    repositoryStatus = 200,
    immutable = true,
    remoteCommit = commit,
    sequence,
  } = {}
) {
  const writes = [],
    requests = [];
  let reads = 0;
  const active = {
    draft: true,
    published_at: null,
    tag_name: tag,
    target_commitish: commit,
    prerelease: true,
    assets: [],
  };
  return {
    writes,
    requests,
    active,
    options: {
      cwd: f?.cwd,
      env,
      fetchImpl: async (url) => {
        requests.push(url);
        let status = 200,
          data;
        if (url.endsWith(`/repos/${env.GITHUB_REPOSITORY}`)) {
          status = repositoryStatus;
          data = { full_name: env.GITHUB_REPOSITORY, fork: false, archived: false };
        } else if (url.endsWith("/immutable-releases")) data = { enabled: immutable };
        else {
          const state = sequence ? sequence[reads++] : release;
          data =
            state === "draft"
              ? active
              : state === "published"
                ? { ...active, draft: false, published_at: "2026-09-23" }
                : state;
          status = releaseStatus ?? (data === null ? 404 : 200);
        }
        return { status, ok: status >= 200 && status < 300, json: async () => data };
      },
      command: (file, args) => {
        if (file === "git") return `${remoteCommit}\trefs/tags/${tag}\n`;
        writes.push({ file, args });
        return "";
      },
    },
  };
}

test("GitHub authentication, unavailable repository and server failures cannot become a missing release", async () => {
  for (const errors of [
    { repositoryStatus: 404 },
    { releaseStatus: 401 },
    { releaseStatus: 403 },
    { releaseStatus: 500 },
    { releaseStatus: 200, release: null },
  ]) {
    const f = draftFixture(null, errors);
    await assert.rejects(
      draftRelease("assemble", f.options),
      /release-state check failed|invalid release-state response/
    );
    assert.equal(f.writes.length, 0);
  }
  const f = draftFixture();
  await assert.rejects(
    draftRelease("check", {
      ...f.options,
      fetchImpl: async () => {
        throw Error("fixture network failure");
      },
    }),
    /network failure/
  );
  assert.equal(f.writes.length, 0);
});

test("published releases and different-commit drafts are rejected before asset mutation", async () => {
  for (const release of [
    "published",
    {
      draft: true,
      published_at: null,
      tag_name: tag,
      target_commitish: "b".repeat(40),
      prerelease: true,
    },
  ]) {
    const f = draftFixture(null, { release });
    await assert.rejects(draftRelease("assemble", f.options), /immutable|same tag and commit/);
    assert.equal(f.writes.length, 0);
  }
});

test("new releases are always drafts, with immutable protection and tag identity required", async (t) => {
  const source = fixture(t);
  source.assemble();
  for (const settings of [{ immutable: false }, { remoteCommit: "b".repeat(40) }]) {
    const f = draftFixture(source, settings);
    await assert.rejects(
      draftRelease("assemble", f.options),
      /immutable releases|tag no longer matches/
    );
    assert.equal(f.writes.length, 0);
  }
  const f = draftFixture(source);
  await draftRelease("assemble", f.options);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].args.slice(0, 3), ["release", "create", tag]);
  assert.ok(f.writes[0].args.includes("--draft"));
  assert.ok(f.writes[0].args.includes("--prerelease"));
});

test("draft retries verify unchanged assets and stop if publication happens before upload", async (t) => {
  const source = fixture(t);
  source.assemble();
  const race = draftFixture(source, { sequence: ["draft", "published"] });
  await assert.rejects(draftRelease("assemble", race.options), /immutable/);
  assert.equal(race.writes.length, 0);
  source.write(`release/${source.names.zip}`, "changed after assembly");
  const corrupt = draftFixture(source, { release: "draft" });
  await assert.rejects(draftRelease("assemble", corrupt.options), /changed after assembly/);
  assert.equal(corrupt.writes.length, 0);
});

test("same-commit draft retries upload only assembled assets, and reject stale draft assets", async (t) => {
  const source = fixture(t);
  source.assemble();
  const f = draftFixture(source, { release: "draft" });
  await draftRelease("assemble", f.options);
  assert.equal(f.writes.length, fs.readdirSync(path.join(source.cwd, "release")).length);
  assert.ok(f.writes.every(({ args }) => args[1] === "upload" && args.includes("--clobber")));
  const stale = draftFixture(source, { release: "draft" });
  stale.active.assets = [{ name: "obsolete.zip" }];
  await assert.rejects(draftRelease("assemble", stale.options), /unexpected assets/);
  assert.equal(stale.writes.length, 0);
});

test("workflow draft assembly requires successful validation, both platform builds and signing", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, "../../.github/workflows/release.yml"), "utf8")
  );
  assert.deepEqual(workflow.jobs.draft.needs, ["validate", "build", "sign"]);
  assert.equal(workflow.jobs.draft.if, undefined);
  assert.equal(workflow.jobs.build.uses, "./.github/workflows/platform.yml");
  assert.deepEqual(workflow.jobs.sign.needs, ["validate", "build"]);
  for (const job of Object.values(workflow.jobs)) assert.equal(job["continue-on-error"], undefined);
  const steps = workflow.jobs.draft.steps;
  assert.ok(
    steps.findIndex((step) => step.run === "node scripts/assemble-release.cjs") <
      steps.findIndex((step) => step.run === "node scripts/release-draft.cjs assemble")
  );
});
