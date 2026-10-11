/**
 * Search Console strings (queries, page URLs, titles, coverage text) are
 * untrusted data. They are copied through as text. They are never evaluated,
 * passed to a shell, compiled into a regular expression, or fetched.
 */

const MAX_DEPTH = 40;

export function asUntrustedText(value: string): string {
  return value.replace(/\0/g, "");
}

export function sanitizeUntrusted(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === "string") return asUntrustedText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "bigint") return asUntrustedText(value.toString());
  if (Array.isArray(value)) return value.map((item) => sanitizeUntrusted(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[asUntrustedText(key)] = sanitizeUntrusted(child, depth + 1);
    }
    return out;
  }
  return undefined;
}
