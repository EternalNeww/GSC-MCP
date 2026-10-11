import { google } from "googleapis";
import { getAuthMode } from "../auth.js";
import { assertAllowedPageUrl } from "../allowlist.js";
import { authenticateWithOAuth, getScopeTier, INDEXING_SCOPE } from "../oauth.js";
import { reserveUrlSubmits } from "../submission-cap.js";
import * as fs from "fs";

function assertIndexingEnabled(): void {
  if (getAuthMode() === "oauth" && getScopeTier() === "readonly") {
    throw new Error(
      "URL submission needs the indexing scope, which is requested only when GSC_SCOPES=submit (alias: full). " +
        "This process is read only. Set GSC_SCOPES=submit and re-authenticate. No request was sent."
    );
  }
}

async function getIndexingClient() {
  assertIndexingEnabled();

  if (getAuthMode() === "oauth") {
    const oauth2Client = await authenticateWithOAuth();
    google.options({ auth: oauth2Client });
  } else {
    const keyFile = process.env.GSC_KEY_FILE;
    if (!keyFile || !fs.existsSync(keyFile)) {
      throw new Error("GSC_KEY_FILE is required for indexing API in service_account mode.");
    }
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: [INDEXING_SCOPE],
    });
    google.options({ auth });
  }

  return google.indexing("v3");
}

interface SubmitResult {
  url: string;
  type: "URL_UPDATED";
  notifyTime: string | null;
  success: boolean;
  error: string | null;
  note: string;
}

const UPDATED_NOTE =
  "Google has been notified with URL_UPDATED. Deletion is not supported. The Indexing API officially supports JobPosting and BroadcastEvent schema types, but processes requests for all page types. Priority is not guaranteed for non-job pages.";

async function publishUpdated(url: string): Promise<SubmitResult> {
  try {
    const indexing = await getIndexingClient();
    const response = await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: "URL_UPDATED",
      },
    });

    return {
      url,
      type: "URL_UPDATED",
      notifyTime: response.data.urlNotificationMetadata?.latestUpdate?.notifyTime || null,
      success: true,
      error: null,
      note: UPDATED_NOTE,
    };
  } catch (err: any) {
    return {
      url,
      type: "URL_UPDATED",
      notifyTime: null,
      success: false,
      error: err.message || String(err),
      note:
        "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console.",
    };
  }
}

export async function submitUrl(url: string): Promise<SubmitResult> {
  const allowed = assertAllowedPageUrl(url);
  assertIndexingEnabled();
  reserveUrlSubmits(1);
  return publishUpdated(allowed);
}

export async function submitBatch(
  urls: string[]
): Promise<{ results: SubmitResult[]; summary: { total: number; succeeded: number; failed: number; note: string } }> {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("Rejected submission: no URLs provided. No request was sent.");
  }
  if (urls.length > 200) {
    throw new Error(
      `Google's Indexing API has a daily quota of 200 requests. You provided ${urls.length} URLs. Please reduce to 200 or fewer. No request was sent.`
    );
  }

  const allowed = urls.map((url) => assertAllowedPageUrl(url));
  assertIndexingEnabled();
  reserveUrlSubmits(allowed.length);

  const results: SubmitResult[] = [];
  for (const url of allowed) {
    results.push(await publishUpdated(url));
    if (allowed.length > 10) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    results,
    summary: {
      total: allowed.length,
      succeeded,
      failed,
      note: `Per-process cap is ${process.env.GSC_MAX_URL_SUBMITS || "50"} URL submits (GSC_MAX_URL_SUBMITS). ${succeeded} submitted successfully, ${failed} failed. Only URL_UPDATED is sent.`,
    },
  };
}
