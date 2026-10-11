"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitUrl = submitUrl;
exports.submitBatch = submitBatch;
const googleapis_1 = require("googleapis");
const auth_js_1 = require("../auth.js");
const allowlist_js_1 = require("../allowlist.js");
const oauth_js_1 = require("../oauth.js");
const submission_cap_js_1 = require("../submission-cap.js");
const fs = __importStar(require("fs"));
function assertIndexingEnabled() {
    if ((0, auth_js_1.getAuthMode)() === "oauth" && (0, oauth_js_1.getScopeTier)() === "readonly") {
        throw new Error("URL submission needs the indexing scope, which is requested only when GSC_SCOPES=submit (alias: full). " +
            "This process is read only. Set GSC_SCOPES=submit and re-authenticate. No request was sent.");
    }
}
async function getIndexingClient() {
    assertIndexingEnabled();
    if ((0, auth_js_1.getAuthMode)() === "oauth") {
        const oauth2Client = await (0, oauth_js_1.authenticateWithOAuth)();
        googleapis_1.google.options({ auth: oauth2Client });
    }
    else {
        const keyFile = process.env.GSC_KEY_FILE;
        if (!keyFile || !fs.existsSync(keyFile)) {
            throw new Error("GSC_KEY_FILE is required for indexing API in service_account mode.");
        }
        const auth = new googleapis_1.google.auth.GoogleAuth({
            keyFile,
            scopes: [oauth_js_1.INDEXING_SCOPE],
        });
        googleapis_1.google.options({ auth });
    }
    return googleapis_1.google.indexing("v3");
}
const UPDATED_NOTE = "Google has been notified with URL_UPDATED. Deletion is not supported. The Indexing API officially supports JobPosting and BroadcastEvent schema types, but processes requests for all page types. Priority is not guaranteed for non-job pages.";
async function publishUpdated(url) {
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
    }
    catch (err) {
        return {
            url,
            type: "URL_UPDATED",
            notifyTime: null,
            success: false,
            error: err.message || String(err),
            note: "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console.",
        };
    }
}
async function submitUrl(url) {
    const allowed = (0, allowlist_js_1.assertAllowedPageUrl)(url);
    assertIndexingEnabled();
    (0, submission_cap_js_1.reserveUrlSubmits)(1);
    return publishUpdated(allowed);
}
async function submitBatch(urls) {
    if (!Array.isArray(urls) || urls.length === 0) {
        throw new Error("Rejected submission: no URLs provided. No request was sent.");
    }
    if (urls.length > 200) {
        throw new Error(`Google's Indexing API has a daily quota of 200 requests. You provided ${urls.length} URLs. Please reduce to 200 or fewer. No request was sent.`);
    }
    const allowed = urls.map((url) => (0, allowlist_js_1.assertAllowedPageUrl)(url));
    assertIndexingEnabled();
    (0, submission_cap_js_1.reserveUrlSubmits)(allowed.length);
    const results = [];
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
