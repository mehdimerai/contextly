#!/usr/bin/env node
/**
 * contextly-auth — one-time connector for your own Dropbox or Google Drive.
 *
 *   contextly-auth dropbox      connect a Dropbox app folder
 *   contextly-auth gdrive       connect a Google Drive "Contextly" folder
 *
 * It opens your browser, you approve, and a long-lived refresh token is written
 * to ~/.contextly/config.json. Nothing is sent anywhere except the provider you
 * choose — Contextly has no server. You supply your OWN OAuth app credentials
 * (see the README) so the data and API quota are entirely yours.
 *
 *   Dropbox app key:   env DROPBOX_APP_KEY   (or you'll be prompted)
 *   Google client:     env GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (or prompted)
 *   Redirect port:     env CONTEXTLY_AUTH_PORT (default 53682)
 */
import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawn } from "node:child_process";
import { saveConfig, configPath } from "../config.js";

const PORT = Number(process.env.CONTEXTLY_AUTH_PORT || 53682);
const REDIRECT = `http://localhost:${PORT}`;
const b64url = (buf) => buf.toString("base64url");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function prompt(question, { secret = false } = {}) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let mute = false;
  if (secret) rl._writeToOutput = (str) => { if (!mute) stdout.write(str); }; // hide typed secret
  const pending = rl.question(question);
  if (secret) mute = true; // question is printed; suppress the echoed keystrokes
  const answer = (await pending).trim();
  rl.close();
  if (secret) stdout.write("\n");
  return answer;
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch { /* fall back to manual */ }
}

/** Serve one request on the loopback redirect, resolve with the query params. */
function waitForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT);
      if (url.pathname !== "/") { res.writeHead(404).end(); return; }
      const params = Object.fromEntries(url.searchParams);
      const ok = params.code && (!expectedState || params.state === expectedState) && !params.error;
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;background:#0a0b0f;color:#eceef5;display:grid;place-items:center;height:100vh;margin:0">` +
        `<div style="text-align:center"><h2>${ok ? "✓ Contextly is connected" : "Authorization failed"}</h2>` +
        `<p style="color:#9598a6">${ok ? "You can close this tab and return to the terminal." : esc(params.error_description || params.error || "Missing code.")}</p></div>`,
      );
      server.close();
      if (ok) resolve(params);
      else reject(new Error(params.error_description || params.error || "state mismatch or missing code"));
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1");
  });
}

async function form(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Token exchange failed (${r.status}): ${text}`);
  return JSON.parse(text);
}

async function runDropbox() {
  const appKey = process.env.DROPBOX_APP_KEY || (await prompt("Dropbox app key: "));
  if (!appKey) throw new Error("A Dropbox app key is required.");
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
  authUrl.search = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    redirect_uri: REDIRECT,
    token_access_type: "offline",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();

  console.log(`\nMake sure ${REDIRECT} is a redirect URI on your Dropbox app.`);
  console.log("Opening your browser to approve access…\n" + authUrl.toString() + "\n");
  openBrowser(authUrl.toString());
  const { code } = await waitForCallback(state);

  const tok = await form("https://api.dropboxapi.com/oauth2/token", {
    code, grant_type: "authorization_code", redirect_uri: REDIRECT,
    client_id: appKey, code_verifier: verifier,
  });
  if (!tok.refresh_token) throw new Error("Dropbox did not return a refresh token (was token_access_type=offline used?).");

  await saveConfig({ store: "dropbox", dropbox: { app_key: appKey, refresh_token: tok.refresh_token } });
}

async function runGoogle() {
  const clientId = process.env.GOOGLE_CLIENT_ID || (await prompt("Google OAuth client ID: "));
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (await prompt("Google OAuth client secret: ", { secret: true }));
  if (!clientId || !clientSecret) throw new Error("A Google client ID and secret are required.");
  const state = b64url(crypto.randomBytes(16));

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT,
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();

  console.log(`\nUsing redirect ${REDIRECT} (allowed for a "Desktop app" OAuth client).`);
  console.log("Opening your browser to approve access…\n" + authUrl.toString() + "\n");
  openBrowser(authUrl.toString());
  const { code } = await waitForCallback(state);

  const tok = await form("https://oauth2.googleapis.com/token", {
    code, grant_type: "authorization_code", redirect_uri: REDIRECT,
    client_id: clientId, client_secret: clientSecret,
  });
  if (!tok.refresh_token) throw new Error("Google did not return a refresh token (try again with prompt=consent / a fresh grant).");

  await saveConfig({
    store: "gdrive",
    gdrive: { client_id: clientId, client_secret: clientSecret, refresh_token: tok.refresh_token },
  });
}

const provider = (process.argv[2] || "").toLowerCase();
try {
  if (provider === "dropbox") await runDropbox();
  else if (provider === "gdrive" || provider === "google") await runGoogle();
  else {
    console.error("Usage: contextly-auth <dropbox|gdrive>");
    process.exit(1);
  }
  console.log(`\n✓ Connected. Saved to ${configPath()}`);
  console.log("  Contextly will now use this backend. Restart your MCP client to pick it up.");
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
