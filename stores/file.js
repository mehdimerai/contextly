/**
 * Local file-backed store (single user). The default backend, and also what you
 * get if you simply point CONTEXTLY_DIR at a synced folder (Dropbox/Drive
 * desktop app, iCloud, etc.).
 *
 * Implements the store interface consumed by lib.js:
 *   list() · get(query) · save({title,content,model,client}) ·
 *   append({title,content,model,client}) · search(query)
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { slugify } from "../util.js";
import { parse, serialize, buildMeta } from "./format.js";

export const defaultDir = () => process.env.CONTEXTLY_DIR || path.join(os.homedir(), ".contextly");

export class FileStore {
  constructor(dir = defaultDir()) { this.dir = dir; }
  _ensure() { return fs.mkdir(this.dir, { recursive: true }); }
  _file(title) { return path.join(this.dir, `${slugify(title)}.md`); }

  async _files() {
    await this._ensure();
    return (await fs.readdir(this.dir)).filter((n) => n.endsWith(".md"));
  }

  async _read(file) {
    const fp = path.join(this.dir, file);
    const raw = await fs.readFile(fp, "utf8");
    const st = await fs.stat(fp).catch(() => null);
    const { meta, body } = parse(raw);
    const created = meta.created || st?.birthtime?.toISOString?.() || st?.mtime.toISOString();
    const updated = meta.updated || st?.mtime.toISOString();
    return {
      title: meta.title || file.replace(/\.md$/, ""),
      body, model: meta.model || "", client: meta.client || "", device: meta.device || "",
      created, updated, size: st?.size ?? Buffer.byteLength(raw),
    };
  }

  async _resolve(query) {
    const files = await this._files();
    const want = slugify(query);
    let hit = files.find((f) => f === `${want}.md`);
    if (hit) return hit;
    hit = files.find((f) => f.replace(/\.md$/, "").includes(want) || want.includes(f.replace(/\.md$/, "")));
    if (hit) return hit;
    for (const f of files) {
      const { title } = await this._read(f);
      if (title.toLowerCase().includes(query.toLowerCase())) return f;
    }
    return null;
  }

  async list() {
    const out = [];
    for (const f of await this._files()) out.push(await this._read(f));
    return out;
  }

  async get(query) {
    const f = await this._resolve(query);
    return f ? this._read(f) : null;
  }

  async save({ title, content, model, client }) {
    await this._ensure();
    const fp = this._file(title);
    const prior = await fs.readFile(fp, "utf8").then(parse).catch(() => null);
    const now = new Date().toISOString();
    const meta = buildMeta({ title, model, client }, prior?.meta, now);
    await fs.writeFile(fp, serialize(meta, content), "utf8");
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
    for (const f of await this._files()) {
      const { title, body } = await this._read(f);
      const i = body.toLowerCase().indexOf(q);
      if (i !== -1) {
        const snippet = body.slice(Math.max(0, i - 60), i + q.length + 60).replace(/\s+/g, " ").trim();
        hits.push({ title, snippet });
      }
    }
    return hits;
  }
}
