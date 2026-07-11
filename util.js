/** Tiny shared helpers used by both storage backends and the server. */
export const slugify = (s) =>
  (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "untitled";

export const fmtDate = (iso) => (iso ? String(iso).slice(0, 16).replace("T", " ") : "—");
