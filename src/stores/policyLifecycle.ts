export interface PolicySnapshotIdentity {
  accountId: string;
  authGeneration: number;
  revision: number;
}

export const POLICY_SUCCESS_REFRESH_MS = 5 * 60 * 1000;

interface ResolvedPolicyRefreshState {
  status: "idle" | "loading" | "managed" | "unmanaged" | "error";
  accountId: string | null;
  authGeneration: number | null;
}

export function resolvedPolicyRefreshIdentity(
  state: ResolvedPolicyRefreshState
): Omit<PolicySnapshotIdentity, "revision"> | null {
  if (
    (state.status !== "managed" && state.status !== "unmanaged" && state.status !== "error") ||
    !state.accountId ||
    state.authGeneration == null
  ) {
    return null;
  }
  return { accountId: state.accountId, authGeneration: state.authGeneration };
}

export function shouldAcceptPolicySnapshot(
  current: PolicySnapshotIdentity,
  incoming: PolicySnapshotIdentity
): boolean {
  return (
    incoming.accountId === current.accountId &&
    incoming.authGeneration === current.authGeneration &&
    incoming.revision >= current.revision
  );
}
