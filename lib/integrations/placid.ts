export type PlacidLayerValue = {
  text?: string;
  image?: string;
  hide?: boolean;
  color?: string;
};

export type RenderSocialGraphicInput = {
  templateUuid: string;
  layers: Record<string, PlacidLayerValue>;
  width?: number;
  height?: number;
};

export type RenderSocialGraphicResult = {
  imageUrl: string;
  imageBytes: ArrayBuffer;
  usedPlacid: true;
};

const PLACID_API = "https://api.placid.app/api/rest";
const POLL_INTERVAL_MS = 800;
const MAX_POLL_ATTEMPTS = 30;

function getPlacidToken(): string | null {
  return process.env.PLACID_API_TOKEN?.trim() || null;
}

export function isPlacidConfigured(): boolean {
  return Boolean(getPlacidToken());
}

type PlacidImageResponse = {
  id?: number | string;
  status?: string;
  image_url?: string | null;
  polling_url?: string | null;
  error?: { message?: string };
};

async function pollPlacidImage(
  pollingUrl: string,
  token: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const res = await fetch(pollingUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Placid polling failed (${res.status})`);
    }

    const data = (await res.json()) as PlacidImageResponse;

    if (data.status === "finished" && data.image_url) {
      return data.image_url;
    }

    if (data.status === "error") {
      throw new Error(data.error?.message ?? "Placid image generation failed");
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Placid image generation timed out");
}

async function downloadImage(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download Placid image (${res.status})`);
  }
  return res.arrayBuffer();
}

export async function renderSocialGraphic(
  input: RenderSocialGraphicInput,
): Promise<RenderSocialGraphicResult> {
  const token = getPlacidToken();
  if (!token) {
    throw new Error("Placid is not configured (PLACID_API_TOKEN missing)");
  }

  if (!input.templateUuid.trim()) {
    throw new Error("Placid template UUID is required");
  }

  const res = await fetch(`${PLACID_API}/${input.templateUuid}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      create_now: true,
      layers: input.layers,
      modifications: {
        width: input.width ?? 1200,
        height: input.height ?? 630,
        filename: "announcement.png",
        image_format: "png",
      },
    }),
  });

  const data = (await res.json()) as PlacidImageResponse;

  if (!res.ok) {
    throw new Error(data.error?.message ?? `Placid request failed (${res.status})`);
  }

  let imageUrl = data.image_url ?? null;

  if (!imageUrl && data.polling_url) {
    imageUrl = await pollPlacidImage(data.polling_url, token);
  }

  if (!imageUrl) {
    throw new Error("Placid did not return an image URL");
  }

  const imageBytes = await downloadImage(imageUrl);

  return {
    imageUrl,
    imageBytes,
    usedPlacid: true,
  };
}

export function resolvePlacidTemplateUuidFromEnv(
  templateKey: string,
): string | null {
  const envKey = `PLACID_TEMPLATE_${templateKey.toUpperCase().replace(/-/g, "_")}`;
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;

  if (templateKey === "general") {
    return process.env.PLACID_TEMPLATE_GENERAL?.trim() || null;
  }

  return null;
}
