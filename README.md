# Beeper Auto-Reply

An AI bot that keeps your conversations going and replies to your messages on WhatsApp, Telegram and the other apps Beeper connects. It runs 24/7 on a free cloud server, and you control it from your iPhone with a web page you add to your Home Screen.

**Two modes, per chat or as the default:**

- **Approve before send** (default): the AI writes a draft. You tap **Send**, **Edit** or **Reject** on the control page, or answer in your Beeper **Note to self** chat (`ok ab12`, `no ab12`, `edit ab12 new text`).
- **Fully automatic**: the reply goes out by itself after a human-like delay, within rate limits.

```
 iPhone (Safari, Home Screen app)         One Google Cloud Always Free e2-micro (docker compose)
┌──────────────────┐   HTTPS   ┌────────────────────────────────────────────────────────┐
│ Control page     │ ────────▶ │ Caddy :443 (free cert for <ip>.sslip.io)               │
│ on/off, chats,   │           │   └▶ web/  Next.js control page (key in encrypted cookie)│
│ modes, approvals │           │        └▶ server/ worker API (private network)         │
└──────────────────┘           │             ├ Beeper Server (WhatsApp, Telegram, …)    │
        ▲                      │             └ AI: Groq (recommended) / OpenRouter / Ollama │
        │ Note to self commands└────────────────────────────────────────────────────────┘
        └─────────────── Beeper app
```

| Folder | What it is |
| --- | --- |
| [`server/`](server) | Node/TypeScript worker. It connects to the local Beeper Server (Desktop API + WebSocket), applies the allowlist, quiet hours, delays and rate limits, asks an OpenAI-compatible AI for a reply, and keeps drafts and logs. It also exposes a small authenticated control API. |
| [`web/`](web) | Next.js control page: password protected, installable as a PWA, proxies to the worker. |
| [`setup/`](setup) | **Recommended:** [`gcp-bootstrap.sh`](setup/gcp-bootstrap.sh) + [`README-gcp-phone.md`](setup/README-gcp-phone.md) for a Google Cloud Always Free e2-micro, from an iPhone. Oracle scripts are still in this folder ([`oracle-bootstrap.sh`](setup/oracle-bootstrap.sh), [`README-phone.md`](setup/README-phone.md)). |
| root | `docker-compose.yml` and `Caddyfile`: the whole stack (Caddy, web, Beeper Server, worker, optional Ollama). |

## How it works

1. **Beeper Server** is Beeper's official headless app (downloaded by `server/Dockerfile.beeper`). It runs on the VM, so WhatsApp and Telegram connect to it directly as an *on-device* connection. Chats you set up as on-device on your iPhone are **not** visible to the server, so connect the networks again on the server from the Link tab.
2. The worker subscribes to `ws://127.0.0.1:23374/v1/ws` for `message.upserted` events. For each incoming text message in an **allowed** chat it does the following:
   - waits a few seconds for follow-up messages;
   - fetches the last N messages for context;
   - builds a prompt from your persona and style plus any per-chat instructions;
   - creates a draft or schedules an automatic send.
   If you reply by hand, anything queued for that chat is cancelled. The AI can answer `[[SKIP]]` for messages that need the real you, such as money, plans or anything sensitive; then you get a notice instead of a reply.
3. **Reaching the server:** Caddy serves the control page on `https://<ip-with-dashes>.sslip.io` (or a DuckDNS name) with an automatic certificate. Only ports 80/443 are open; the worker API, Beeper Server and Ollama are not reachable from outside. The access key is checked by the worker, and wrong guesses are rate-limited per client address. The (optional) Cloudflare/ntfy rendezvous code in the repo is not used in this setup. On Google Cloud, tick **Allow HTTP traffic** and **Allow HTTPS traffic** so the `http-server` and `https-server` network tags open ports 80 and 443.
4. **Linking Beeper:** you type your Beeper email, then the emailed code, into the control page. Then you confirm the new "device" by matching emoji in the Beeper app on your iPhone, or with your recovery code. Passwords are never needed or stored. The Beeper access token stays on the VM (a Docker volume, mode 600).

## AI providers (all OpenAI-compatible)

| Provider | Cost | Notes |
| --- | --- | --- |
| [Groq](https://console.groq.com/keys) (default on the recommended 1 GB e2-micro) | free tier | fast; e.g. `openai/gpt-oss-120b`. Paste the key in Settings. |
| [OpenRouter](https://openrouter.ai/keys) | free models | `…:free` models |
| [Gemini](https://aistudio.google.com/apikey) | free tier | base URL `https://generativelanguage.googleapis.com/v1beta/openai` |
| Ollama on the VM (only if you have 8 GB+ RAM, e.g. an Oracle ARM VM) | free, open source | `qwen2.5:3b`; too large for the 1 GB e2-micro |

API keys are typed into the control page's Settings and stored only on your VM. The page only ever shows the last 4 characters.

## Safety and account-ban risk

WhatsApp bans "auto-messaging" and bulk messaging, and Meta (Instagram/Messenger) bans automated access. Beeper says heavy sending can get accounts suspended by the networks. This bot is for **personal, low-volume** use. To lower the risk:

- nothing is allowed until you allow it chat by chat;
- the default mode is approve-before-send;
- automatic replies wait 20–90 s and are capped per chat and per hour;
- quiet hours are available.

Use automatic mode at your own risk.

## Development

```bash
cd server && npm ci && npm run lint && npm test   # unit + engine + API tests
node scripts/mock-beeper.mjs                      # fake Beeper Server + fake AI for local runs
CONTROL_SECRET=dev-secret-123456 BEEPER_BASE_URL=http://127.0.0.1:23999 AI_BASE_URL=http://127.0.0.1:23998/v1 NTFY_URL=off npm start

cd web && npm ci && npm run lint && npm test && npm run build
SESSION_KEY=dev-session-key-0123456789 NTFY_URL=off VM_URL=http://127.0.0.1:8787 npm run dev
```

### Deploying

**Recommended:** follow [`setup/README-gcp-phone.md`](setup/README-gcp-phone.md) and create a Google Cloud Always Free e2-micro in `us-east1` (or `us-west1` / `us-central1`). The VM startup script is:

```
curl -fsSL https://raw.githubusercontent.com/Bobbykelvin11/beeper-autoreply/main/setup/gcp-bootstrap.sh | bash
```

Set the custom metadata key `control-secret` to your access key, and tick Allow HTTP and HTTPS traffic. A 1 GB VM cannot run Ollama; paste a free Groq key in Settings after it comes up.

The [Oracle Cloud guide](setup/README-phone.md) is still available if you already have an Oracle account.

On any Debian/Ubuntu box with Docker: create `.env` from `.env.example`, then `docker compose up -d --build`. `setup/smoke-test.sh` runs the whole stack with a self-signed certificate (CI does this).

### Control API (VM, `Authorization: Bearer <CONTROL_SECRET>`)

```
GET  /api/ping (no auth)                GET  /api/status
GET|PUT /api/settings                   GET  /api/chats[?refresh=1]     PUT /api/chats/:id {allowed,mode,instructions}
GET  /api/drafts[?all=1]                POST /api/drafts/:id/send {text?}   POST /api/drafts/:id/reject
GET  /api/logs                          POST /api/test-ai {text}
GET  /api/link/state                    POST /api/link/email {email}    POST /api/link/code {setupRequestID,code[,username,acceptTerms]}
POST /api/link/verify                   POST /api/link/verify/:id/(accept|sas.start|sas.confirm|cancel)
POST /api/link/recovery-key {recoveryKey}
GET  /api/accounts  GET /api/bridges    GET /api/bridges/:id/flows      POST /api/bridges/:id/login {flowID?}
GET  /api/bridges/:id/login/:sid        POST /api/bridges/:id/login/:sid/steps/:step {type,fields}   DELETE /api/bridges/:id/login/:sid
```

MIT licensed. Not affiliated with Beeper or Automattic.
