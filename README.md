# Datto BCDR MCP Server

[![Release](https://github.com/WYRE-AI/datto-bcdr-mcp/actions/workflows/release.yml/badge.svg)](https://github.com/WYRE-AI/datto-bcdr-mcp/actions/workflows/release.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Model Context Protocol (MCP) server for the Datto BCDR (Backup Portal) API.
Exposes SIRIS / Alto appliances, protected agents, recovery points, screenshot
verifications, off-site sync status, alerts, and activity logs to AI assistants.

## Tools

| Tool | Description |
|------|-------------|
| `datto_bcdr_list_devices` | List all SIRIS/Alto appliances in the partner portal |
| `datto_bcdr_get_device` | Get appliance details by `serialNumber` (renders as an interactive card in MCP Apps hosts) |
| `datto_bcdr_list_assets` | List protected agents on an appliance |
| `datto_bcdr_get_asset` | Get a specific protected agent |
| `datto_bcdr_list_backups` | List recovery points for an agent |
| `datto_bcdr_list_screenshots` | List screenshot verifications for an agent |
| `datto_bcdr_get_screenshot` | Fetch a screenshot PNG (returned as base64 image content) |
| `datto_bcdr_get_offsite_status` | Off-site sync status for an appliance |
| `datto_bcdr_list_alerts` | Portal alerts (date-range filtered) |
| `datto_bcdr_list_activity` | Activity log (date-range filtered) |

When the user omits required filters (date range, serial number, etc.) the
server uses MCP elicitation to prompt for them.

## Features

- **Interactive Device Card (MCP Apps, SEP-1865)**: `datto_bcdr_get_device`
  renders as a read-only interactive card in MCP Apps hosts (Claude
  Desktop/web) showing the appliance's backup status at a glance — neutral by
  default, brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env
  vars; plain-JSON behavior is unchanged in other hosts. Edit `ui/` and run
  `npm run build:ui` to regenerate the embedded card bundle.

## Configuration

Copy [`.env.example`](.env.example) and set the variables below. The stdio
transport reads `DATTO_BCDR_*` and is not affected by HTTP service-to-service
auth.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATTO_BCDR_PUBLIC_KEY` | For stdio and `AUTH_MODE=env` | Datto BCDR partner portal public key |
| `DATTO_BCDR_PRIVATE_KEY` | For stdio and `AUTH_MODE=env` | Datto BCDR partner portal private key (secret) |
| `DATTO_BCDR_REGION` | No | `us` (default) or `eu` |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `AUTH_MODE` | No | `gateway` (Docker image and Compose default) or `env`. Gateway mode requires `X-Datto-BCDR-Public-Key` and `X-Datto-BCDR-Private-Key` on each `/mcp` request and never falls back to `DATTO_BCDR_*`. `env` uses those variables only after S2S auth succeeds. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | Service-to-service secret. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`replace-with-a-real-secret`, `your-s2s-secret`, `your-secret`, `changeme`, `change-me`, `placeholder`, `secret`, `example`, `replace-me`, `s2s-secret`). Compose will not start without it. Never commit a real value. Generate one with `openssl rand -hex 32`. The value is never logged. |
| `MCP_ALLOW_INSECURE_DEV` | No | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning and does not enforce `X-Gateway-S2S`. The listener is forced to `127.0.0.1`. A non-loopback `MCP_HTTP_HOST` (including `0.0.0.0`) refuses to start. A known placeholder secret still refuses to start. |
| `MCP_HTTP_HOST` | No | Bind address when `MCP_TRANSPORT=http`. Defaults to `127.0.0.1`. A configured `CONDUIT_S2S_SECRET` honors this value. The container image sets `0.0.0.0`. |
| `MCP_HTTP_PORT` | No | HTTP port. Defaults to `8080`. |

`/health` stays unauthenticated and does not read credentials.

### HTTP authentication

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. A missing or invalid header returns 401 before vendor credentials are read.

The header value is `t=<unix seconds>,v1=<hex hmac-sha256>`. The signed message is the ASCII string `t=<unix seconds>` (the same timestamp prefix), and the HMAC key is `CONDUIT_S2S_SECRET`. Timestamps more than 300 seconds from the server clock are rejected.

```js
import { createHmac } from "node:crypto";

const t = Math.floor(Date.now() / 1000);
const v1 = createHmac("sha256", process.env.CONDUIT_S2S_SECRET).update(`t=${t}`).digest("hex");
const xGatewayS2s = `t=${t},v1=${v1}`;
```

In `AUTH_MODE=gateway`, `/mcp` also requires `X-Datto-BCDR-Public-Key` and `X-Datto-BCDR-Private-Key` (`X-Datto-BCDR-Region` is optional). Those headers are the only credential source for that request. A request missing either key returns 401 and does not fall back to `DATTO_BCDR_PUBLIC_KEY` / `DATTO_BCDR_PRIVATE_KEY`. Each request creates a fresh server instance with isolated credentials.

The WYRE MCP Gateway signs `X-Gateway-S2S` with the per-vendor subkey provisioned as `CONDUIT_S2S_SECRET` and injects the Datto headers:

```js
await fetch("http://gateway:8080/mcp", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-gateway-s2s": xGatewayS2s,
    "x-datto-bcdr-public-key": publicKey,
    "x-datto-bcdr-private-key": privateKey,
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
```

## Local development

```bash
npm install
npm run build
DATTO_BCDR_PUBLIC_KEY=... DATTO_BCDR_PRIVATE_KEY=... npm start
```

HTTP refuses to start until `CONDUIT_S2S_SECRET` is set:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" MCP_TRANSPORT=http npm start
curl http://127.0.0.1:8080/health
```

Local HTTP without a service-to-service secret is development-only. It binds `127.0.0.1` only and logs a warning. A non-loopback `MCP_HTTP_HOST` makes startup exit. The container image sets `MCP_HTTP_HOST=0.0.0.0`, so this bypass also needs `-e MCP_HTTP_HOST=127.0.0.1` when using the image:

```bash
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 npm start
```

## Docker

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the S2S secret. In gateway mode, Datto credentials arrive on each request as headers; they are not read from the environment.

```bash
docker build -t datto-bcdr-mcp .
docker run --rm \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  datto-bcdr-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset or empty, sets `AUTH_MODE=gateway`, publishes `127.0.0.1:8080:8080`, and does not inject `DATTO_BCDR_PUBLIC_KEY` or `DATTO_BCDR_PRIVATE_KEY`:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `DATTO_BCDR_PUBLIC_KEY` and `DATTO_BCDR_PRIVATE_KEY`:

```bash
docker run --rm \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e DATTO_BCDR_PUBLIC_KEY=your-value \
  -e DATTO_BCDR_PRIVATE_KEY=your-value \
  -p 127.0.0.1:8080:8080 \
  datto-bcdr-mcp
```

## License

Apache-2.0
