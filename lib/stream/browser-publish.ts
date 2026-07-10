export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export async function publishViaWhip(
  whipUrl: string,
  stream: MediaStream,
  iceServers: IceServerConfig[] = DEFAULT_ICE_SERVERS,
): Promise<{
  peerConnection: RTCPeerConnection;
  stop: () => void;
  location: string | null;
}> {
  const pc = new RTCPeerConnection({ iceServers });

  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  if (!offer.sdp) {
    throw new Error("Could not create WebRTC offer.");
  }

  const response = await fetch(whipUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: offer.sdp,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `WHIP publish failed (${response.status}).`);
  }

  const answerSdp = await response.text();
  const location = response.headers.get("Location");

  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  await waitForIceConnection(pc);

  const stop = () => {
    if (location) {
      void fetch("/api/stream/whip", {
        method: "DELETE",
        headers: { Location: location },
      }).catch(() => null);
    }
    for (const sender of pc.getSenders()) {
      sender.track?.stop();
    }
    pc.close();
  };

  return { peerConnection: pc, stop, location };
}

export async function getCameraStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
}

export async function getScreenStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: true,
  });
}

export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function waitForIceConnection(pc: RTCPeerConnection, timeoutMs = 20_000): Promise<void> {
  if (
    pc.iceConnectionState === "connected" ||
    pc.iceConnectionState === "completed"
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Could not connect to the stream relay. Check your network and try again.",
        ),
      );
    }, timeoutMs);

    const onStateChange = () => {
      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        cleanup();
        resolve();
        return;
      }

      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        cleanup();
        reject(new Error("WebRTC connection to the relay failed."));
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      pc.removeEventListener("iceconnectionstatechange", onStateChange);
    };

    pc.addEventListener("iceconnectionstatechange", onStateChange);
  });
}
