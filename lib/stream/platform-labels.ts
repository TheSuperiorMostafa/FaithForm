export type StreamPlatform = "youtube" | "facebook";

const PLATFORM_LABELS: Record<StreamPlatform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
};

export function getConnectedPlatforms(input: {
  youtubeConnected?: boolean;
  facebookConnected?: boolean;
}): StreamPlatform[] {
  const platforms: StreamPlatform[] = [];
  if (input.youtubeConnected) platforms.push("youtube");
  if (input.facebookConnected) platforms.push("facebook");
  return platforms;
}

export function getDestinationPlatforms(
  destinations: Array<{ name: string }> | null | undefined,
): StreamPlatform[] {
  const platforms: StreamPlatform[] = [];
  for (const destination of destinations ?? []) {
    if (destination.name === "youtube" || destination.name === "facebook") {
      if (!platforms.includes(destination.name)) {
        platforms.push(destination.name);
      }
    }
  }
  return platforms;
}

export function formatPlatformList(platforms: StreamPlatform[]): string {
  const labels = platforms.map((platform) => PLATFORM_LABELS[platform]);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}

export function formatBroadcastStatusLabel(input: {
  phase: "live" | "starting";
  destinations?: Array<{ name: string }> | null;
  youtubeConnected?: boolean;
  facebookConnected?: boolean;
}): string {
  const destinationPlatforms = getDestinationPlatforms(input.destinations);
  const platforms =
    destinationPlatforms.length > 0
      ? destinationPlatforms
      : getConnectedPlatforms(input);

  const platformLabel = formatPlatformList(platforms);

  if (input.phase === "starting") {
    return platformLabel ? `Going live on ${platformLabel}…` : "Going live…";
  }

  return platformLabel ? `Live on ${platformLabel}` : "Live";
}

export function formatShareStartedMessage(input: {
  destinations?: Array<{ name: string }> | null;
  youtubeConnected?: boolean;
  facebookConnected?: boolean;
}): string {
  const destinationPlatforms = getDestinationPlatforms(input.destinations);
  const platforms =
    destinationPlatforms.length > 0
      ? destinationPlatforms
      : getConnectedPlatforms(input);

  const platformLabel = formatPlatformList(platforms);
  return platformLabel ? `Sharing to ${platformLabel}…` : "Broadcast started.";
}

export function formatShareDescription(input: {
  youtubeConnected?: boolean;
  facebookConnected?: boolean;
}): string {
  const platformLabel = formatPlatformList(getConnectedPlatforms(input));
  if (platformLabel) {
    return `Press Go Live when ready to share to ${platformLabel}.`;
  }
  return "Press Go Live when ready to broadcast to your FaithForm watch page.";
}
