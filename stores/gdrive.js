/**
 * Google Drive-backed store (single user, your own Drive).
 *
 * Contexts are stored as `${slug}.md` files — the same format as the local file
 * store — inside a single `Contextly` folder. The app uses the narrow `drive.file`
 * scope, so it can only ever see files it created; the rest of your Drive is
 * invisible to it. Auth is a refresh token obtained once via
 * `contextly-auth gdrive`; access tokens are fetched on demand and cached.
 *
 * Uses the global fetch (Node ≥18) — no SDK.
 *
 * Implements: list() · get(query) · save(...) · append(...) · search(query)
 */
import { slugify } from "../util.js";
import { parse, serialize, buildMeta } from "./format.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "Contextly";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export class GDriveStore {
  constructor({ clientId, clientSecret, refreshToken }) {
    if (!clientId || !clientSecret || !refreshToken)
      throw new Error("GDriveStore requires { clientId, clientSecret, refreshToken }.");
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this._access = null;
    this._exp = 0;
    this._folderId = null;
  }

  async _token() {
    if (this._access && Date.now() < this._exp - 60_000) return this._access;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) throw new Error(`Google token refresh failed (${r.status}): ${await r.text()}`);
    const j = await r.json();
    this._access = j.access_token;
    this._exp = Date.now() + (j.expires_in || 3600) * 1000;
    return this._access;
  }

  async _get(url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await this._token()}` } });
    if (!r.ok) throw new Error(`Google Drive GET failed (${r.status}): ${await r.text()}`);
    return r;
  }

  /** id of the Contextly folder, creating it on first use. */
  async _folder() {
    if (this._folderId) return this._folderId;
    const q = encodeURIComponent(`name='${FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const r = await this._get(`${API}/files?q=${q}&fields=files(id)&spaces=drive`);
    const { files } = await r.json();
    if (files && files.length) return (this._folderId = files[0].id);
    const c = await fetch(`${API}/files?fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this._token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME }),
    });
    if (!c.ok) throw new Error(`Google Drive folder create failed (${c.status}): ${await c.text()}`);
    return (this._folderId = (await c.json()).id);
  }

  /** Drive file metadata objects ({id,name,createdTime,modifiedTime,size}) for our `.md` files. */
  async _entries() {
    const folder = await this._folder();
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
    const fields = encodeURIComponent("files(id,name,createdTime,modifiedTime,size)");
    const r = await this._get(`${API}/files?q=${q}&fields=${fields}&pageSize=1000`);
    const { files } = await r.json();
    return (files || []).filter((f) => f.name.endsWith(".md"));
  }

  async _read(entry) {
    const r = await this._get(`${API}/files/${entry.id}?alt=media`);
    const raw = await r.text();
    const { meta, body } = parse(raw);
    return {
      title: meta.title || entry.name.replace(/\.md$/, ""),
      body,
      model: meta.model || "",
      client: meta.client || "",
      device: meta.device || "",
      created: meta.created || entry.createdTime || "",
      updated: meta.updated || entry.modifiedTime || "",
      size: entry.size ? Number(entry.size) : Buffer.byteLength(raw),
      _id: entry.id,
    };
  }

  async _findEntry(query) {
    const entries = await this._entries();
    const want = `${slugify(query)}.md`;
    return (
      entries.find((e) => e.name === want) ||
      entries.find(
        (e) => e.name.includes(slugify(query)) || slugify(query).includes(e.name.replace(/\.md$/, "")),
      ) ||
      null
    );
  }

  async list() {
    const out = [];
    for (const e of await this._entries()) out.push(await this._read(e));
    return out;
  }

  async get(query) {
    let entry = await this._findEntry(query);
    if (!entry) {
      // last resort: title match inside the frontmatter
      for (const e of await this._entries()) {
        const rec = await this._read(e);
        if (rec.title.toLowerCase().includes(query.toLowerCase())) { entry = e; break; }
      }
    }
    return entry ? this._read(entry) : null;
  }

  async save({ title, content, model, client }) {
    const name = `${slugify(title)}.md`;
    const existing = (await this._entries()).find((e) => e.name === name);
    const prior = existing ? await this._read(existing) : null;
    const now = new Date().toISOString();
    const priorMeta = prior && { created: prior.created, model: prior.model, client: prior.client };
    const meta = buildMeta({ title, model, client }, priorMeta, now);
    const data = serialize(meta, content);
    const token = await this._token();

    if (existing) {
      const r = await fetch(`${UPLOAD}/files/${existing._id ?? existing.id}?uploadType=media`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/markdown" },
        body: data,
      });
      if (!r.ok) throw new Error(`Google Drive update failed (${r.status}): ${await r.text()}`);
    } else {
      const boundary = "contextly-" + slugify(title) + "-boundary";
      const metadata = { name, parents: [await this._folder()] };
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n${data}\r\n--${boundary}--`;
      const r = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      if (!r.ok) throw new Error(`Google Drive create failed (${r.status}): ${await r.text()}`);
    }
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
    for (const e of await this._entries()) {
      const rec = await this._read(e);
      const i = rec.body.toLowerCase().indexOf(q);
      if (i !== -1) {
        const snippet = rec.body.slice(Math.max(0, i - 60), i + q.length + 60).replace(/\s+/g, " ").trim();
        hits.push({ title: rec.title, snippet });
      }
    }
    return hits;
  }
}
