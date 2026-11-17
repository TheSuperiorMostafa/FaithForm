# FaithForm streaming PC agent

This optional agent runs on the church computer that has OBS open. It receives **Go Live** and **End stream** commands from the FaithForm dashboard. To start and stop from the encoder itself, configure the church’s permanent stream key in **Live Streaming → Setup** and enable **Go live from your equipment**.

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

The agent saves `.faithform-agent.json` locally and keeps polling FaithForm. It also listens for OBS's confirmed streaming stop event, so stopping OBS directly or through a remote control ends the current paired FaithForm service. A temporary reconnect does not end the service.

## Run every Sunday

```bash
cd infra/stream-agent
npm start
```

Open OBS first, then start the agent. When an admin clicks **Go Live** in FaithForm, the agent configures OBS and starts streaming.

## Update an existing agent

Deploy the FaithForm app first, then copy the entire `infra/stream-agent/` directory to the streaming computer, including `faithform-stream-agent.mjs`, `obs-stream-state.mjs`, and `package.json`. Keep the computer's existing `.faithform-agent.json` pairing file. Stop the old agent process and run `npm install` followed by `npm start` from that directory. Copying only the main script leaves its stop-event listener missing.

Confirmed OBS stops end services controlled through that paired computer immediately. Services started with the church's permanent key (including ATEM) use the relay's signed disconnect signal and 60-second reconnect grace period; the reconciler then ends the service on its next run.

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
