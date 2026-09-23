const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { run, RELEASE_SECRET_NAMES } = require("../../scripts/configure-github.cjs");

const root = "repos/snowopsdev/loqui";
function fixture({
  account = {},
  repository = {},
  existingTag = false,
  failEndpoint,
  policyPage2 = false,
  responses = {},
} = {}) {
  const calls = [],
    messages = [];
  const api = (endpoint, method = "GET", body) => {
    calls.push({ endpoint, method, body });
    if (endpoint === failEndpoint) throw Error("fixture API failure");
    if (method !== "GET") return null;
    if (Object.hasOwn(responses, endpoint)) return responses[endpoint];
    if (endpoint === "user") return { login: "snowopsdev", id: 42, ...account };
    if (endpoint === root)
      return {
        full_name: "snowopsdev/loqui",
        owner: { login: "snowopsdev", id: 42 },
        fork: false,
        permissions: { admin: true },
        default_branch: "main",
        private: false,
        visibility: "public",
        has_wiki: false,
        delete_branch_on_merge: true,
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
        ...repository,
      };
    if (endpoint === `${root}/branches/main`)
      return { name: "main", commit: { sha: "a".repeat(40) } };
    if (endpoint === `${root}/vulnerability-alerts`) return null;
    if (
      ["automated-security-fixes", "private-vulnerability-reporting", "immutable-releases"].some(
        (feature) => endpoint === `${root}/${feature}`
      )
    )
      return { enabled: true, paused: false };
    if (endpoint === `${root}/actions/permissions/workflow`)
      return { default_workflow_permissions: "read", can_approve_pull_request_reviews: false };
    if (endpoint === `${root}/branches/main/protection`)
      return {
        required_status_checks: { strict: true, contexts: ["CI"] },
        enforce_admins: { enabled: true },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        required_conversation_resolution: { enabled: true },
        required_pull_request_reviews: { dismiss_stale_reviews: true },
      };
    if (endpoint === `${root}/environments/release`)
      return {
        can_admins_bypass: false,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        protection_rules: [
          { type: "required_reviewers", reviewers: [{ type: "User", reviewer: { id: 42 } }] },
        ],
      };
    if (endpoint === `${root}/environments/release/secrets?per_page=100&page=1`)
      return { secrets: RELEASE_SECRET_NAMES.map((name) => ({ name })) };
    if (endpoint.includes("deployment-branch-policies?")) {
      if (policyPage2 && endpoint.endsWith("page=1"))
        return {
          branch_policies: Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            name: `feature-${i}`,
            type: "branch",
          })),
        };
      return {
        branch_policies: existingTag
          ? [{ id: 101, name: "v*", type: "tag" }]
          : [{ id: 101, name: "v*", type: "branch" }],
      };
    }
    throw Error(`Unexpected request: ${endpoint}`);
  };
  return { calls, messages, options: { api, log: (message) => messages.push(message) } };
}

test("default and explicit dry-run print the target and complete plan without any API calls", () => {
  for (const args of [[], ["--dry-run"], ["--help"]]) {
    const f = fixture();
    run(args, f.options);
    assert.equal(f.calls.length, 0);
    assert.match(f.messages.join("\n"), /snowopsdev\/loqui/);
    if (!args.includes("--help"))
      assert.match(f.messages.join("\n"), /default_workflow_permissions/);
  }
});

test("unknown and combined flags fail before contacting GitHub", () => {
  for (const args of [["--force"], ["--apply", "--dry-run"], ["--apply", "--apply"]]) {
    const f = fixture();
    assert.throws(() => run(args, f.options), /Unknown or combined flags/);
    assert.equal(f.calls.length, 0);
  }
});

test("identity, fork, admin and branch preflight failures cannot mutate settings", () => {
  for (const scenario of [
    { account: { login: "someone-else" } },
    { repository: { full_name: "snowopsdev/other" } },
    { repository: { owner: { login: "different-owner", id: 42 } } },
    { repository: { fork: true } },
    { repository: { permissions: { admin: false } } },
    { repository: { default_branch: "master" } },
    { repository: { archived: true } },
    { failEndpoint: `${root}/branches/main` },
  ]) {
    const f = fixture(scenario);
    assert.throws(() => run(["--apply"], f.options), /Preflight failed; no settings changed/);
    assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
  }
  const f = fixture();
  assert.throws(
    () => run(["--apply"], { ...f.options, configuredRepository: "snowopsdev/other" }),
    /Product repository must be/
  );
  assert.equal(f.calls.length, 0);
});

test("an apply failure identifies the failed step, stops later writes, and never announces success", () => {
  const f = fixture({ failEndpoint: `${root}/automated-security-fixes` });
  assert.throws(
    () => run(["--apply"], f.options),
    /Enable automated-security-fixes failed after 2 completed changes/
  );
  assert.equal(f.calls.at(-1).endpoint, `${root}/automated-security-fixes`);
  assert.doesNotMatch(f.messages.join("\n"), /configuration completed/);
});

test("apply checks the target first and writes the reviewed Actions permission policy", () => {
  const f = fixture();
  run(["--apply"], f.options);
  assert.deepEqual(
    f.calls.slice(0, 3).map((call) => call.method),
    ["GET", "GET", "GET"]
  );
  const permissions = f.calls.find((call) =>
    call.endpoint.endsWith("actions/permissions/workflow")
  );
  assert.deepEqual(permissions.body, {
    default_workflow_permissions: "read",
    can_approve_pull_request_reviews: false,
  });
  const protection = f.calls.find(
    (call) => call.method === "PUT" && call.endpoint.endsWith("branches/main/protection")
  );
  assert.equal(protection.body.enforce_admins, true);
  assert.equal(
    Object.hasOwn(protection.body.required_pull_request_reviews, "bypass_pull_request_allowances"),
    false
  );
  const environment = f.calls.find(
    (call) => call.method === "PUT" && call.endpoint.endsWith("environments/release")
  );
  assert.equal(environment.body.can_admins_bypass, undefined);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
  assert.match(f.messages.at(-1), /configuration completed/);
});

test("an existing version tag policy, including on a later page, is not recreated", () => {
  for (const policyPage2 of [false, true]) {
    const f = fixture({ existingTag: true, policyPage2 });
    run(["--apply"], f.options);
    assert.equal(f.calls.filter((call) => call.method === "POST").length, 0);
    assert.equal(f.calls.filter((call) => call.method === "DELETE").length, policyPage2 ? 100 : 0);
    assert.match(f.messages.join("\n"), /already present/);
    if (policyPage2) assert.ok(f.calls.some((call) => call.endpoint.endsWith("page=2")));
  }
});

test("applying the tag policy removes broader access before creating the version tag policy", () => {
  const f = fixture();
  run(["--apply"], f.options);
  const policyWrites = f.calls.filter(
    (call) => call.endpoint.includes("deployment-branch-policies") && call.method !== "GET"
  );
  assert.deepEqual(
    policyWrites.map((call) => call.method),
    ["DELETE", "POST"]
  );
  assert.equal(
    policyWrites[0].endpoint,
    `${root}/environments/release/deployment-branch-policies/101`
  );
});

test("an ignored environment bypass setting fails apply instead of claiming protection", () => {
  const f = fixture({
    responses: { [`${root}/environments/release`]: { can_admins_bypass: true } },
  });
  assert.throws(
    () => run(["--apply"], f.options),
    /Administrator bypass is not confirmed disabled/
  );
  assert.doesNotMatch(f.messages.join("\n"), /configuration completed/);
});

test("check verifies protection and environment secret names with GET requests only", () => {
  const f = fixture({ existingTag: true });
  const result = run(["--check"], f.options);
  assert.deepEqual(result, { sourceReady: true, signingSecretsReady: true });
  assert.ok(f.calls.every((call) => call.method === "GET"));
  assert.ok(f.calls.some((call) => call.endpoint.endsWith("secrets?per_page=100&page=1")));
  assert.ok(!f.calls.some((call) => call.endpoint.includes("/secrets/")));
  assert.match(
    f.messages.at(-1),
    /Secret values and signing validity require a successful release build/
  );
});

test("check reports missing secrets and protection drift together without mutation or secret data output", () => {
  const f = fixture({
    existingTag: true,
    responses: {
      [`${root}/branches/main/protection`]: { enforce_admins: { enabled: false } },
      [`${root}/environments/release`]: { can_admins_bypass: true },
      [`${root}/environments/release/secrets?per_page=100&page=1`]: {
        secrets: [{ name: "UNRELATED", value: "fixture-sensitive-do-not-print" }],
      },
    },
  });
  assert.throws(() => run(["--check"], f.options), /Repository verification failed \(2 checks\)/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
  const output = f.messages.join("\n");
  assert.match(output, /MAC_CERTIFICATE_BASE64/);
  assert.doesNotMatch(output, /fixture-sensitive-do-not-print|UNRELATED/);
});

test("check rejects extra deployment policies even when the allowed tag policy is present", () => {
  const f = fixture({ existingTag: true, policyPage2: true });
  assert.throws(() => run(["--check"], f.options), /Release environment allows only version tags/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("missing signing names leave source protections ready and releases explicitly pending", () => {
  const f = fixture({
    existingTag: true,
    responses: {
      [`${root}/environments/release/secrets?per_page=100&page=1`]: { secrets: [] },
    },
  });
  const result = run(["--check"], f.options);
  assert.deepEqual(result, { sourceReady: true, signingSecretsReady: false });
  assert.match(f.messages.join("\n"), /PENDING Release signing secret names/);
  assert.match(f.messages.at(-1), /signed releases remain pending/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("CLI usage errors exit nonzero without requiring an authenticated GitHub CLI", () => {
  const result = spawnSync(process.execPath, ["scripts/configure-github.cjs", "--force"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown or combined flags/);
});
