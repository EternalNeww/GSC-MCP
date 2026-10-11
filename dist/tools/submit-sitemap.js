"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitSitemap = submitSitemap;
exports.listSitemaps = listSitemaps;
const auth_js_1 = require("../auth.js");
const allowlist_js_1 = require("../allowlist.js");
const oauth_js_1 = require("../oauth.js");
const submission_cap_js_1 = require("../submission-cap.js");
const untrusted_js_1 = require("../untrusted.js");
/**
 * The Sitemaps API accepts sc-domain: properties directly, so the configured
 * property is always tried as-is first (#7). The URL-prefix conversions stay
 * on as fallbacks for accounts where the permission actually lives on a
 * matching URL-prefix property rather than the domain property.
 */
function sitemapPropertyCandidates(siteUrl) {
    if (siteUrl.startsWith("sc-domain:")) {
        const domain = siteUrl.replace("sc-domain:", "");
        return [siteUrl, `https://${domain}/`, `https://www.${domain}/`];
    }
    return [siteUrl];
}
function allowedSitemapProperties(siteUrl) {
    const allowed = [];
    for (const candidate of sitemapPropertyCandidates(siteUrl)) {
        try {
            allowed.push((0, allowlist_js_1.assertAllowedProperty)(candidate));
        }
        catch {
            // A domain-property fallback such as www.* is skipped when that host
            // is outside the allowlist. It is never sent to the API.
        }
    }
    return allowed;
}
function defaultSitemapUrl(property) {
    if (property.startsWith("sc-domain:")) {
        return `https://${property.replace("sc-domain:", "")}/sitemap.xml`;
    }
    return `${property}sitemap.xml`;
}
function fallbackNote(used, configured) {
    if (used === configured)
        return undefined;
    return (`The configured property (${configured}) rejected the call, so the ` +
        `URL-prefix property (${used}) was used instead. The results belong to ` +
        `that property, which may differ from the domain property's own sitemap list.`);
}
function permissionHint(candidates) {
    return (` Tried: ${candidates.join(", ")}. Check that the authenticated account ` +
        `has sitemap permission on the property in Search Console.`);
}
async function submitSitemap(sitemapUrl) {
    const explicitFeed = sitemapUrl !== undefined ? (0, allowlist_js_1.assertAllowedPageUrl)(sitemapUrl) : undefined;
    const { siteUrl: configSiteUrl } = (0, auth_js_1.getConfig)();
    const candidates = allowedSitemapProperties(configSiteUrl);
    if (candidates.length === 0) {
        throw new Error(`Rejected property: "${configSiteUrl}" has no allowlisted sitemap property. No request was sent.`);
    }
    const feedpath = explicitFeed || (0, allowlist_js_1.assertAllowedPageUrl)(defaultSitemapUrl(configSiteUrl));
    if ((0, auth_js_1.getAuthMode)() === "oauth" && (0, oauth_js_1.getScopeTier)() === "readonly") {
        return {
            siteUrl: configSiteUrl,
            sitemapUrl: feedpath,
            success: false,
            error: "Sitemap submission needs GSC_SCOPES=submit. sitemaps.submit is rejected with webmasters.readonly, " +
                "so the webmasters scope is requested only on that tier. Re-authenticate with GSC_SCOPES=submit. No request was sent.",
        };
    }
    (0, submission_cap_js_1.reserveUrlSubmits)(1);
    const client = await (0, auth_js_1.getSearchConsoleClient)();
    let firstError = null;
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
        }
        catch (err) {
            if (!firstError)
                firstError = err;
        }
    }
    return {
        siteUrl: configSiteUrl,
        sitemapUrl: feedpath,
        success: false,
        error: (firstError?.message || String(firstError)) + permissionHint(candidates),
    };
}
async function listSitemaps() {
    const { siteUrl: configSiteUrl } = (0, auth_js_1.getConfig)();
    const candidates = allowedSitemapProperties(configSiteUrl);
    if (candidates.length === 0) {
        throw new Error(`Rejected property: "${configSiteUrl}" has no allowlisted sitemap property. No request was sent.`);
    }
    const client = await (0, auth_js_1.getSearchConsoleClient)();
    let firstError = null;
    for (const property of candidates) {
        try {
            const response = await client.sitemaps.list({ siteUrl: property });
            const sitemaps = (response.data.sitemap || []).map((s) => ({
                path: (0, untrusted_js_1.asUntrustedText)(s.path || ""),
                lastSubmitted: s.lastSubmitted ? (0, untrusted_js_1.asUntrustedText)(s.lastSubmitted) : null,
                isPending: s.isPending || false,
                lastDownloaded: s.lastDownloaded ? (0, untrusted_js_1.asUntrustedText)(s.lastDownloaded) : null,
                warnings: Number(s.warnings) || 0,
                errors: Number(s.errors) || 0,
                contents: (s.contents || []).map((c) => ({
                    type: (0, untrusted_js_1.asUntrustedText)(c.type || "unknown"),
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
        }
        catch (err) {
            if (!firstError)
                firstError = err;
        }
    }
    throw new Error((firstError?.message || String(firstError)) + permissionHint(candidates));
}
