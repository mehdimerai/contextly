#!/usr/bin/env node
/**
 * Contextly MCP — local (stdio) entry point.
 * Runs on your machine for desktop clients: Claude Desktop, Claude Code, Cursor.
 * Single user, no auth, no Contextly server. Storage is your own: local files
 * (default), your Dropbox, or your Google Drive — see `contextly-auth`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../lib.js";
import { resolveStore } from "../config.js";

const { store, label } = await resolveStore();
const server = createServer(store);
await server.connect(new StdioServerTransport());
console.error(`contextly-mcp (stdio) ready · storage: ${label}`);
