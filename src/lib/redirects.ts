// Redirect targets that come from the URL (?next=...) or a form must stay on this site.

/**
 * Same-site relative path, or the fallback. Rejects "//host", "/\host"
 * (browsers treat a backslash like a slash), schemes, control characters
 * and whitespace, and the auth pages themselves.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof next !== "string" || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Backslashes, whitespace and control characters have no place in our paths.
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) return fallback;
  if (/^\/(login|signup)(\/|\?|$)/.test(next)) return fallback;
  return next;
}
