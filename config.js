/**
 * Configuration + store resolution for the local (stdio) server and the auth CLI.
 *
 * Contextly runs entirely on your machine as a single user. Which storage
 * backend it uses is decided, in priority order, by:
 *   1. CONTEXTLY_STORE env var            ("file" | "dropbox" | "gdrive")
 *   2. the "store" field in ~/.contextly/config.json (written by `contextly-auth`)
 *   3. default: "file"  (Markdown files in ~/.contextly)
 *
 * Cloud credentials come from ~/.contextly/config.json (the normal path, written
 * by the one-time auth flow) or from env vars (handy for CI / power users):
 *   Dropbox: DROPBOX_APP_KEY + DROPBOX_REFRESH_TOKEN
 *   Google:  GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileStore, defaultDir } from "./stores/file.js";
import { DropboxStore } from "./stores/dropbox.js";
import { GDriveStore } from "./stores/gdrive.js";

export const configDir = () => {
  const d = process.env.CONTEXTLY_DIR;
  return d && !d.includes("${") ? d : path.join(os.homedir(), ".contextly");
};
export const configPath = () => path.join(configDir(), "config.json");

export async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(configPath(), "utf8"));
  } catch {
    return {};
  }
}

/** Merge `patch` into the config file and persist it with owner-only perms. */
export async function saveConfig(patch) {
  const cur = await loadConfig();
  const next = { ...cur, ...patch };
  await fs.mkdir(configDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

function need(value, hint) {
  if (!value) throw new Error(hint);
  return value;
}

/** Build the configured store instance (throws a helpful message if unconfigured). */
export async function resolveStore(cfg) {
  cfg = cfg || (await loadConfig());
  const kind = process.env.CONTEXTLY_STORE || cfg.store || "file";

  if (kind === "file") {
    return { store: new FileStore(defaultDir()), label: `file (${defaultDir()})` };
  }

  if (kind === "dropbox") {
    const d = cfg.dropbox || {};
    const appKey = process.env.DROPBOX_APP_KEY || d.app_key;
    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN || d.refresh_token;
    need(appKey && refreshToken,
      "Dropbox is not connected. Run `npx contextly-auth dropbox` (or set DROPBOX_APP_KEY + DROPBOX_REFRESH_TOKEN).");
    return { store: new DropboxStore({ appKey, refreshToken }), label: "dropbox (your app folder)" };
  }

  if (kind === "gdrive") {
    const g = cfg.gdrive || {};
    const clientId = process.env.GOOGLE_CLIENT_ID || g.client_id;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || g.client_secret;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || g.refresh_token;
    need(clientId && clientSecret && refreshToken,
      "Google Drive is not connected. Run `npx contextly-auth gdrive` (or set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN).");
    return { store: new GDriveStore({ clientId, clientSecret, refreshToken }), label: "gdrive (Contextly folder)" };
  }

  throw new Error(`Unknown store "${kind}". Use "file", "dropbox", or "gdrive".`);
}
