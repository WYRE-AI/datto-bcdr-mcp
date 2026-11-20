# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Interactive device card via MCP Apps (SEP-1865).** `datto_bcdr_get_device` results now render as an interactive card in MCP Apps hosts (Claude Desktop/web, and other hosts advertising the `io.modelcontextprotocol/ui` extension) instead of a wall of JSON. The card shows the appliance hostname, model, client company, internal IP, last-seen time, registration date, and humanized uptime. It is read-only — no write actions. Non-App hosts are unaffected: the tool's JSON payload is the raw device plus a new `_card` field.
  - The renderable tool advertises the UI via `_meta` (`ui/resourceUri`, plus the nested `ui.resourceUri` form) pointing at a new `ui://datto-bcdr/device-card.html` resource served as `text/html;profile=mcp-app`. The server now declares the `resources` capability and answers `resources/list` / `resources/read` for the card.
  - The card is **neutral by default** and brandable via `window.__BRAND__` injection or `MCP_BRAND_*` environment variables (`MCP_BRAND_NAME`, `MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`, `MCP_BRAND_ACCENT_COLOR`, `MCP_BRAND_BG`, `MCP_BRAND_TEXT`), applied at serve time by replacing the card's `BRAND_INJECT` marker. No branding configured = the HTML is served unchanged and the card renders with no brand identity.
  - The card HTML is a self-contained vite single-file bundle embedded at build time (`src/generated/device-card-html.ts`, committed), so it serves identically from the stdio and Node HTTP transports.
  - The card payload builder is best-effort: a sparse or unrecognized device degrades the card (or drops it) without affecting the tool result. New contract tests in `test/mcp-apps.test.ts` drive the real server over an in-memory transport to pin the `_meta` advertisement, the `ui://` resource wire shape, and the `_card` normalization.
  - New `npm run build:ui` regenerates the embedded HTML after editing `ui/` (requires the new `vite`, `vite-plugin-singlefile`, and `@modelcontextprotocol/ext-apps` devDependencies); plain `npm run build` and CI are unaffected.

### Changed

- The MCP server factory (`createMcpServer`) moved from `src/index.ts` into a new `src/mcp-server.ts` module so tests (and future transports) can drive the real server; `src/index.ts` keeps the stdio/HTTP transport wiring. No behavior change.

### Fixed
- **The HTTP transport no longer exits on a malformed request (WYREAI-741).** The request
  target was parsed against the client-supplied `Host` header, and a value that does not parse
  (or a target such as `//`) threw inside the request listener before authentication. The
  target is now parsed against a fixed base, so `Host` is no longer consulted, and a target
  that still cannot be parsed gets a `400` JSON response while the server keeps running.

- Authentication now succeeds against the live Datto BCDR API. Bumped
  `@wyre-technology/node-datto-bcdr` to `^2.0.0`, which replaces the custom
  HMAC-SHA256 request signing with the HTTP Basic auth the API actually
  expects (public key = username, secret key = password). Previously every
  authenticated call failed with HTTP 401. Fixes #25.

### Added
- Initial scaffold of the Datto BCDR MCP server.
- Stdio + HTTP (StreamableHTTP) transports.
- Gateway-mode credential handling via `X-Datto-BCDR-Public-Key` / `X-Datto-BCDR-Private-Key` headers.
- 10 tools covering devices, assets, backups, screenshots, off-site status, alerts, and activity logs.
- Multi-stage `Dockerfile` with GitHub Packages auth via build secret.
- Semantic-release based CI release pipeline (`.github/workflows/release.yml`).
- MCPB packaging script and Smithery registry config.
