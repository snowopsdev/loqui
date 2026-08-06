const crypto = require("crypto");

const { isValidPolicyShape } = require("./policyValidation");
const { withPolicyRequestHeaders } = require("./policyRequestHeaders");
const { readWorkspacePolicyCache, writeWorkspacePolicyCache } = require("./workspacePolicyCache");

function authError(message, code = "AUTH_CONTEXT_CHANGED") {
  return Object.assign(new Error(message), { code });
}

function normalizeAccountId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAuthHeaders(value, token) {
  const headers = {};
  if (value && typeof value === "object") {
    if (typeof value.Authorization === "string" && value.Authorization) {
      headers.Authorization = value.Authorization;
    }
    if (typeof value.Cookie === "string" && value.Cookie) headers.Cookie = value.Cookie;
  }
  if (!headers.Authorization && !headers.Cookie && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validatePolicyData(value) {
  if (!value || typeof value !== "object" || typeof value.managed !== "boolean") return false;
  if (value.managed) {
    return isValidPolicyShape(value.policy) && validTimestamp(value.policyUpdatedAt);
  }
  return (
    (value.policy === null || value.policy === undefined || isValidPolicyShape(value.policy)) &&
    value.policyUpdatedAt == null
  );
}

function createWorkspacePolicyManager({
  cachePath,
  getApiUrl,
  getAppVersion,
  proxyFetch,
  tokenStore,
  broadcast,
  logger,
  requestTimeoutMs = 10_000,
  successfulRefreshMs = 5 * 60 * 1000,
  minimumAttemptIntervalMs = 5_000,
  now = Date.now,
}) {
  const snapshots = new Map();
  const inFlight = new Map();
  const successfulRefreshes = new Map();
  const lastAttempts = new Map();
  const lastRecoveryAttempts = new Map();
  let revision = 0;

  function captureIdentity(request = {}) {
    const tokenState = tokenStore.getState();
    if (
      request.expectedAuthGeneration !== undefined &&
      (!Number.isSafeInteger(request.expectedAuthGeneration) ||
        request.expectedAuthGeneration < 0 ||
        request.expectedAuthGeneration !== tokenState.generation)
    ) {
      throw authError("Authentication context changed before policy request");
    }
    const apiUrl = getApiUrl();
    if (!apiUrl) throw new Error("OpenWhispr API URL not configured");
    const authHeaders = normalizeAuthHeaders(request.authHeaders, tokenState?.token);
    if (!Object.keys(authHeaders).length) {
      throw authError("Authenticated policy request has no credential", "AUTH_CONTEXT_UNVALIDATED");
    }
    const apiOrigin = new URL(apiUrl).origin;
    const accountId = normalizeAccountId(request.accountId);
    const credentialMaterial = JSON.stringify(
      Object.entries(authHeaders).sort(([left], [right]) => left.localeCompare(right))
    );
    const credentialHash = crypto.createHash("sha256").update(credentialMaterial).digest("hex");
    return {
      accountId,
      apiUrl: apiUrl.replace(/\/+$/, ""),
      apiOrigin,
      credentialHash,
      authHeaders,
      token: tokenState?.token ?? null,
      authGeneration: tokenState.generation,
    };
  }

  function assertIdentityCurrent(identity) {
    const current = tokenStore.getState();
    if (
      current?.generation !== identity.authGeneration ||
      (identity.token ? current?.token !== identity.token : Boolean(current?.token))
    ) {
      throw authError("Authentication context changed during policy request");
    }
  }

  function identityKey(identity) {
    return `${identity.apiOrigin}\n${identity.credentialHash}`;
  }

  function cacheIdentity(identity) {
    return {
      apiOrigin: identity.apiOrigin,
      credentialHash: identity.credentialHash,
      accountId: identity.accountId,
    };
  }

  function cachedData(identity) {
    const cached = readWorkspacePolicyCache(cachePath, cacheIdentity(identity));
    return validatePolicyData(cached) ? cached : null;
  }

  function publicSnapshot(identity, data, status, snapshotRevision) {
    return {
      success: true,
      status,
      revision: snapshotRevision,
      accountId: identity.accountId,
      authGeneration: identity.authGeneration,
      managed: data.managed,
      policy: data.policy ?? null,
      policyUpdatedAt: data.policyUpdatedAt ?? null,
      endpointSupported: data.endpointSupported !== false,
    };
  }

  function accept(identity, data, status) {
    const key = identityKey(identity);
    let current = snapshots.get(key);
    if (!current) {
      const cached = cachedData(identity);
      if (cached) {
        current = { data: cached, revision };
        snapshots.set(key, current);
      }
    }
    if (
      current?.data.managed &&
      data.managed &&
      validTimestamp(current.data.policyUpdatedAt) &&
      validTimestamp(data.policyUpdatedAt) &&
      Date.parse(data.policyUpdatedAt) < Date.parse(current.data.policyUpdatedAt)
    ) {
      return publicSnapshot(identity, current.data, "current", current.revision);
    }

    revision += 1;
    const next = { data, revision };
    snapshots.set(key, next);
    try {
      writeWorkspacePolicyCache(cachePath, cacheIdentity(identity), data);
    } catch (error) {
      logger?.error?.("Policy cache write failed", error);
    }
    const result = publicSnapshot(identity, data, status, revision);
    broadcast?.(result);
    return result;
  }

  function acceptSuccessfulResponse(identity, data, status) {
    const result = accept(identity, data, status);
    if (result.status !== "current") successfulRefreshes.set(identityKey(identity), now());
    return result;
  }

  async function fetchPolicy(identity) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await proxyFetch(`${identity.apiUrl}/api/workspace-policy`, {
          method: "GET",
          headers: withPolicyRequestHeaders(identity.authHeaders, getAppVersion()),
          signal: controller.signal,
        });
        assertIdentityCurrent(identity);

        if (response.status === 404 || response.status === 501) {
          const current = snapshots.get(identityKey(identity));
          if (current?.data.managed) {
            return publicSnapshot(identity, current.data, "cached", current.revision);
          }
          const cached = cachedData(identity);
          if (cached?.managed) return accept(identity, cached, "cached");
          return acceptSuccessfulResponse(
            identity,
            { managed: false, policy: null, policyUpdatedAt: null, endpointSupported: false },
            "unsupported"
          );
        }
        if (!response.ok) {
          const error = new Error(`API error: ${response.status}`);
          error.status = response.status;
          throw error;
        }

        const json = await response.json();
        assertIdentityCurrent(identity);
        const data = {
          ...json?.data,
          endpointSupported: true,
        };
        if (!validatePolicyData(data)) throw new Error("Malformed policy response");
        return acceptSuccessfulResponse(identity, data, "network");
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      try {
        assertIdentityCurrent(identity);
      } catch (authContextError) {
        return {
          success: false,
          status: "error",
          code: authContextError.code,
          error: authContextError.message,
        };
      }

      const cached = cachedData(identity);
      if (cached) {
        const key = identityKey(identity);
        const current = snapshots.get(key);
        if (current) return publicSnapshot(identity, current.data, "cached", current.revision);
        return accept(identity, cached, "cached");
      }
      logger?.warn?.("Workspace policy unavailable", { error: error?.message });
      return {
        success: false,
        status: "error",
        code: "POLICY_UNAVAILABLE",
        error: error?.message || String(error),
      };
    }
  }

  async function getPolicy(request) {
    let identity;
    try {
      identity = captureIdentity(request ?? {});
    } catch (error) {
      return {
        success: false,
        status: "error",
        code: error.code || "POLICY_UNAVAILABLE",
        error: error.message,
      };
    }
    const key = identityKey(identity);
    const current = snapshots.get(key);
    const lastSuccessfulRefresh = successfulRefreshes.get(key);
    const successfulRefreshAge =
      lastSuccessfulRefresh === undefined ? null : now() - lastSuccessfulRefresh;
    if (
      current &&
      successfulRefreshAge !== null &&
      successfulRefreshAge >= 0 &&
      successfulRefreshAge < successfulRefreshMs
    ) {
      return publicSnapshot(identity, current.data, "current", current.revision);
    }
    if (inFlight.has(key)) {
      return inFlight.get(key).then((result) =>
        result.success
          ? {
              ...result,
              accountId: identity.accountId,
              authGeneration: identity.authGeneration,
            }
          : result
      );
    }
    const lastAttempt = lastAttempts.get(key);
    const attemptAge = lastAttempt === undefined ? null : now() - lastAttempt;
    const lastRecoveryAttempt = lastRecoveryAttempts.get(key);
    const recoveryAttemptAge =
      lastRecoveryAttempt === undefined ? null : now() - lastRecoveryAttempt;
    const attemptIsThrottled =
      request?.reason === "recovery"
        ? recoveryAttemptAge !== null &&
          recoveryAttemptAge >= 0 &&
          recoveryAttemptAge < minimumAttemptIntervalMs
        : attemptAge !== null && attemptAge >= 0 && attemptAge < minimumAttemptIntervalMs;
    if (attemptIsThrottled) {
      if (current) return publicSnapshot(identity, current.data, "cached", current.revision);
      const cached = cachedData(identity);
      if (cached) return accept(identity, cached, "cached");
      return {
        success: false,
        status: "error",
        code: "POLICY_RETRY_THROTTLED",
        error: "Workspace policy refresh is rate limited",
      };
    }
    const attemptStartedAt = now();
    lastAttempts.set(key, attemptStartedAt);
    if (request?.reason === "recovery") lastRecoveryAttempts.set(key, attemptStartedAt);
    const pending = fetchPolicy(identity).finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return pending;
  }

  return { getPolicy };
}

module.exports = { createWorkspacePolicyManager };
