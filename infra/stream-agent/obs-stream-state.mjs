/** Track confirmed OBS stops against the service that was current at the event. */
export function observeObsStreamState(obs, reportStopped) {
  let sessionId = null;
  let sending = false;
  const pending = new Set();

  async function flush() {
    if (sending) return;
    sending = true;
    try {
      for (const id of pending) {
        await reportStopped(id);
        pending.delete(id);
      }
    } finally {
      sending = false;
    }
  }

  obs.on("StreamStateChanged", (event) => {
    // Reconnecting/stopping transitions can also report inactive output.
    // Only a confirmed final stop is an instruction to end the service.
    if (event.outputState !== "OBS_WEBSOCKET_OUTPUT_STOPPED" || !sessionId) return;
    pending.add(sessionId);
    void flush().catch(() => {}); // The poll loop retries transport failures.
  });

  return {
    setSession(id) { sessionId = id || null; },
    flush,
  };
}
