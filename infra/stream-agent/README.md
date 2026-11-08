# FaithForm streaming PC agent

This optional agent runs on the church computer that has OBS open. It receives **Go Live** and **End stream** commands from the FaithForm dashboard. To start and stop from the encoder itself, configure the church’s permanent stream key in **Live Streaming → Setup** and enable **Go live from your equipment**.

## Requirements

- OBS Studio 28+ with WebSocket server enabled (`Tools → WebSocket Server Settings`)
- Node.js 18+

## One-time pairing

1. In FaithForm, open **Live Streaming → Pair streaming PC**
2. Copy the 6-digit code
3. Download the streaming helper from FaithForm Setup on the OBS computer.
   Extract the ZIP into Downloads; it contains a `faithform-stream-agent` folder.
4. On a Mac, open Terminal and run the commands below. Replace `123456` with a
   freshly generated code. The `&&` stops if the folder or install is missing.

```bash
cd "$HOME/Downloads/faithform-stream-agent" &&
npm install &&
FAITHFORM_PAIRING_CODE=123456 npm start
```

If OBS WebSocket authentication is enabled, add
`OBS_WEBSOCKET_PASSWORD="your OBS password"` before `npm start` (on the same line
as `FAITHFORM_PAIRING_CODE`). Keep the password private.

If you saved the helper somewhere other than Downloads, use that folder in the
`cd` command. Do not run npm from your home folder.

Developers with a repository checkout can instead use
`cd /path/to/FaithForm/infra/stream-agent`.

The agent saves `.faithform-agent.json` locally and keeps polling FaithForm.

## Run every Sunday

```bash
cd "$HOME/Downloads/faithform-stream-agent" && npm start
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
