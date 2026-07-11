# Contextly

**Store your AI context once, recall it into any model.** Contextly is a small
[MCP](https://modelcontextprotocol.io) server that gives Claude, Cursor, and other
MCP clients five tools to save and recall your context — so your notes, decisions,
and working memory are portable across models and sessions.

It runs **entirely on your machine** and keeps everything in **storage you own**:
local Markdown files by default, or your **own Dropbox** or **Google Drive**. There
is no Contextly account, server, or cloud — nothing to sign up for, nothing to pay.

> **License:** source-available under **PolyForm Noncommercial 1.0.0**. Free for
> personal and other noncommercial use. Commercial/business use needs a separate
> license — see [License](#license).

## Tools

| Tool | What it does |
|---|---|
| `save_context` | Save (or overwrite) a named context |
| `append_context` | Add to an existing context |
| `list_contexts` | List everything as a table (created, updated, model, device, size) |
| `recall_context` | Pull a stored context back into the conversation |
| `search_context` | Keyword search across all contexts, with snippets |

## Quick start (local files — zero config)

Requires **Node ≥ 18**.

```bash
git clone https://github.com/mehdimerai/contextly.git && cd contextly
npm install
npm test        # smoke test against the local file store
```

Contexts are stored as Markdown in `~/.contextly/`. Now point an MCP client at it.

**Claude Desktop / Claude Code** — add to your MCP config
(`claude_desktop_config.json`, or `claude mcp add`):

```json
{
  "mcpServers": {
    "contextly": {
      "command": "node",
      "args": ["/absolute/path/to/contextly/bin/contextly.js"]
    }
  }
}
```

**Cursor** — same shape in `~/.cursor/mcp.json` under `mcpServers`.

Restart the client; you'll see the five tools. That's it — you're running on local
files.

## Bring your own storage

Same tools, same Markdown format — just stored in your cloud. Run the one-time
connector, then restart your MCP client.

### Dropbox

1. Create a Dropbox app at <https://www.dropbox.com/developers/apps> →
   **Scoped access** → **App folder** (this limits Contextly to its own
   `Apps/<your-app>/` folder — it can never see the rest of your Dropbox).
2. On the app's **Permissions** tab, enable `files.content.read` and
   `files.content.write`.
3. On the **Settings** tab, add `http://localhost:53682` as an **OAuth 2 redirect
   URI**, and copy the **App key**.
4. Connect:
   ```bash
   node bin/contextly-auth.js dropbox      # paste the App key when asked
   ```
   Your browser opens, you approve, and a refresh token is saved to
   `~/.contextly/config.json`.

### Google Drive

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Google Drive API**.
2. Configure the OAuth consent screen (External is fine; add yourself as a test
   user), then create an **OAuth client ID** of type **Desktop app**. Copy the
   **Client ID** and **Client secret**.
3. Connect:
   ```bash
   node bin/contextly-auth.js gdrive       # paste client ID + secret when asked
   ```
   Approve in the browser. Contextly uses the narrow `drive.file` scope, so it can
   only ever see files it created — everything lives in one `Contextly` folder.

The connector writes your choice to `~/.contextly/config.json`; from then on the
server uses that backend. To switch back to local files, set `store` to `"file"`
in that file (or delete it).

## How it works

```
                      ┌─ stores/file.js     (~/.contextly Markdown files — default)
bin/contextly.js ──┐  │
   (stdio server)  ├──┼─ stores/dropbox.js  (your Dropbox app folder)
lib.js (5 tools) ──┘  │
   store interface ───┴─ stores/gdrive.js   (your Google Drive "Contextly" folder)
   list · get · save · append · search

config.js            picks the backend (CONTEXTLY_STORE → config.json → file)
bin/contextly-auth.js  one-time OAuth → refresh token in ~/.contextly/config.json
```

Every backend reads and writes the **same Markdown-with-frontmatter format**
(`stores/format.js`), so your library is portable: a context saved locally is
byte-identical to one saved in Dropbox or Drive. You can even drop your
`~/.contextly` folder into a synced Dropbox/Drive desktop folder and keep using the
plain `file` store.

## Privacy

Your context never touches a Contextly-operated server — there isn't one. Data
lives only on your disk or in your own cloud account, under your own OAuth app and
API quota. Credentials sit in `~/.contextly/config.json` (owner-readable only).

## Configuration reference

Storage is normally set by `contextly-auth`. Everything is overridable by env var —
see [`.env.example`](.env.example) (`CONTEXTLY_STORE`, `CONTEXTLY_DIR`, and the
Dropbox/Google token vars for CI).

## Contributing

Contributions are welcome — especially new storage backends. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the layout, the store interface, and how to
add one.

## License

Contextly is **source-available** under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — not an OSI "open source" license.

- **Free** for personal use, study, hobby projects, research, and nonprofits /
  schools / governments.
- **Commercial or business use requires a separate license.** Contact
  **mehdi.merai@gmail.com**.
