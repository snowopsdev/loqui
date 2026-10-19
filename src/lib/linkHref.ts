const ALLOWED = new Set(["http:", "https:", "mailto:"]);
const BARE_DOMAIN = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+([/?#].*)?$/u;

// User-typed links in notes. Anything that is not web or mail is refused, so
// a pasted "javascript:" can never become a clickable href.
export function sanitizeLinkHref(input: string): string | null {
  // Strip C0 controls first: "java\tscript:" must not slip past the scheme check.
  const raw = input.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw)
    ? raw
    : BARE_DOMAIN.test(raw)
      ? `https://${raw}`
      : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ALLOWED.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
