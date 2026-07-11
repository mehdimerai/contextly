/**
 * End-to-end smoke test: spawn the server over stdio, list tools, then
 * save → list → recall → search, printing each result.
 * Uses a throwaway storage dir so it never touches your real ~/.contextly.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const TMP = path.join(os.tmpdir(), "contextly-test-" + Date.now());

const transport = new StdioClientTransport({
  command: "node",
  args: ["bin/contextly.js"],
  env: { ...process.env, CONTEXTLY_STORE: "file", CONTEXTLY_DIR: TMP },
});
const client = new Client({ name: "test", version: "0.0.0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return r.content.map((c) => c.text).join("\n");
};

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "), "\n");

console.log("save  →", await call("save_context", { title: "Sourdough Starter", content: "Feed 1:1:1 flour and water daily. Peak rise about 4 hours in a warm kitchen. Smells tangy, not sharp." }));
console.log("save  →", await call("save_context", { title: "Travel — Japan", content: "Tokyo + Kyoto, 10 days, ramen shortlist." }));
console.log("\nlist  →", await call("list_contexts"));
console.log("\nrecall→", await call("recall_context", { title: "sourdough" }));
console.log("\nsearch→", await call("search_context", { query: "ramen" }));

await client.close();
await fs.rm(TMP, { recursive: true, force: true });
console.log("\n✓ all good — cleaned up", TMP);
