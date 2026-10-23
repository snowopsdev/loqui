// Shared with Task 11's testConfigFor: preserve environment casing/spacing,
// trim only the tenant, and refuse invalid targets. This is options projection,
// never a configuration fingerprint or verification authority.
export function normalizeRouteVerificationOptions(options = {}) {
  const cortiEnvironment = options.cortiEnvironment || "us";
  const cortiTenant = String(options.cortiTenant || "").trim() || "base";
  if (!["eu", "us"].includes(cortiEnvironment) || !/^[a-zA-Z0-9_-]+$/.test(cortiTenant))
    return null;
  return { cortiEnvironment, cortiTenant };
}
