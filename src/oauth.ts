import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as os from "os";
import { EMBEDDED_CLIENT_ID, EMBEDDED_CLIENT_SECRET, embeddedClientAvailable } from "./embedded-client.js";

const TOKEN_DIR = path.join(os.homedir(), ".gsc-mcp");
const TOKEN_PATH = path.join(TOKEN_DIR, "oauth-token.json");

export type ScopeTier = "readonly" | "submit";

export const WEBMASTERS_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Required only by sitemaps.submit. webmasters.readonly cannot call it. */
export const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
/** Required only by Indexing API urlNotifications.publish (URL_UPDATED). */
export const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";

/**
 * Default is readonly: webmasters.readonly only.
 * GSC_SCOPES=submit (alias: full) adds the Indexing API scope for URL_UPDATED
 * submissions and the webmasters scope because sitemaps.submit rejects the
 * readonly scope. See SECURITY-FORK.md.
 */
export function getScopeTier(): ScopeTier {
  const raw = process.env.GSC_SCOPES?.trim().toLowerCase();
  if (raw === "submit" || raw === "full") return "submit";
  return "readonly";
}

export function scopesForTier(tier: ScopeTier): string[] {
  if (tier === "readonly") {
    return [WEBMASTERS_READONLY_SCOPE];
  }
  return [WEBMASTERS_READONLY_SCOPE, INDEXING_SCOPE, WEBMASTERS_SCOPE];
}

export function clearCachedToken(): void {
  try {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
  } catch {
    // best effort
  }
}

export function tokenPath(): string {
  return TOKEN_PATH;
}

// Concurrency guard: if an OAuth flow is already in progress, reuse its promise
let activeAuthPromise: Promise<any> | null = null;

function ensureTokenDir(): void {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
}

export function loadCachedToken(): any | null {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const raw = fs.readFileSync(TOKEN_PATH, "utf8");
      return JSON.parse(raw);
    }
  } catch {
    // corrupted token file, will re-auth
  }
  return null;
}

export function saveCachedToken(token: any): void {
  ensureTokenDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), "utf8");
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

export function getOAuthConfig(): OAuthConfig {
  // Option 1: direct env vars
  const clientId = process.env.GSC_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  // Option 2: secrets file
  const secretsFile = process.env.GSC_OAUTH_SECRETS_FILE;
  if (secretsFile && fs.existsSync(secretsFile)) {
    const raw = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
    const creds = raw.installed || raw.web;
    if (creds) {
      return {
        clientId: creds.client_id,
        clientSecret: creds.client_secret,
      };
    }
  }

  // Option 3: the embedded public client (see embedded-client.ts)
  if (embeddedClientAvailable()) {
    return { clientId: EMBEDDED_CLIENT_ID, clientSecret: EMBEDDED_CLIENT_SECRET };
  }

  throw new Error(
    "OAuth credentials not found. Run `npx suganthan-gsc-mcp setup` for guided configuration, " +
    "or set GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET, " +
    "or set GSC_OAUTH_SECRETS_FILE to a Google OAuth client secrets JSON file."
  );
}

/**
 * True when the cached token was granted every scope the current tier needs.
 * A token minted in read-only mode cannot call write APIs, so switching
 * GSC_SCOPES to "full" must trigger a fresh consent rather than a silent 403.
 */
function cachedTokenCoversScopes(cachedToken: any): boolean {
  const needed = scopesForTier(getScopeTier());
  const granted: string[] = typeof cachedToken?.scope === "string" ? cachedToken.scope.split(" ") : [];
  if (granted.length === 0) {
    // No recorded grant. Readonly can proceed; submission scopes must be
    // re-consented so indexing and webmasters are not assumed.
    return getScopeTier() === "readonly";
  }
  return needed.every((s) => granted.includes(s));
}

/**
 * Starts a one-shot local HTTP server to capture the OAuth redirect.
 * Returns the authorization code.
 */
function startLocalCallbackServer(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authentication failed.</h2><p>You can close this tab.</p></body></html>");
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to your MCP client.</p></body></html>");
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(400);
      res.end("Missing code parameter");
    });

    server.listen(port, "127.0.0.1", () => {
      console.error(`OAuth callback server listening on http://127.0.0.1:${port}`);
    });

    server.on("error", reject);

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth authentication timed out after 2 minutes"));
    }, 120000);
  });
}

/**
 * Runs the full OAuth2 flow: open browser, catch redirect, exchange code, cache token.
 * Returns an authenticated OAuth2 client.
 */
export async function authenticateWithOAuth(): Promise<any> {
  const { clientId, clientSecret } = getOAuthConfig();
  const callbackPort = 3847;
  const redirectUri = `http://127.0.0.1:${callbackPort}`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Check for cached token
  const cachedToken = loadCachedToken();
  if (cachedToken && !cachedTokenCoversScopes(cachedToken)) {
    console.error("Cached token is missing scopes the current GSC_SCOPES tier needs, re-authenticating...");
    return await runBrowserAuth(oauth2Client, callbackPort, redirectUri);
  }
  if (cachedToken) {
    oauth2Client.setCredentials(cachedToken);

    // Check if token needs refresh
    if (cachedToken.expiry_date && cachedToken.expiry_date < Date.now()) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        saveCachedToken(credentials);
        console.error("OAuth token refreshed successfully");
      } catch {
        console.error("Token refresh failed, re-authenticating...");
        return await runBrowserAuth(oauth2Client, callbackPort, redirectUri);
      }
    } else {
      console.error("Using cached OAuth token");
    }

    return oauth2Client;
  }

  return await runBrowserAuth(oauth2Client, callbackPort, redirectUri);
}

async function runBrowserAuth(
  oauth2Client: any,
  callbackPort: number,
  redirectUri: string
): Promise<any> {
  // If an auth flow is already running, wait for it instead of starting a second server
  if (activeAuthPromise) {
    console.error("OAuth flow already in progress, waiting for it to complete...");
    return activeAuthPromise;
  }

  activeAuthPromise = (async () => {
    try {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopesForTier(getScopeTier()),
        prompt: "consent",
      });

      // Start callback server before opening browser
      const codePromise = startLocalCallbackServer(callbackPort);

      // Open browser
      console.error(`\nOpening browser for Google authentication...\nIf the browser doesn't open, visit this URL:\n${authUrl}\n`);
      try {
        const open = (await import("open")).default;
        await open(authUrl);
      } catch {
        console.error("Could not open browser automatically. Please visit the URL above.");
      }

      // Wait for the code
      const code = await codePromise;

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      saveCachedToken(tokens);
      console.error("OAuth authentication successful, token cached");

      return oauth2Client;
    } finally {
      activeAuthPromise = null;
    }
  })();

  return activeAuthPromise;
}
