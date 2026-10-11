/**
 * Host allowlist for the TradyList fork.
 *
 * Page URLs (Indexing API, sitemap feeds, URL Inspection) must be https and
 * the hostname must be exactly one of the configured hosts. Properties must
 * be `sc-domain:<host>` or an https URL-prefix property on those hosts.
 * Comparison is exact. Suffixes, prefixes, and lookalikes never match.
 */
export declare function getAllowedHosts(): string[];
/**
 * Accept an https page, sitemap, or inspection URL on an allowlisted host.
 * Throws before the caller is allowed to open a socket.
 */
export declare function assertAllowedPageUrl(raw: string): string;
/**
 * Accept a Search Console property: `sc-domain:<host>` or `https://<host>/...`
 * where host is exactly allowlisted.
 */
export declare function assertAllowedProperty(raw: string): string;
