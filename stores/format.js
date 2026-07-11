/**
 * Shared on-disk format for every Contextly store.
 *
 * A context is a single Markdown file with a small frontmatter block:
 *
 *   ---
 *   title: Product Roadmap
 *   created: 2026-01-01T00:00:00.000Z
 *   updated: 2026-01-02T00:00:00.000Z
 *   model: Claude Opus 4.7
 *   client: claude-desktop
 *   device: my-laptop
 *   ---
 *
 *   ...body...
 *
 * Keeping parse/serialize here (rather than in any one backend) guarantees the
 * file store, Dropbox, and Google Drive all read and write the SAME bytes — so a
 * user can move their `~/.contextly` folder into Dropbox, or switch backends,
 * without any migration.
 */
import os from "node:os";

export const DEVICE = (os.hostname() || "unknown").replace(/\.local$/, "");

export function parse(raw) {
  const meta = {};
  let body = raw;
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = raw.slice(fm[0].length);
  }
  if (!meta.title) {
    const h = raw.match(/^#\s+(.*)$/m);
    if (h) meta.title = h[1].trim();
  }
  return { meta, body };
}

export function serialize(meta, body) {
  const order = ["title", "created", "updated", "model", "client", "device"];
  // collapse newlines so a value can't spoof extra frontmatter fields
  const clean = (v) => String(v).replace(/[\r\n]+/g, " ").trim();
  const lines = order.filter((k) => meta[k]).map((k) => `${k}: ${clean(meta[k])}`);
  return `---\n${lines.join("\n")}\n---\n\n${(body || "").trim()}\n`;
}

/**
 * Build the frontmatter for a save, preserving prior created/model/client.
 * `prior` is the previous parsed meta (or null for a new context).
 */
export function buildMeta({ title, model, client }, prior, now) {
  return {
    title,
    created: prior?.created || now,
    updated: now,
    model: model || prior?.model || "",
    client: client || prior?.client || "",
    device: DEVICE,
  };
}
