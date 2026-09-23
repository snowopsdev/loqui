// Review the offline plan first. --apply requires authenticated owner/admin access.
const { execFileSync } = require("node:child_process");
const product = require("../src/config/product.json");
const EXPECTED_REPOSITORY = "snowopsdev/loqui";
const EXPECTED_OWNER = "snowopsdev";
const RELEASE_SECRET_NAMES = [
  "MAC_CERTIFICATE_BASE64",
  "MAC_CERTIFICATE_PASSWORD",
  "MAC_SIGNING_IDENTITY",
  "APPLE_API_KEY_BASE64",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
];

function githubApi(endpoint, method = "GET", body) {
  const args = [
    "api",
    "--hostname",
    "github.com",
    endpoint,
    "--method",
    method,
    "--header",
    "Accept: application/vnd.github+json",
    "--header",
    "X-GitHub-Api-Version: 2022-11-28",
  ];
  if (body !== undefined) args.push("--input", "-");
  const output = execFileSync("gh", args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return output.trim() ? JSON.parse(output) : null;
}

function parseMode(args) {
  if (args.length === 0) return "dry-run";
  if (args.length !== 1 || !["--dry-run", "--apply", "--check", "--help"].includes(args[0]))
    throw Error(
      "Use no arguments, --dry-run, --apply, --check, or --help. Unknown or combined flags are refused."
    );
  return args[0].slice(2);
}

function configurationPlan(reviewerId = "<authenticated snowopsdev user ID>") {
  const root = `repos/${EXPECTED_REPOSITORY}`;
  return [
    {
      label: "Repository settings and secret protection",
      endpoint: root,
      method: "PATCH",
      body: {
        has_wiki: false,
        delete_branch_on_merge: true,
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
      },
    },
    ...[
      "vulnerability-alerts",
      "automated-security-fixes",
      "private-vulnerability-reporting",
      "immutable-releases",
    ].map((feature) => ({
      label: `Enable ${feature}`,
      endpoint: `${root}/${feature}`,
      method: "PUT",
    })),
    {
      label: "Read-only default Actions token",
      endpoint: `${root}/actions/permissions/workflow`,
      method: "PUT",
      body: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
    },
    {
      label: "Main branch protection",
      endpoint: `${root}/branches/main/protection`,
      method: "PUT",
      body: {
        required_status_checks: { strict: true, contexts: ["CI"] },
        enforce_admins: true,
        required_pull_request_reviews: {
          dismiss_stale_reviews: true,
          required_approving_review_count: 0,
          // Actor bypass lists are organization-only. This personal repository
          // enforces the rule for administrators; --check also rejects bypass actors.
        },
        restrictions: null,
        required_conversation_resolution: true,
        allow_force_pushes: false,
        allow_deletions: false,
      },
    },
    {
      label: "Protected release environment",
      endpoint: `${root}/environments/release`,
      method: "PUT",
      manualRequirement:
        "Disable administrator bypass in GitHub Settings > Environments > release; the REST write schema does not expose this setting",
      body: {
        reviewers: [{ type: "User", id: reviewerId }],
        prevent_self_review: false,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      },
    },
    {
      label: "Allow version tags in release environment",
      endpoint: `${root}/environments/release/deployment-branch-policies`,
      method: "POST",
      body: { name: "v*", type: "tag" },
      onlyIfMissing: true,
      removeOtherPolicies: true,
    },
  ];
}

function preflight(api, configuredRepository) {
  if (configuredRepository !== EXPECTED_REPOSITORY)
    throw Error(
      `Product repository must be ${EXPECTED_REPOSITORY}; refusing ${configuredRepository}`
    );
  const account = api("user");
  if (account?.login !== EXPECTED_OWNER || !Number.isSafeInteger(account.id) || account.id <= 0)
    throw Error(`Sign GitHub CLI into ${EXPECTED_OWNER} before applying settings`);
  const repo = api(`repos/${EXPECTED_REPOSITORY}`);
  if (
    repo?.full_name !== EXPECTED_REPOSITORY ||
    repo.owner?.login !== EXPECTED_OWNER ||
    repo.owner?.id !== account.id
  )
    throw Error("Repository identity does not match the expected owner and target");
  if (repo.fork !== false)
    throw Error("The public project must be an independent repository, not a fork");
  if (repo.permissions?.admin !== true)
    throw Error("Repository administrator permission is required");
  if (repo.archived || repo.disabled)
    throw Error("An archived or disabled repository cannot be configured");
  if (repo.default_branch !== "main")
    throw Error("The target repository must use main as its default branch");
  const branch = api(`repos/${EXPECTED_REPOSITORY}/branches/main`);
  if (branch?.name !== "main" || !branch.commit?.sha)
    throw Error("Push main before applying repository settings");
  return account;
}

function listCollection(api, endpoint, key) {
  const entries = [];
  for (let page = 1; page <= 100; page++) {
    const result = api(`${endpoint}?per_page=100&page=${page}`);
    if (!Array.isArray(result?.[key])) throw Error(`GitHub returned an invalid ${key} list`);
    entries.push(...result[key]);
    if (result[key].length < 100) return entries;
  }
  throw Error(`${key} pagination exceeded its safety limit`);
}

function isVersionTagPolicy(policy) {
  return policy.name === "v*" && policy.type === "tag";
}

function reconcileVersionTagPolicies(api, endpoint, log) {
  const policies = listCollection(api, endpoint, "branch_policies");
  const retained = policies.find(isVersionTagPolicy);
  const removed = policies.filter((policy) => policy !== retained);
  if (removed.some((policy) => !Number.isSafeInteger(policy.id) || policy.id <= 0))
    throw Error("Cannot remove a deployment policy without a valid policy ID");
  // Remove broader access before adding the narrowly scoped replacement.
  for (const policy of removed) api(`${endpoint}/${policy.id}`, "DELETE");
  if (!retained) api(endpoint, "POST", { name: "v*", type: "tag" });
  log(
    `Release tag policy: ${retained ? "already present" : "added"}; ${removed.length} other policies removed`
  );
}

function checkConfiguration(api, account, log) {
  const root = `repos/${EXPECTED_REPOSITORY}`;
  const read = (endpoint) => api(endpoint, "GET");
  const failures = [];
  const requireState = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const check = (label, verify) => {
    try {
      verify();
      log(`PASS ${label}`);
    } catch (error) {
      failures.push(label);
      log(`FAIL ${label}: ${error.message}`);
    }
  };
  check("Public repository and secret protection", () => {
    const repo = read(root);
    requireState(
      repo.private === false && repo.visibility === "public",
      "Repository is not public"
    );
    requireState(
      repo.has_wiki === false && repo.delete_branch_on_merge === true,
      "Repository settings differ from the plan"
    );
    for (const name of ["secret_scanning", "secret_scanning_push_protection"])
      requireState(
        repo.security_and_analysis?.[name]?.status === "enabled",
        `${name} is not enabled`
      );
  });
  check("Dependency alerts", () => {
    read(`${root}/vulnerability-alerts`);
  });
  for (const feature of [
    "automated-security-fixes",
    "private-vulnerability-reporting",
    "immutable-releases",
  ]) {
    check(feature, () => {
      const result = read(`${root}/${feature}`);
      requireState(result?.enabled === true, `${feature} is not enabled`);
      if (feature === "automated-security-fixes")
        requireState(result.paused === false, "Dependabot security updates are paused");
    });
  }
  check("Read-only default Actions token", () => {
    const permissions = read(`${root}/actions/permissions/workflow`);
    requireState(
      permissions.default_workflow_permissions === "read" &&
        permissions.can_approve_pull_request_reviews === false,
      "Actions permissions differ from the plan"
    );
  });
  check("Main branch protection including administrators", () => {
    const protection = read(`${root}/branches/main/protection`);
    const statuses = protection.required_status_checks;
    requireState(
      statuses?.strict === true && statuses.contexts?.includes("CI"),
      "Required up-to-date CI check is missing"
    );
    requireState(
      protection.enforce_admins?.enabled === true,
      "Administrators can bypass branch protection"
    );
    requireState(
      protection.allow_force_pushes?.enabled === false &&
        protection.allow_deletions?.enabled === false,
      "Force pushes or branch deletions are allowed"
    );
    requireState(
      protection.required_conversation_resolution?.enabled === true,
      "Resolved review conversations are not required"
    );
    requireState(
      protection.required_pull_request_reviews?.dismiss_stale_reviews === true,
      "Stale review dismissal is not enabled"
    );
    const bypass = protection.required_pull_request_reviews?.bypass_pull_request_allowances;
    requireState(
      !bypass ||
        Object.values(bypass).every((actors) => Array.isArray(actors) && actors.length === 0),
      "Pull request bypass actors are configured"
    );
  });
  check("Release environment approval and administrator bypass", () => {
    const environment = read(`${root}/environments/release`);
    requireState(
      environment.can_admins_bypass === false,
      "Disable administrator bypass in the release environment settings"
    );
    requireState(
      environment.deployment_branch_policy?.protected_branches === false &&
        environment.deployment_branch_policy?.custom_branch_policies === true,
      "Release environment is not limited to selected tags"
    );
    const review = environment.protection_rules?.find((rule) => rule.type === "required_reviewers");
    requireState(
      review?.reviewers?.length === 1 &&
        review.reviewers[0].type === "User" &&
        review.reviewers[0].reviewer?.id === account.id,
      "Release approval must require the repository owner"
    );
  });
  check("Release environment allows only version tags", () => {
    const policies = listCollection(
      read,
      `${root}/environments/release/deployment-branch-policies`,
      "branch_policies"
    );
    requireState(
      policies.length === 1 && isVersionTagPolicy(policies[0]),
      "Release environment must have exactly one v* tag policy and no branch policies"
    );
  });
  let signingSecretsReady = false;
  try {
    // This endpoint returns names and timestamps, never secret values.
    const secrets = listCollection(read, `${root}/environments/release/secrets`, "secrets");
    const names = new Set(secrets.map((secret) => secret.name));
    const missing = RELEASE_SECRET_NAMES.filter((name) => !names.has(name));
    signingSecretsReady = missing.length === 0;
    log(
      signingSecretsReady
        ? "PASS Release signing secret names"
        : `PENDING Release signing secret names: ${missing.join(", ")}. Source publication does not require signing credentials.`
    );
  } catch (error) {
    log(`PENDING Release signing secret names could not be verified: ${error.message}`);
  }
  if (failures.length)
    throw Error(
      `Repository verification failed (${failures.length} checks): ${failures.join("; ")}. No settings changed by --check.`
    );
  log("Repository protections verified. No settings changed by --check.");
  log(
    signingSecretsReady
      ? "Signing secret names are present. Secret values and signing validity require a successful release build."
      : "Source repository protection checks passed; signed releases remain pending credential setup."
  );
  return { sourceReady: true, signingSecretsReady };
}

function run(
  args,
  { api = githubApi, log = console.log, configuredRepository = product.repository } = {}
) {
  const mode = parseMode(args);
  if (mode === "help") {
    log(
      "Usage: node scripts/configure-github.cjs [--dry-run | --apply | --check]\nDefault: offline dry-run. --apply changes github.com/snowopsdev/loqui after owner/admin preflight. --check reads settings and release secret names without changing them."
    );
    return;
  }
  if (configuredRepository !== EXPECTED_REPOSITORY)
    throw Error(
      `Product repository must be ${EXPECTED_REPOSITORY}; refusing ${configuredRepository}`
    );
  if (mode === "dry-run") {
    log(
      `Offline dry-run for https://github.com/${EXPECTED_REPOSITORY}. No network requests or changes.`
    );
    log(
      "The listed branch protection and release environment policies are applied as shown. --apply removes other release deployment policies, retaining only v* tags. Review before applying."
    );
    log(JSON.stringify(configurationPlan(), null, 2));
    return;
  }
  let account;
  try {
    account = preflight(api, configuredRepository);
  } catch (error) {
    throw new Error(`Preflight failed; no settings changed: ${error.message}`, { cause: error });
  }
  if (mode === "check") {
    return checkConfiguration(api, account, log);
  }
  const completed = [];
  for (const step of configurationPlan(account.id)) {
    try {
      if (step.removeOtherPolicies) {
        reconcileVersionTagPolicies(api, step.endpoint, log);
        completed.push(step.label);
        continue;
      }
      api(step.endpoint, step.method, step.body);
      if (step.label === "Protected release environment") {
        const environment = api(step.endpoint, "GET");
        if (environment?.can_admins_bypass !== false)
          throw Error(
            "Administrator bypass is not confirmed disabled. Turn off 'Allow administrators to bypass configured protection rules' in GitHub Settings > Environments > release, then rerun --apply"
          );
      }
      completed.push(step.label);
      log(`${step.label}: applied`);
    } catch (error) {
      throw new Error(
        `${step.label} failed after ${completed.length} completed changes. Earlier changes and any partial changes in this step remain applied; inspect the reported step and rerun when resolved. ${error.message}`,
        { cause: error }
      );
    }
  }
  log(
    "Repository configuration completed. Add Apple signing secrets securely in the release environment, then run --check before tagging."
  );
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  run,
  parseMode,
  configurationPlan,
  preflight,
  checkConfiguration,
  RELEASE_SECRET_NAMES,
};
