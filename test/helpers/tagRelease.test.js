const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");
const { run } = require("../../scripts/tag-release.cjs");

const version = "0.1.0-beta.2";
const tag = `v${version}`;
const sha = "c".repeat(40);
const api = "https://api.github.com/repos/snowopsdev/loqui";
const before = "b".repeat(40);
const env = {
  GITHUB_REPOSITORY: "snowopsdev/loqui",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
  GH_TOKEN: "fixture-token",
};

function fixture(t, { heading = `## ${version} - 2026-10-07`, lockVersion = version } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-tag-release-test-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ version }));
  fs.writeFileSync(
    path.join(cwd, "package-lock.json"),
    JSON.stringify({ version: lockVersion, packages: { "": { version: lockVersion } } })
  );
  fs.writeFileSync(path.join(cwd, "CHANGELOG.md"), `# Changelog\n\n${heading}\n\nEntry.\n`);
  return cwd;
}

// Records every request and command in one ordered list so tests can assert sequencing.
function github({
  tagExists = false,
  // "lightweight" | "annotated"; the commit the existing tag resolves to.
  tagKind = "lightweight",
  tagCommit = "d".repeat(40),
  createStatus = 201,
  tagStatus,
  dispatchError,
  previousVersion = "0.1.0-beta.1",
  eventName = "push",
} = {}) {
  const events = [],
    messages = [];
  const respond = (status, data) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => data,
  });
  return {
    events,
    messages,
    writes: () => events.filter((event) => event.method !== "GET"),
    options: {
      env: {
        ...env,
        GITHUB_EVENT_NAME: eventName,
        ...(eventName === "push" ? { BEFORE_SHA: before } : {}),
      },
      log: (message) => messages.push(message),
      fetchImpl: async (url, init = {}) => {
        const method = init.method || "GET";
        events.push({
          method,
          url,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
          auth: init.headers?.Authorization,
        });
        if (method === "GET" && url === api)
          return respond(200, { full_name: "snowopsdev/loqui", fork: false, archived: false });
        // package.json as main stood before the push: catches a version bump in any
        // pushed commit, not only the last one (rebase merges push several).
        if (method === "GET" && url === `${api}/contents/package.json?ref=${before}`)
          return respond(200, {
            encoding: "base64",
            content: Buffer.from(JSON.stringify({ version: previousVersion })).toString("base64"),
          });
        if (method === "GET" && url === `${api}/git/ref/tags/${tag}`) {
          if (tagStatus) return respond(tagStatus, { message: "fixture failure" });
          if (!tagExists) return respond(404, { message: "Not Found" });
          return tagKind === "annotated"
            ? respond(200, {
                ref: `refs/tags/${tag}`,
                object: { type: "tag", sha: "e".repeat(40) },
              })
            : respond(200, { ref: `refs/tags/${tag}`, object: { type: "commit", sha: tagCommit } });
        }
        if (method === "GET" && url === `${api}/git/tags/${"e".repeat(40)}`)
          return respond(200, { object: { type: "commit", sha: tagCommit } });
        if (method === "POST" && url === `${api}/git/refs`)
          return createStatus === 201
            ? respond(201, { ref: `refs/tags/${tag}`, object: { sha } })
            : respond(createStatus, { message: "Reference already exists" });
        throw Error(`Unexpected request: ${method} ${url}`);
      },
      command: (file, args) => {
        events.push({ method: "COMMAND", file, args });
        if (dispatchError) throw Error(dispatchError);
        return "";
      },
    },
  };
}

test("an unreleased or missing changelog heading skips without contacting GitHub", async (t) => {
  for (const heading of [
    `## ${version} (unreleased)`,
    `## ${version} - Unreleased`,
    `## ${version}0`,
    `### ${version}`,
    "## 0.1.0-beta.1 - 2026-10-07",
  ]) {
    const g = github();
    const result = await run({ ...g.options, cwd: fixture(t, { heading }) });
    assert.equal(result.state, "skipped");
    assert.equal(g.events.length, 0);
    assert.equal(g.messages.length, 1);
    assert.match(g.messages[0], /No release tag/);
  }
});

test("an existing tag is never moved or recreated, and no release is dispatched", async (t) => {
  const g = github({ tagExists: true });
  const result = await run({ ...g.options, cwd: fixture(t) });
  assert.equal(result.state, "exists");
  assert.deepEqual(g.writes(), []);
  assert.match(g.messages.join("\n"), new RegExp(`${tag} already exists`));
});

test("a released version with no tag creates the exact commit ref, then dispatches the release", async (t) => {
  const g = github();
  const result = await run({ ...g.options, cwd: fixture(t) });
  assert.deepEqual(result, { state: "created", tag, commit: sha });
  assert.ok(g.events.every((event) => !event.auth || event.auth === "Bearer fixture-token"));
  assert.deepEqual(g.writes(), [
    {
      method: "POST",
      url: `${api}/git/refs`,
      body: { ref: `refs/tags/${tag}`, sha },
      auth: "Bearer fixture-token",
    },
    {
      method: "COMMAND",
      file: "gh",
      args: [
        "workflow",
        "run",
        "release.yml",
        "--ref",
        tag,
        "-f",
        `tag=${tag}`,
        "--repo",
        "snowopsdev/loqui",
      ],
    },
  ]);
});

test("GitHub failures fail closed and never dispatch a release", async (t) => {
  for (const scenario of [
    { createStatus: 422 },
    { createStatus: 403 },
    { createStatus: 500 },
    { tagStatus: 401 },
    { tagStatus: 403 },
    { tagStatus: 500 },
  ]) {
    const g = github(scenario);
    await assert.rejects(run({ ...g.options, cwd: fixture(t) }), /HTTP (4|5)\d\d/);
    assert.ok(!g.events.some((event) => event.method === "COMMAND"));
    if (scenario.tagStatus) assert.deepEqual(g.writes(), []);
  }
  const g = github();
  await assert.rejects(
    run({
      ...g.options,
      cwd: fixture(t),
      fetchImpl: async () => {
        throw Error("fixture network failure");
      },
    }),
    /network failure/
  );
  assert.deepEqual(g.writes(), []);
});

test("a dispatch failure after tagging is reported with the manual retry command", async (t) => {
  const g = github({ dispatchError: "fixture dispatch failure" });
  await assert.rejects(
    run({ ...g.options, cwd: fixture(t) }),
    new RegExp(`Created ${tag}.*gh workflow run release\\.yml.*fixture dispatch failure`)
  );
});

test("wrong repository, branch, commit, token or version agreement is rejected before any request", async (t) => {
  for (const [override, error] of [
    [{ env: { ...env, GITHUB_REPOSITORY: "someone/loqui" } }, /snowopsdev\/loqui/],
    [{ env: { ...env, GITHUB_REF: "refs/heads/feature" } }, /main/],
    [{ env: { ...env, GITHUB_REF: `refs/tags/${tag}` } }, /main/],
    [{ env: { ...env, GITHUB_SHA: "c".repeat(39) } }, /commit SHA/],
    [{ env: { ...env, GITHUB_SHA: "C".repeat(40) } }, /commit SHA/],
    [{ env: { ...env, GH_TOKEN: "" } }, /GH_TOKEN/],
    [{ cwd: fixture(t, { lockVersion: "0.1.0-beta.1" }) }, /versions must match/],
  ]) {
    const g = github();
    await assert.rejects(run({ ...g.options, cwd: fixture(t), ...override }), error);
    assert.equal(g.events.length, 0);
  }
});

test("the tagging workflow runs on main with only the permissions it needs and pinned actions", () => {
  const read = (name) =>
    yaml.load(fs.readFileSync(path.join(__dirname, "../../.github/workflows", name), "utf8"));
  const workflow = read("tag-release.yml");
  const release = read("release.yml");
  assert.deepEqual(workflow.on.push, { branches: ["main"] });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const [job] = Object.values(workflow.jobs);
  assert.deepEqual(job.permissions, { contents: "write", actions: "write" });
  const pinned = new Set(release.jobs.validate.steps.map((step) => step.uses).filter(Boolean));
  for (const step of job.steps.filter((step) => step.uses)) assert.ok(pinned.has(step.uses));
  const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  const tagging = job.steps.find((step) => step.run === "node scripts/tag-release.cjs");
  assert.equal(tagging.env.GH_TOKEN, "${{ github.token }}");
});

test("a push that did not change the version never tags, even when the tag is missing", async (t) => {
  const cwd = fixture(t);
  const f = github({ previousVersion: version });
  const result = await run({ ...f.options, cwd });
  assert.equal(result.state, "skipped");
  assert.deepEqual(f.writes(), []);
  assert.ok(f.events.some((event) => event.url.endsWith(`ref=${before}`)));
  assert.match(f.messages.join("\n"), /did not change the version/);
});

test("a manual run tags main's commit for a released version without a version change", async (t) => {
  const cwd = fixture(t);
  const f = github({ previousVersion: version, eventName: "workflow_dispatch" });
  const result = await run({ ...f.options, cwd });
  assert.equal(result.state, "created");
  assert.equal(f.writes().length, 2);
});

test("a manual run starts the release for a tag already on main's commit, after a failed dispatch", async (t) => {
  for (const tagKind of ["lightweight", "annotated"]) {
    const g = github({ tagExists: true, tagKind, tagCommit: sha, eventName: "workflow_dispatch" });
    const result = await run({ ...g.options, cwd: fixture(t) });
    assert.deepEqual(result, { state: "dispatched", tag, commit: sha });
    assert.deepEqual(g.writes(), [
      {
        method: "COMMAND",
        file: "gh",
        args: [
          "workflow",
          "run",
          "release.yml",
          "--ref",
          tag,
          "-f",
          `tag=${tag}`,
          "--repo",
          "snowopsdev/loqui",
        ],
      },
    ]);
  }
});

test("a manual run refuses a tag that points at a different commit", async (t) => {
  const g = github({ tagExists: true, eventName: "workflow_dispatch" });
  await assert.rejects(run({ ...g.options, cwd: fixture(t) }), /points at .* not main's commit/);
  assert.deepEqual(g.writes(), []);
});

test("a push without a valid pre-push commit fails instead of guessing whether the version changed", async (t) => {
  for (const BEFORE_SHA of [undefined, "0".repeat(40), "not-a-sha"]) {
    const g = github();
    const options = { ...g.options, env: { ...g.options.env, BEFORE_SHA } };
    await assert.rejects(run({ ...options, cwd: fixture(t) }), /pre-push commit/);
    assert.deepEqual(g.writes(), []);
  }
});
