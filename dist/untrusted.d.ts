/**
 * Search Console strings (queries, page URLs, titles, coverage text) are
 * untrusted data. They are copied through as text. They are never evaluated,
 * passed to a shell, compiled into a regular expression, or fetched.
 */
export declare function asUntrustedText(value: string): string;
export declare function sanitizeUntrusted(value: unknown, depth?: number): unknown;
