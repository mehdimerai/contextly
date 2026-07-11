/**
 * Builds a fully-configured Contextly MCP server around a pluggable `store`.
 * The store is a FileStore, DropboxStore, or GDriveStore (chosen in config.js) —
 * the tools below don't care which; they all speak the same interface.
 *
 * Store interface: list() · get(query) · save({title,content,model,client}) ·
 *                  append({title,content,model,client}) · search(query)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fmtDate } from "./util.js";

const text = (t) => ({ content: [{ type: "text", text: t }] });

export function createServer(store) {
  const server = new McpServer({ name: "contextly", version: "0.2.0" });
  const clientName = () => {
    try { return server.server.getClientVersion()?.name || ""; } catch { return ""; }
  };

  server.registerTool("save_context", {
    title: "Save context",
    description: "Save (or overwrite) a named context so it can be recalled later from any model. " +
      "Pass the `model` you are if you know it (e.g. 'Claude Opus 4.7') so the library shows where each context came from.",
    inputSchema: {
      title: z.string().describe("Short, human-readable name, e.g. 'Product Roadmap'."),
      content: z.string().describe("The full context to store, in Markdown."),
      model: z.string().optional().describe("Optional: the model/app saving this, e.g. 'Claude Opus 4.7'."),
    },
  }, async ({ title, content, model }) => {
    await store.save({ title, content, model, client: clientName() });
    return text(`Saved context "${title}".`);
  });

  server.registerTool("append_context", {
    title: "Append to context",
    description: "Append new content to an existing context (creates it if missing).",
    inputSchema: {
      title: z.string().describe("Name of the context to append to."),
      content: z.string().describe("Markdown content to append."),
      model: z.string().optional().describe("Optional: the model/app appending this."),
    },
  }, async ({ title, content, model }) => {
    await store.append({ title, content, model, client: clientName() });
    return text(`Appended to "${title}".`);
  });

  server.registerTool("list_contexts", {
    title: "List contexts",
    description: "List everything stored in Contextly memory as a table with details: " +
      "created date, last updated, the model/app it came from, the device, and size. Render the table as-is.",
    inputSchema: {},
  }, async () => {
    const rows = await store.list();
    if (!rows.length) return text("Your Contextly memory is empty. Use save_context to store something.");
    rows.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
    const head =
      "| # | Context | Created | Last updated | Model | Device | Size |\n" +
      "|---|---------|---------|--------------|-------|--------|------|";
    const body = rows.map((r, i) =>
      `| ${i + 1} | ${r.title} | ${fmtDate(r.created)} | ${fmtDate(r.updated)} | ` +
      `${r.model || r.client || "—"} | ${r.device || "—"} | ${(r.size / 1024).toFixed(1)} KB |`
    ).join("\n");
    return text(`**${rows.length} context(s) in your Contextly memory:**\n\n${head}\n${body}`);
  });

  server.registerTool("recall_context", {
    title: "Recall context",
    description: "Retrieve a stored context by name so you can use it in the current conversation.",
    inputSchema: { title: z.string().describe("Name (or part of the name) of the context to recall.") },
  }, async ({ title }) => {
    const c = await store.get(title);
    if (!c) {
      const avail = (await store.list()).map((r) => "• " + r.title).join("\n") || "(none)";
      return text(`No context matching "${title}". Available:\n${avail}`);
    }
    const tag = [c.model || c.client, c.device, `updated ${fmtDate(c.updated)}`].filter(Boolean).join(" · ");
    return text(`# ${c.title}\n_${tag}_\n\n${(c.body || "").trim()}`);
  });

  server.registerTool("search_context", {
    title: "Search contexts",
    description: "Search across all stored contexts for a keyword or phrase; returns snippets.",
    inputSchema: { query: z.string().describe("Keyword or phrase to search for.") },
  }, async ({ query }) => {
    const hits = await store.search(query);
    if (!hits.length) return text(`No contexts mention "${query}".`);
    const list = hits.map((h) => `• **${h.title}**\n   …${h.snippet}…`).join("\n\n");
    return text(`${hits.length} match(es) for "${query}":\n\n${list}`);
  });

  return server;
}
