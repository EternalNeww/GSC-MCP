"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectUrl = inspectUrl;
const auth_js_1 = require("./auth.js");
const allowlist_js_1 = require("./allowlist.js");
const untrusted_js_1 = require("./untrusted.js");
async function inspectUrl(url) {
    const inspectionUrl = (0, allowlist_js_1.assertAllowedPageUrl)(url);
    const { siteUrl } = (0, auth_js_1.getConfig)();
    const client = await (0, auth_js_1.getSearchConsoleClient)();
    const response = await client.urlInspection.index.inspect({
        requestBody: {
            inspectionUrl,
            siteUrl,
        },
    });
    const result = response.data.inspectionResult;
    const indexStatus = result?.indexStatusResult;
    const mobileResult = result?.mobileUsabilityResult;
    const issues = [];
    if (indexStatus?.robotsTxtState === "DISALLOWED") {
        issues.push("Blocked by robots.txt");
    }
    if (indexStatus?.indexingState === "INDEXING_NOT_ALLOWED") {
        issues.push("Noindex tag detected");
    }
    if (indexStatus?.pageFetchState && indexStatus.pageFetchState !== "SUCCESSFUL") {
        issues.push(`Page fetch failed: ${indexStatus.pageFetchState}`);
    }
    const googleCanonical = indexStatus?.googleCanonical ? (0, untrusted_js_1.asUntrustedText)(indexStatus.googleCanonical) : null;
    const userCanonical = indexStatus?.userCanonical ? (0, untrusted_js_1.asUntrustedText)(indexStatus.userCanonical) : null;
    if (googleCanonical && userCanonical && googleCanonical !== userCanonical) {
        issues.push(`Canonical mismatch: Google chose ${googleCanonical}, you declared ${userCanonical}`);
    }
    if (mobileResult?.verdict === "VERDICT_HAS_ISSUES") {
        const mobileIssues = mobileResult.issues || [];
        for (const issue of mobileIssues) {
            const message = (0, untrusted_js_1.asUntrustedText)(issue.message || issue.issueType || "");
            issues.push(`Mobile: ${message}`);
        }
    }
    return {
        indexed: indexStatus?.coverageState === "Submitted and indexed" ||
            indexStatus?.verdict === "PASS",
        indexingState: (0, untrusted_js_1.asUntrustedText)(indexStatus?.coverageState || "Unknown"),
        lastCrawlTime: indexStatus?.lastCrawlTime ? (0, untrusted_js_1.asUntrustedText)(indexStatus.lastCrawlTime) : null,
        crawlAllowed: indexStatus?.robotsTxtState !== "DISALLOWED",
        robotsTxtState: (0, untrusted_js_1.asUntrustedText)(indexStatus?.robotsTxtState || "Unknown"),
        indexingAllowed: indexStatus?.indexingState !== "INDEXING_NOT_ALLOWED",
        pageFetchState: (0, untrusted_js_1.asUntrustedText)(indexStatus?.pageFetchState || "Unknown"),
        googleCanonical,
        userCanonical,
        canonicalMatch: googleCanonical === userCanonical || (!googleCanonical && !userCanonical),
        mobileUsability: (0, untrusted_js_1.asUntrustedText)(mobileResult?.verdict || "Unknown"),
        verdict: (0, untrusted_js_1.asUntrustedText)(indexStatus?.verdict || "Unknown"),
        issues: issues.map((issue) => (0, untrusted_js_1.asUntrustedText)(issue)),
    };
}
