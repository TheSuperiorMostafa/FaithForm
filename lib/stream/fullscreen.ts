type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

export function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export async function exitDocumentFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (doc.fullscreenElement) {
    await doc.exitFullscreen().catch(() => null);
    return;
  }
  doc.webkitExitFullscreen?.();
}

export async function enterElementFullscreen(element: HTMLElement): Promise<boolean> {
  const el = element as FullscreenElement;

  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return true;
  }

  if (el.webkitRequestFullscreen) {
    await el.webkitRequestFullscreen();
    return true;
  }

  return false;
}

export function enterVideoFullscreen(video: HTMLVideoElement): boolean {
  const el = video as FullscreenVideo;

  if (el.webkitEnterFullscreen && el.webkitSupportsFullscreen !== false) {
    el.webkitEnterFullscreen();
    return true;
  }

  return false;
}

export async function togglePlayerFullscreen(options: {
  container: HTMLElement;
  video: HTMLVideoElement | null;
}): Promise<void> {
  if (getFullscreenElement()) {
    await exitDocumentFullscreen();
    return;
  }

  try {
    const entered = await enterElementFullscreen(options.container);
    if (entered) return;
  } catch {
    // Fall through to video-native fullscreen (iOS).
  }

  if (options.video && enterVideoFullscreen(options.video)) {
    return;
  }

  if (options.video) {
    try {
      await enterElementFullscreen(options.video);
    } catch {
      // Browser blocked or unsupported.
    }
  }
}

export function subscribeFullscreenChange(onChange: () => void): () => void {
  const handler = () => onChange();
  document.addEventListener("fullscreenchange", handler);
  document.addEventListener("webkitfullscreenchange", handler);
  return () => {
    document.removeEventListener("fullscreenchange", handler);
    document.removeEventListener("webkitfullscreenchange", handler);
  };
}

export function isElementFullscreen(element: HTMLElement | null): boolean {
  if (!element) return false;
  const active = getFullscreenElement();
  return active === element || active === element.querySelector("video");
}
