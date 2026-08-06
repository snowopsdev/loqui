import {
  isCanonicalAppVersion as isCanonicalVersion,
  parseCanonicalAppVersion,
} from "../helpers/appVersion.js";

export function isCanonicalAppVersion(value: unknown): value is string {
  return isCanonicalVersion(value);
}

/** Returns negative when a < b, positive when a > b, and zero when equal. */
export function compareAppVersions(a: string, b: string): number {
  const left = parseCanonicalAppVersion(a);
  const right = parseCanonicalAppVersion(b);
  if (!left) return right ? -1 : 0;
  if (!right) return 1;
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}
