"use strict";
/**
 * Per-process cap on Indexing API and sitemap submissions.
 * The counter lives in this process only and resets when the process exits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMaxUrlSubmits = getMaxUrlSubmits;
exports.getSubmissionCount = getSubmissionCount;
exports.resetSubmissionCountForTests = resetSubmissionCountForTests;
exports.reserveUrlSubmits = reserveUrlSubmits;
const DEFAULT_MAX_URL_SUBMITS = 50;
let used = 0;
function getMaxUrlSubmits() {
    const raw = process.env.GSC_MAX_URL_SUBMITS;
    if (raw === undefined || raw.trim() === "")
        return DEFAULT_MAX_URL_SUBMITS;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`GSC_MAX_URL_SUBMITS must be a non-negative integer. Got "${raw}". No request was sent.`);
    }
    return value;
}
function getSubmissionCount() {
    return used;
}
function resetSubmissionCountForTests() {
    used = 0;
}
/**
 * Reserve `count` submission slots. Throws, without incrementing, when the
 * reservation would pass the cap, so a rejected batch does not consume quota
 * and does not reach the network.
 */
function reserveUrlSubmits(count) {
    if (!Number.isInteger(count) || count < 1) {
        throw new Error(`Rejected submission: refusing to reserve ${count} slots. No request was sent.`);
    }
    const max = getMaxUrlSubmits();
    if (used + count > max) {
        throw new Error(`Rejected submission: this process is capped at ${max} URL submits (GSC_MAX_URL_SUBMITS) ` +
            `and has already used ${used}. Refusing ${count} more. No request was sent.`);
    }
    used += count;
}
