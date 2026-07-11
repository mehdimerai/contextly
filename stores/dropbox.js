/**
 * Dropbox-backed store (single user, your own Dropbox).
 *
 * Contexts are stored as `${slug}.md` files — the exact same format as the local
 * file store — inside your app's scoped **App folder** (Apps/Contextly/…), so the
 * app can never see the rest of your Dropbox. Auth is a refresh token obtained
 * once via `contextly-auth dropbox`; short-lived access tokens are fetched on
 * demand and cached in memory.
 *
 * Uses the global fetch (Node ≥18) — no SDK.
 *
 * Implements: list() · get(query) · save(...) · append(...) · search(query)
 */
import { slugify } from "../util.js";
import { parse, serialize, buildMeta } from "./format.js";

const TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const RPC = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";

export class DropboxStore {
  constructor({ appKey, refreshToken }) {
    if (!appKey || !refreshToken) throw new Error("DropboxStore requires { appKey, refreshToken }.");
    this.appKey = appKey;
    this.refreshToken = refreshToken;
    this._access = null;
    this._exp = 0;
  }

  async _token() {
    if (this._access && Date.now() < this._exp - 60_000) return this._access;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.appKey,
    });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) throw new Error(`Dropbox token refresh failed (${r.status}): ${await r.text()}`);
    const j = await r.json();
    this._access = j.access_token;
    this._exp = Date.now() + (j.expires_in || 14400) * 1000;
    return this._access;
  }

  async _rpc(path, arg) {
    const r = await fetch(`${RPC}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this._token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(arg),
    });
    if (!r.ok) throw new Error(`Dropbox ${path} failed (${r.status}): ${await r.text()}`);
    return r.json();
  }

  _path(title) { return `/${slugify(title)}.md`; }

  /** All `.md` filenames in the app folder. */
  async _files() {
    const names = [];
    let res = await this._rpc("/files/list_folder", { path: "", recursive: false });
    for (;;) {
      for (const e of res.entries) if (e[".tag"] === "file" && e.name.endsWith(".md")) names.push(e.name);
      if (!res.has_more) break;
      res = await this._rpc("/files/list_folder/continue", { cursor: res.cursor });
    }
    return names;
  }

  /** Download one file → normalized record (or null if missing). */
  async _read(dropboxPath) {
    const r = await fetch(`${CONTENT}/files/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this._token()}`,
        "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath }),
      },
    });
    if (r.status === 409) return null; // path/not_found
    if (!r.ok) throw new Error(`Dropbox download failed (${r.status}): ${await r.text()}`);
    const raw = await r.text();
    const apiResult = JSON.parse(r.headers.get("dropbox-api-result") || "{}");
    const { meta, body } = parse(raw);
    return {
      title: meta.title || dropboxPath.replace(/^\/|\.md$/g, ""),
      body,
      model: meta.model || "",
      client: meta.client || "",
      device: meta.device || "",
      created: meta.created || apiResult.client_modified || apiResult.server_modified || "",
      updated: meta.updated || apiResult.server_modified || "",
      size: apiResult.size ?? Buffer.byteLength(raw),
    };
  }

  async _resolve(query) {
    const files = await this._files();
    const want = `${slugify(query)}.md`;
    if (files.includes(want)) return `/${want}`;
    const partial = files.find(
      (f) => f.includes(slugify(query)) || slugify(query).includes(f.replace(/\.md$/, "")),
    );
    if (partial) return `/${partial}`;
    for (const f of files) {
      const rec = await this._read(`/${f}`);
      if (rec && rec.title.toLowerCase().includes(query.toLowerCase())) return `/${f}`;
    }
    return null;
  }

  async list() {
    const out = [];
    for (const name of await this._files()) {
      const rec = await this._read(`/${name}`);
      if (rec) out.push(rec);
    }
    return out;
  }

  async get(query) {
    const p = await this._resolve(query);
    return p ? this._read(p) : null;
  }

  async save({ title, content, model, client }) {
    const p = this._path(title);
    const prior = await this._read(p).catch(() => null);
    const now = new Date().toISOString();
    const priorMeta = prior && {
      created: prior.created, model: prior.model, client: prior.client,
    };
    const meta = buildMeta({ title, model, client }, priorMeta, now);
    const r = await fetch(`${CONTENT}/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this._token()}`,
        "Dropbox-API-Arg": JSON.stringify({ path: p, mode: "overwrite", mute: true }),
        "Content-Type": "application/octet-stream",
      },
      body: serialize(meta, content),
    });
    if (!r.ok) throw new Error(`Dropbox upload failed (${r.status}): ${await r.text()}`);
    return { title };
  }

  async append({ title, content, model, client }) {
    const cur = await this.get(title);
    const body = `${(cur?.body || "").trim()}\n\n${(content || "").trim()}`.trim();
    return this.save({ title: cur?.title || title, content: body, model, client });
  }

  async search(query) {
    const q = query.toLowerCase();
    const hits = [];
    for (const name of await this._files()) {
      const rec = await this._read(`/${name}`);
      if (!rec) continue;
      const i = rec.body.toLowerCase().indexOf(q);
      if (i !== -1) {
        const snippet = rec.body.slice(Math.max(0, i - 60), i + q.length + 60).replace(/\s+/g, " ").trim();
        hits.push({ title: rec.title, snippet });
      }
    }
    return hits;
  }
}
