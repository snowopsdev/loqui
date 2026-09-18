// Run after the sanitized repository is pushed, using an authenticated gh CLI.
const { execFileSync } = require("node:child_process");
const repo = require("../src/config/product.json").repository;
function api(endpoint, method = "GET", body) {
  const args = ["api", endpoint, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  return execFileSync("gh", args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8",
  });
}
const account = JSON.parse(api("user"));
if (account.login !== "snowopsdev")
  throw Error("Sign GitHub CLI into snowopsdev before configuring this repository");
api(`repos/${repo}`, "PATCH", {
  has_wiki: false,
  delete_branch_on_merge: true,
  security_and_analysis: {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
  },
});
for (const feature of [
  "vulnerability-alerts",
  "automated-security-fixes",
  "private-vulnerability-reporting",
  "immutable-releases",
])
  api(`repos/${repo}/${feature}`, "PUT");
api(`repos/${repo}/branches/main/protection`, "PUT", {
  required_status_checks: { strict: true, contexts: ["CI"] },
  enforce_admins: false,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    required_approving_review_count: 0,
  },
  restrictions: null,
  required_conversation_resolution: true,
  allow_force_pushes: false,
  allow_deletions: false,
});
api(`repos/${repo}/environments/release`, "PUT", {
  reviewers: [{ type: "User", id: account.id }],
  prevent_self_review: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
});
const policies = JSON.parse(api(`repos/${repo}/environments/release/deployment-branch-policies`));
if (!policies.branch_policies.some((p) => p.name === "v*" && p.type === "tag"))
  api(`repos/${repo}/environments/release/deployment-branch-policies`, "POST", {
    name: "v*",
    type: "tag",
  });
console.log(
  "Configured branch checks, dependency/secret protection, private reporting, immutable releases, and protected signing environment. Add Apple secrets securely before tagging."
);
