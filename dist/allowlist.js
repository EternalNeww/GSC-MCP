"use strict";
/**
 * Host allowlist for the TradyList fork.
 *
 * Page URLs (Indexing API, sitemap feeds, URL Inspection) must be https and
 * the hostname must be exactly one of the configured hosts. Properties must
 * be `sc-domain:<host>` or an https URL-prefix property on those hosts.
 * Comparison is exact. Suffixes, prefixes, and lookalikes never match.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllowedHosts = getAllowedHosts;
exports.assertAllowedPageUrl = assertAllowedPageUrl;
exports.assertAllowedProperty = assertAllowedProperty;
const DEFAULT_ALLOWED_HOSTS = ["tradylist.com", "www.tradylist.com"];
function getAllowedHosts() {
    const raw = process.env.GSC_ALLOWED_HOSTS;
    if (raw === undefined)
        return [...DEFAULT_ALLOWED_HOSTS];
    const hosts = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => normalizeAllowlistHost(entry));
    return hosts;
}
function normalizeAllowlistHost(entry) {
    if (entry.includes("*") || entry.includes("/") || entry.includes("\\") || entry.includes("@") || /\s/.test(entry)) {
        throw new Error(`GSC_ALLOWED_HOSTS entry "${entry}" is not a bare hostname. ` +
            "Use a comma-separated list such as tradylist.com,www.tradylist.com. Wildcards are not accepted.");
    }
    let parsed;
    try {
        parsed = new URL(`https://${entry}`);
    }
    catch {
        throw new Error(`GSC_ALLOWED_HOSTS entry "${entry}" is not a hostname.`);
    }
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw new Error(`GSC_ALLOWED_HOSTS entry "${entry}" is not a bare hostname. Do not include a scheme, path, port, or credentials.`);
    }
    if (!isBareHostname(parsed.hostname)) {
        throw new Error(`GSC_ALLOWED_HOSTS entry "${entry}" is not a bare hostname.`);
    }
    return parsed.hostname;
}
function isBareHostname(hostname) {
    if (!/^[a-z0-9.-]+$/.test(hostname))
        return false;
    if (hostname.startsWith(".") || hostname.endsWith(".") || hostname.includes(".."))
        return false;
    return hostname.split(".").every((label) => {
        return label.length > 0 && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-");
    });
}
function allowedHostList() {
    const hosts = getAllowedHosts();
    return hosts.length > 0 ? hosts.join(", ") : "(none)";
}
function hostIsAllowed(hostname) {
    return getAllowedHosts().includes(hostname.toLowerCase());
}
function rejectOddUrlCharacters(value, kind) {
    if (/[\s\\]/.test(value) || value.includes("@")) {
        throw new Error(`Rejected ${kind}: "${value}" contains credentials, whitespace, or a backslash. No request was sent.`);
    }
}
/**
 * Accept an https page, sitemap, or inspection URL on an allowlisted host.
 * Throws before the caller is allowed to open a socket.
 */
function assertAllowedPageUrl(raw) {
    if (typeof raw !== "string" || raw.trim() === "") {
        throw new Error("Rejected URL: empty value. No request was sent.");
    }
    const value = raw.trim();
    rejectOddUrlCharacters(value, "URL");
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new Error(`Rejected URL: "${value}" is not an absolute URL. No request was sent.`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`Rejected URL: "${value}" must use https (got ${parsed.protocol.replace(":", "")}). No request was sent.`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`Rejected URL: "${value}" must not contain credentials. No request was sent.`);
    }
    if (parsed.port) {
        throw new Error(`Rejected URL: "${value}" must not include a port. No request was sent.`);
    }
    if (!isBareHostname(parsed.hostname) || !hostIsAllowed(parsed.hostname)) {
        throw new Error(`Rejected URL: host "${parsed.hostname}" is not allowlisted. Allowed hosts: ${allowedHostList()}. No request was sent.`);
    }
    return parsed.href;
}
/**
 * Accept a Search Console property: `sc-domain:<host>` or `https://<host>/...`
 * where host is exactly allowlisted.
 */
function assertAllowedProperty(raw) {
    if (typeof raw !== "string" || raw.trim() === "") {
        throw new Error("Rejected property: empty value. No request was sent.");
    }
    const value = raw.trim();
    rejectOddUrlCharacters(value, "property");
    if (value.toLowerCase().startsWith("sc-domain:")) {
        const domain = value.slice("sc-domain:".length).trim().toLowerCase();
        if (!isBareHostname(domain) || !hostIsAllowed(domain)) {
            throw new Error(`Rejected property: "${value}" is not an allowlisted Search Console property. ` +
                `Allowed forms are sc-domain:<host> or https://<host>/ for: ${allowedHostList()}. No request was sent.`);
        }
        return `sc-domain:${domain}`;
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new Error(`Rejected property: "${value}" is not sc-domain:<host> or an https URL-prefix property. No request was sent.`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`Rejected property: "${value}" must be sc-domain:<host> or https (got ${parsed.protocol.replace(":", "")}). No request was sent.`);
    }
    if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
        throw new Error(`Rejected property: "${value}" must not contain credentials, a port, a query, or a fragment. No request was sent.`);
    }
    if (!isBareHostname(parsed.hostname) || !hostIsAllowed(parsed.hostname)) {
        throw new Error(`Rejected property: host "${parsed.hostname}" is not allowlisted. Allowed hosts: ${allowedHostList()}. No request was sent.`);
    }
    return parsed.href;
}
