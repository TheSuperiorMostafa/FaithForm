import type { IceServerConfig } from "@/lib/stream/browser-publish";

export function getBrowserIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [
    { urls: "stun:stun.l.google.com:19302" },
  ];

  const relayHost =
    process.env.NEXT_PUBLIC_STREAM_RELAY_HOST?.trim() ||
    process.env.STREAM_RELAY_HOST?.trim() ||
    "stream.faithform.io";

  servers.push({ urls: `stun:${relayHost}:3478` });

  const turnUrl = process.env.STREAM_TURN_URL?.trim();
  const turnUsername = process.env.STREAM_TURN_USERNAME?.trim();
  const turnCredential = process.env.STREAM_TURN_CREDENTIAL?.trim();

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}
