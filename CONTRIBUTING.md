# Contributing to Contextly

Thanks for your interest in improving Contextly! It's a small, dependency-light
project and contributions are welcome.

## Ground rules

- **License.** Contextly is source-available under the
  [PolyForm Noncommercial License 1.0.0](LICENSE). By submitting a contribution you
  agree it can be distributed under that same license. Commercial use of Contextly
  requires a separate license — contact mehdi.merai@gmail.com.
- **Keep it lean.** The runtime has just two dependencies
  (`@modelcontextprotocol/sdk`, `zod`) and uses the built-in `fetch` for all HTTP.
  Please avoid adding dependencies unless there's a strong reason.
- **No telemetry, no phone-home.** Contextly never talks to a server we operate.
  A user's data stays on their disk or in their own cloud account. Contributions
  must preserve this.

## Project layout

```
bin/contextly.js        stdio MCP server entry point
bin/contextly-auth.js   one-time OAuth CLI for Dropbox / Google Drive
lib.js                  the five MCP tools (backend-agnostic)
config.js               picks the storage backend + reads ~/.contextly/config.json
util.js                 slugify / date helpers
stores/format.js        shared Markdown + frontmatter (read/write) — keep all backends identical
stores/file.js          local file store (default)
stores/dropbox.js       Dropbox app-folder store
stores/gdrive.js        Google Drive store
test/smoke.js           end-to-end smoke test against the file store
docs/index.html         landing page (GitHub Pages)
```

Every store implements the same interface, and that's the key extension point:

```
list()                              -> [ { title, body, model, client, device, created, updated, size } ]
get(query)                          -> record | null
save({ title, content, model, client })
append({ title, content, model, client })
search(query)                       -> [ { title, snippet } ]
```

## Adding a new storage backend

1. Create `stores/<name>.js` exporting a class that implements the interface above.
2. Reuse `parse`, `serialize`, and `buildMeta` from
   [`stores/format.js`](stores/format.js) so your files are byte-identical to every
   other backend (this is what makes a user's library portable).
3. Wire it into [`config.js`](config.js) `resolveStore()` with a new `store` value
   and any credential lookup (env + `~/.contextly/config.json`).
4. If it needs OAuth, add a flow to [`bin/contextly-auth.js`](bin/contextly-auth.js).
5. Update the README's "Bring your own storage" section.

## Development

Requires **Node ≥ 18**.

```bash
npm install
npm test          # runs the file-store smoke test
```

Test your changes end-to-end against a real MCP client (Claude Desktop/Code or
Cursor) pointed at `bin/contextly.js`. For cloud backends, run the matching
`contextly-auth` flow with your own OAuth app and confirm files round-trip.

## Pull requests

- Keep PRs focused and describe what you changed and how you verified it.
- Match the existing code style (small modules, terse comments that explain *why*).
- Make sure `npm test` passes.

## Reporting bugs & ideas

Open a GitHub issue with steps to reproduce (and your OS / Node version for bugs).
For anything security-sensitive, email mehdi.merai@gmail.com instead of filing a
public issue.
