import { getSearchConsoleClient, getConfig, getAuthMode } from "../auth.js";
import { assertAllowedPageUrl, assertAllowedProperty } from "../allowlist.js";
import { getScopeTier } from "../oauth.js";
import { reserveUrlSubmits } from "../submission-cap.js";
import { asUntrustedText } from "../untrusted.js";

interface SitemapSubmitResult {
  siteUrl: string;
  sitemapUrl: string;
  success: boolean;
  error: string | null;
  note?: string;
}

interface SitemapListResult {
  siteUrl: string;
  sitemaps: Array<{
    path: string;
    lastSubmitted: string | null;
    isPending: boolean;
    lastDownloaded: string | null;
    warnings: number;
    errors: number;
    contents: Array<{ type: string; submitted: number; indexed: number }>;
  }>;
  note?: string;
}

/**
 * The Sitemaps API accepts sc-domain: properties directly, so the configured
 * property is always tried as-is first (#7). The URL-prefix conversions stay
 * on as fallbacks for accounts where the permission actually lives on a
 * matching URL-prefix property rather than the domain property.
 */
function sitemapPropertyCandidates(siteUrl: string): string[] {
  if (siteUrl.startsWith("sc-domain:")) {
    const domain = siteUrl.replace("sc-domain:", "");
    return [siteUrl, `https://${domain}/`, `https://www.${domain}/`];
  }
  return [siteUrl];
}

function allowedSitemapProperties(siteUrl: string): string[] {
  const allowed: string[] = [];
  for (const candidate of sitemapPropertyCandidates(siteUrl)) {
    try {
      allowed.push(assertAllowedProperty(candidate));
    } catch {
      // A domain-property fallback such as www.* is skipped when that host
      // is outside the allowlist. It is never sent to the API.
    }
  }
  return allowed;
}

function defaultSitemapUrl(property: string): string {
  if (property.startsWith("sc-domain:")) {
    return `https://${property.replace("sc-domain:", "")}/sitemap.xml`;
  }
  return `${property}sitemap.xml`;
}

function fallbackNote(used: string, configured: string): string | undefined {
  if (used === configured) return undefined;
  return (
    `The configured property (${configured}) rejected the call, so the ` +
    `URL-prefix property (${used}) was used instead. The results belong to ` +
    `that property, which may differ from the domain property's own sitemap list.`
  );
}

function permissionHint(candidates: string[]): string {
  return (
    ` Tried: ${candidates.join(", ")}. Check that the authenticated account ` +
    `has sitemap permission on the property in Search Console.`
  );
}

export async function submitSitemap(sitemapUrl?: string): Promise<SitemapSubmitResult> {
  const explicitFeed = sitemapUrl !== undefined ? assertAllowedPageUrl(sitemapUrl) : undefined;
  const { siteUrl: configSiteUrl } = getConfig();
  const candidates = allowedSitemapProperties(configSiteUrl);
  if (candidates.length === 0) {
    throw new Error(
      `Rejected property: "${configSiteUrl}" has no allowlisted sitemap property. No request was sent.`
    );
  }

  const feedpath = explicitFeed || assertAllowedPageUrl(defaultSitemapUrl(configSiteUrl));

  if (getAuthMode() === "oauth" && getScopeTier() === "readonly") {
    return {
      siteUrl: configSiteUrl,
      sitemapUrl: feedpath,
      success: false,
      error:
        "Sitemap submission needs GSC_SCOPES=submit. sitemaps.submit is rejected with webmasters.readonly, " +
        "so the webmasters scope is requested only on that tier. Re-authenticate with GSC_SCOPES=submit. No request was sent.",
    };
  }

  reserveUrlSubmits(1);
  const client = await getSearchConsoleClient();

  let firstError: any = null;
  for (const property of candidates) {
    try {
      await client.sitemaps.submit({ siteUrl: property, feedpath });
      const note = fallbackNote(property, configSiteUrl);
      return {
        siteUrl: property,
        sitemapUrl: feedpath,
        success: true,
        error: null,
        ...(note && { note }),
      };
    } catch (err: any) {
      if (!firstError) firstError = err;
    }
  }

  return {
    siteUrl: configSiteUrl,
    sitemapUrl: feedpath,
    success: false,
    error: (firstError?.message || String(firstError)) + permissionHint(candidates),
  };
}

export async function listSitemaps(): Promise<SitemapListResult> {
  const { siteUrl: configSiteUrl } = getConfig();
  const candidates = allowedSitemapProperties(configSiteUrl);
  if (candidates.length === 0) {
    throw new Error(
      `Rejected property: "${configSiteUrl}" has no allowlisted sitemap property. No request was sent.`
    );
  }
  const client = await getSearchConsoleClient();

  let firstError: any = null;
  for (const property of candidates) {
    try {
      const response = await client.sitemaps.list({ siteUrl: property });

      const sitemaps = (response.data.sitemap || []).map((s) => ({
        path: asUntrustedText(s.path || ""),
        lastSubmitted: s.lastSubmitted ? asUntrustedText(s.lastSubmitted) : null,
        isPending: s.isPending || false,
        lastDownloaded: s.lastDownloaded ? asUntrustedText(s.lastDownloaded) : null,
        warnings: Number(s.warnings) || 0,
        errors: Number(s.errors) || 0,
        contents: (s.contents || []).map((c) => ({
          type: asUntrustedText(c.type || "unknown"),
          submitted: Number(c.submitted) || 0,
          indexed: Number(c.indexed) || 0,
        })),
      }));

      const note = fallbackNote(property, configSiteUrl);
      return {
        siteUrl: property,
        sitemaps,
        ...(note && { note }),
      };
    } catch (err: any) {
      if (!firstError) firstError = err;
    }
  }

  throw new Error((firstError?.message || String(firstError)) + permissionHint(candidates));
}
