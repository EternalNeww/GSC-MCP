export type ScopeTier = "readonly" | "submit";
export declare const WEBMASTERS_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Required only by sitemaps.submit. webmasters.readonly cannot call it. */
export declare const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
/** Required only by Indexing API urlNotifications.publish (URL_UPDATED). */
export declare const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
/**
 * Default is readonly: webmasters.readonly only.
 * GSC_SCOPES=submit (alias: full) adds the Indexing API scope for URL_UPDATED
 * submissions and the webmasters scope because sitemaps.submit rejects the
 * readonly scope. See SECURITY-FORK.md.
 */
export declare function getScopeTier(): ScopeTier;
export declare function scopesForTier(tier: ScopeTier): string[];
export declare function clearCachedToken(): void;
export declare function tokenPath(): string;
export declare function loadCachedToken(): any | null;
export declare function saveCachedToken(token: any): void;
interface OAuthConfig {
    clientId: string;
    clientSecret: string;
}
export declare function getOAuthConfig(): OAuthConfig;
/**
 * Runs the full OAuth2 flow: open browser, catch redirect, exchange code, cache token.
 * Returns an authenticated OAuth2 client.
 */
export declare function authenticateWithOAuth(): Promise<any>;
export {};
