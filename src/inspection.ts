import { getSearchConsoleClient, getConfig } from "./auth.js";
import { assertAllowedPageUrl } from "./allowlist.js";
import { asUntrustedText } from "./untrusted.js";

export interface InspectionResult {
  indexed: boolean;
  indexingState: string;
  lastCrawlTime: string | null;
  crawlAllowed: boolean;
  robotsTxtState: string;
  indexingAllowed: boolean;
  pageFetchState: string;
  googleCanonical: string | null;
  userCanonical: string | null;
  canonicalMatch: boolean;
  mobileUsability: string;
  verdict: string;
  issues: string[];
}

export async function inspectUrl(url: string): Promise<InspectionResult> {
  const inspectionUrl = assertAllowedPageUrl(url);
  const { siteUrl } = getConfig();
  const client = await getSearchConsoleClient();

  const response = await client.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl,
      siteUrl,
    },
  });

  const result = response.data.inspectionResult;
  const indexStatus = result?.indexStatusResult;
  const mobileResult = result?.mobileUsabilityResult;

  const issues: string[] = [];

  if (indexStatus?.robotsTxtState === "DISALLOWED") {
    issues.push("Blocked by robots.txt");
  }
  if (indexStatus?.indexingState === "INDEXING_NOT_ALLOWED") {
    issues.push("Noindex tag detected");
  }
  if (indexStatus?.pageFetchState && indexStatus.pageFetchState !== "SUCCESSFUL") {
    issues.push(`Page fetch failed: ${indexStatus.pageFetchState}`);
  }

  const googleCanonical = indexStatus?.googleCanonical ? asUntrustedText(indexStatus.googleCanonical) : null;
  const userCanonical = indexStatus?.userCanonical ? asUntrustedText(indexStatus.userCanonical) : null;

  if (googleCanonical && userCanonical && googleCanonical !== userCanonical) {
    issues.push(
      `Canonical mismatch: Google chose ${googleCanonical}, you declared ${userCanonical}`
    );
  }

  if (mobileResult?.verdict === "VERDICT_HAS_ISSUES") {
    const mobileIssues = mobileResult.issues || [];
    for (const issue of mobileIssues) {
      const message = asUntrustedText(issue.message || issue.issueType || "");
      issues.push(`Mobile: ${message}`);
    }
  }

  return {
    indexed: indexStatus?.coverageState === "Submitted and indexed" ||
             indexStatus?.verdict === "PASS",
    indexingState: asUntrustedText(indexStatus?.coverageState || "Unknown"),
    lastCrawlTime: indexStatus?.lastCrawlTime ? asUntrustedText(indexStatus.lastCrawlTime) : null,
    crawlAllowed: indexStatus?.robotsTxtState !== "DISALLOWED",
    robotsTxtState: asUntrustedText(indexStatus?.robotsTxtState || "Unknown"),
    indexingAllowed: indexStatus?.indexingState !== "INDEXING_NOT_ALLOWED",
    pageFetchState: asUntrustedText(indexStatus?.pageFetchState || "Unknown"),
    googleCanonical,
    userCanonical,
    canonicalMatch: googleCanonical === userCanonical || (!googleCanonical && !userCanonical),
    mobileUsability: asUntrustedText(mobileResult?.verdict || "Unknown"),
    verdict: asUntrustedText(indexStatus?.verdict || "Unknown"),
    issues: issues.map((issue) => asUntrustedText(issue)),
  };
}
