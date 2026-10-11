# TradyList fork of Suganthan's GSC MCP

This tree is EternalNeww's fork of [Suganthan-Mohanadasan/Suganthans-GSC-MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP), hardened for read-mostly use by the TradyList SEO bot.

## Upstream commit audited

`9b0f3c099a0c9c1ddf4ce3868de546f6e01b8198`

That commit is upstream `main` at the time of the fork (`Embed the demo video in the README`, package version 2.5.1). The restrictions below start from that tree.

## Tools removed

| Tool or capability | Why it was removed |
|---|---|
| `image_page_audit` | Downloaded arbitrary caller-supplied page and image URLs (`fetch`) and parsed them locally. |
| `generate_report` | Wrote a markdown report to a caller-supplied path, or to `./gsc-report-{date}.md` when no path was given. |
| Indexing API `URL_DELETED` | De-index / URL deletion action on `submit_url` and `submit_batch`. There was no separate tool name. The action parameter is gone. Those tools only publish `URL_UPDATED`. |

Registration, implementation, and the docs that described those capabilities are removed. OAuth token caching (`~/.gsc-mcp/oauth-token.json`) and `setup` writing the local MCP client config are not tools and remain.

## Tools kept

Analytics tools are unchanged aside from the property allowlist and untrusted-text handling:

`quick_wins`, `ctr_opportunities`, `traffic_drops`, `content_gaps`, `site_snapshot`, `inspect_url`, `cannibalization_check`, `content_decay`, `topic_cluster_performance`, `ctr_vs_benchmark`, `verify_claim`, `advanced_search_analytics`, `check_alerts`, `content_recommendations`, `multi_site_dashboard`, `list_sitemaps`, `image_keyword_overview`, `image_search_quick_wins`, `compare_web_vs_image`, `image_pages_overview`, `image_keyword_trends`, `image_impressions_no_clicks`, `image_content_decay`, `genai_conversation_queries`.

Submission tools kept, with the restrictions in the next section:

`submit_url`, `submit_batch`, `submit_sitemap`.

`quick_wins` is the striking-distance report (positions 4–15). `ctr_opportunities` and `check_alerts` are the CTR anomaly reports. `content_recommendations` and `verify_claim` are unchanged in purpose.

## Allowlist

`GSC_ALLOWED_HOSTS` is a comma-separated list of bare hostnames. When unset it defaults to:

`tradylist.com,www.tradylist.com`

Matching is exact on the hostname produced by the URL parser. `http` is rejected. Lookalikes such as `tradylist.com.evil.io`, `nottradylist.com`, and `blog.tradylist.com` are rejected. A rejected value throws before any network call. A batch is all-or-nothing: one bad URL rejects the batch before any publish.

Accepted page, sitemap, and URL Inspection URLs: `https` and an allowlisted host, no credentials and no explicit port.

Accepted site properties on every tool, including `GSC_SITE_URL`, `GSC_SITE_URLS`, and `site_url` overrides:

- `sc-domain:tradylist.com` (or `sc-domain:` plus another allowlisted host)
- `https://tradylist.com/` and `https://www.tradylist.com/` (path prefixes on those hosts are allowed)

Sitemap domain-property fallbacks are filtered the same way. A fallback host that is not allowlisted is not requested.

## Submission cap

`GSC_MAX_URL_SUBMITS` defaults to `50`. It counts each Indexing API URL and each sitemap submission in the current process. The reservation happens after the allowlist check and before the client is created. A batch that would exceed the cap is refused entirely, and the counter is not incremented for that refusal.

## Untrusted Search Console text

Queries, page URLs, titles, and other strings returned by Search Console are copied into the JSON tool result. NUL bytes are stripped. The server does not evaluate them, compile them into code, pass them to a shell, or fetch them. Tool descriptions tell the model the same thing. `classifyQuery` only tests queries against fixed patterns.

## OAuth scopes

| Tier | How to select it | Scopes |
|---|---|---|
| `readonly` (default) | `GSC_SCOPES` unset or `readonly` | `https://www.googleapis.com/auth/webmasters.readonly` |
| `submit` | `GSC_SCOPES=submit` (`full` is an alias) | readonly, plus `https://www.googleapis.com/auth/indexing`, plus `https://www.googleapis.com/auth/webmasters` |

`indexing` is requested only on the submit tier, and only the Indexing API client uses it for `urlNotifications.publish` with type `URL_UPDATED`.

`webmasters` (the write scope) is requested only on the submit tier because sitemap submission strictly needs it. Google's Search Console API rejects `sitemaps.submit` when the token has only `webmasters.readonly`. Read tools, `sitemaps.list`, and URL Inspection stay on `webmasters.readonly`. Service-account mode uses the same tier.

## Environment variables added or changed

| Variable | Default | Role |
|---|---|---|
| `GSC_ALLOWED_HOSTS` | `tradylist.com,www.tradylist.com` | Exact host allowlist. Wildcards are rejected. |
| `GSC_MAX_URL_SUBMITS` | `50` | Per-process submission cap. |
| `GSC_SCOPES` | `readonly` | `readonly` or `submit`. `full` means `submit`. The previous default was `full`. |
| `GSC_SITE_URL` / `GSC_SITE_URLS` | unset | Must be allowlisted properties or the process refuses them before calling Google. |
