# FaithForm streaming PC agent

Runs on the church computer that has OBS open. FaithForm sends **Go Live** / **End stream** commands to this agent.

## Requirements

- OBS Studio 28+ with WebSocket server enabled (`Tools → WebSocket Server Settings`)
- Node.js 18+

## One-time pairing

1. In FaithForm, open **Live Streaming → Pair streaming PC**
2. Copy the 6-digit code
3. On the streaming PC:

```bash
cd infra/stream-agent
npm install
FAITHFORM_PAIRING_CODE=123456 npm start
```

The agent saves `.faithform-agent.json` locally and keeps polling FaithForm.

## Run every Sunday

```bash
cd infra/stream-agent
npm start
```

Open OBS first, then start the agent. When an admin clicks **Go Live** in FaithForm, the agent configures OBS and starts streaming.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `FAITHFORM_APP_URL` | `https://faithform.io` | FaithForm API base URL |
| `FAITHFORM_PAIRING_CODE` | — | One-time pairing code from dashboard |
| `OBS_WEBSOCKET_HOST` | `127.0.0.1` | OBS WebSocket host |
| `OBS_WEBSOCKET_PORT` | `4455` | OBS WebSocket port |
| `OBS_WEBSOCKET_PASSWORD` | empty | OBS WebSocket password |
| `FAITHFORM_POLL_MS` | `3000` | Poll interval in ms |

## Production checklist

1. Apply DB migration: `pnpm db:stream-production`
2. Deploy FaithForm app
3. Pair the streaming PC
4. Connect YouTube and Facebook on the Live Streaming page
5. Click **Go Live** — platforms are provisioned fresh, OBS starts automatically

If no streaming PC is paired, **Go Live** still provisions platforms; an operator must start OBS/ATEM manually with the encoder settings shown on the page.
