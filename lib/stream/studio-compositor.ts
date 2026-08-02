export type StudioLayout = "camera" | "screen" | "screenWithCamera";

export type PipCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type StudioBranding = {
  logoUrl: string | null;
  churchName: string;
  primaryColor: string;
};

type DrawRect = { x: number; y: number; w: number; h: number };

/**
 * Quality ladder, best first.
 *
 * Stepped down when the machine cannot draw fast enough, and now also when the
 * uplink cannot carry what we are producing. Dropping frame rate matters more
 * than it looks: the canvas is captured at a fixed rate, so a canvas we stop
 * redrawing yields near-identical frames, and those cost the encoder almost
 * nothing. That is what lets a constrained connection shed load without
 * restarting the recorder — which is impossible mid-stream, since a WebM
 * recording cannot change bitrate once started.
 */
const QUALITY_LEVELS = [
  { width: 1920, height: 1080, fps: 30 },
  { width: 1280, height: 720, fps: 30 },
  { width: 1280, height: 720, fps: 20 },
  { width: 960, height: 540, fps: 15 },
] as const;

const BG_COLOR = "#0a0a0a";
const PIP_WIDTH_RATIO = 0.22;
const PIP_PADDING = 24;
const PIP_RADIUS = 12;
const PIP_BORDER = 2;
const LOGO_MAX = 120;
const LOGO_PADDING = 24;

export class StudioCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameraVideo: HTMLVideoElement;
  private screenVideo: HTMLVideoElement;
  private outputStream: MediaStream | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private rafId: number | null = null;
  private running = false;
  private layout: StudioLayout = "camera";
  private pipCorner: PipCorner = "bottom-right";
  private branding: StudioBranding = {
    logoUrl: null,
    churchName: "",
    primaryColor: "#1e3a5f",
  };
  private logoImage: HTMLImageElement | null = null;
  private logoLoaded = false;
  private width = 1920;
  private height = 1080;
  private fps = 30;
  private missedFrames = 0;
  private levelIndex = 0;
  private lastDrawAt = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported.");
    this.ctx = ctx;
    this.cameraVideo = document.createElement("video");
    this.cameraVideo.muted = true;
    this.cameraVideo.playsInline = true;
    this.screenVideo = document.createElement("video");
    this.screenVideo.muted = true;
    this.screenVideo.playsInline = true;
  }

  start(): MediaStream {
    if (this.outputStream) return this.outputStream;

    for (let i = 0; i < QUALITY_LEVELS.length; i += 1) {
      const preset = QUALITY_LEVELS[i];
      try {
        this.levelIndex = i;
        this.width = preset.width;
        this.height = preset.height;
        this.fps = preset.fps;
        this.canvas.width = preset.width;
        this.canvas.height = preset.height;
        // Captured at the top of the ladder. Shedding later throttles how often
        // we redraw rather than recreating the track, so the recorder — and the
        // single continuous WebM stream it feeds — is never interrupted.
        this.outputStream = this.canvas.captureStream(QUALITY_LEVELS[0].fps);
        break;
      } catch {
        this.outputStream = null;
      }
    }

    if (!this.outputStream) {
      throw new Error("Could not start studio output stream.");
    }

    if (this.audioTrack) {
      this.outputStream.addTrack(this.audioTrack);
    }

    this.running = true;
    this.missedFrames = 0;
    this.scheduleFrame();
    return this.outputStream;
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const track of this.outputStream?.getTracks() ?? []) {
      if (track.kind === "video") track.stop();
    }
    this.outputStream = null;
  }

  getOutputStream(): MediaStream | null {
    return this.outputStream;
  }

  setMicTrack(track: MediaStreamTrack | null): void {
    if (this.audioTrack && this.outputStream) {
      this.outputStream.removeTrack(this.audioTrack);
    }
    this.audioTrack = track;
    if (track && this.outputStream && !this.outputStream.getAudioTracks().length) {
      this.outputStream.addTrack(track);
    }
  }

  async setCameraStream(stream: MediaStream | null): Promise<void> {
    if (!stream) {
      this.cameraVideo.srcObject = null;
      return;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    this.cameraVideo.srcObject = new MediaStream([videoTrack]);
    await this.cameraVideo.play().catch(() => null);
    const mic = stream.getAudioTracks()[0] ?? null;
    this.setMicTrack(mic);
  }

  async setScreenStream(stream: MediaStream | null): Promise<void> {
    if (!stream) {
      this.screenVideo.srcObject = null;
      return;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    this.screenVideo.srcObject = new MediaStream([videoTrack]);
    await this.screenVideo.play().catch(() => null);
  }

  setLayout(layout: StudioLayout): void {
    this.layout = layout;
  }

  getLayout(): StudioLayout {
    return this.layout;
  }

  setPipCorner(corner: PipCorner): void {
    this.pipCorner = corner;
  }

  getPipCorner(): PipCorner {
    return this.pipCorner;
  }

  setBranding(branding: StudioBranding): void {
    this.branding = branding;
    void this.loadLogo(branding.logoUrl);
  }

  private async loadLogo(url: string | null): Promise<void> {
    this.logoImage = null;
    this.logoLoaded = false;
    if (!url) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve) => {
      img.onload = () => {
        this.logoImage = img;
        this.logoLoaded = true;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  private scheduleFrame(): void {
    if (!this.running) return;

    const draw = () => {
      const start = performance.now();

      // Honour the current rung's frame rate. Skipping a redraw leaves the
      // canvas untouched, so the captured frame is identical to the last one and
      // costs the encoder almost nothing — this is the load-shedding lever.
      const interval = 1000 / this.fps;
      if (start - this.lastDrawAt < interval - 1) return;
      this.lastDrawAt = start;

      this.drawFrame();
      const elapsed = performance.now() - start;
      if (elapsed > interval * 1.5) {
        this.missedFrames += 1;
        if (this.missedFrames >= 3) {
          this.shedQuality();
        }
      } else {
        this.missedFrames = 0;
      }
    };

    const video = this.cameraVideo as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => {
        draw();
        this.rafId = requestAnimationFrame(() => this.scheduleFrame());
      });
    } else {
      draw();
      this.rafId = requestAnimationFrame(() => this.scheduleFrame());
    }
  }

  /**
   * Steps down one rung of the quality ladder. Returns false at the bottom.
   *
   * Called both when this machine cannot draw fast enough and when the uplink
   * cannot carry the result. Cheap and reversible-looking to the viewer: the
   * relay scales whatever arrives back to the resolution agreed at the start of
   * the broadcast, so the picture softens rather than cutting out.
   */
  shedQuality(): boolean {
    if (!this.outputStream) return false;
    if (this.levelIndex >= QUALITY_LEVELS.length - 1) return false;

    this.levelIndex += 1;
    const next = QUALITY_LEVELS[this.levelIndex];
    this.width = next.width;
    this.height = next.height;
    this.fps = next.fps;
    this.canvas.width = next.width;
    this.canvas.height = next.height;
    this.missedFrames = 0;
    return true;
  }

  /**
   * Resolution and frame rate the broadcast is opening at, for the relay to
   * scale to. Read once, immediately after start() — which may itself have
   * settled below the top rung if the browser refused to capture 1080p.
   */
  getOutputSettings(): { width: number; height: number; fps: number } {
    const level = QUALITY_LEVELS[this.levelIndex];
    return { width: level.width, height: level.height, fps: level.fps };
  }

  getQualityLevel(): number {
    return this.levelIndex;
  }

  private drawFrame(): void {
    const { ctx, width, height } = this;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    const cameraReady =
      this.cameraVideo.srcObject &&
      this.cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const screenReady =
      this.screenVideo.srcObject &&
      this.screenVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

    if (this.layout === "camera" && cameraReady) {
      this.drawContain(this.cameraVideo, { x: 0, y: 0, w: width, h: height });
    } else if (this.layout === "screen" && screenReady) {
      this.drawContain(this.screenVideo, { x: 0, y: 0, w: width, h: height });
    } else if (this.layout === "screenWithCamera") {
      if (screenReady) {
        this.drawContain(this.screenVideo, { x: 0, y: 0, w: width, h: height });
      }
      if (cameraReady) {
        this.drawPip(this.cameraVideo);
      }
    }

    this.drawBranding();
  }

  private drawContain(
    video: HTMLVideoElement,
    dest: DrawRect,
  ): void {
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const scale = Math.min(dest.w / vw, dest.h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = dest.x + (dest.w - dw) / 2;
    const dy = dest.y + (dest.h - dh) / 2;
    this.ctx.drawImage(video, dx, dy, dw, dh);
  }

  private drawPip(video: HTMLVideoElement): void {
    const pipW = this.width * PIP_WIDTH_RATIO;
    const pipH = pipW * (9 / 16);
    let x = PIP_PADDING;
    let y = PIP_PADDING;

    switch (this.pipCorner) {
      case "bottom-right":
        x = this.width - pipW - PIP_PADDING;
        y = this.height - pipH - PIP_PADDING;
        break;
      case "bottom-left":
        x = PIP_PADDING;
        y = this.height - pipH - PIP_PADDING;
        break;
      case "top-right":
        x = this.width - pipW - PIP_PADDING;
        y = PIP_PADDING;
        break;
      case "top-left":
        x = PIP_PADDING;
        y = PIP_PADDING;
        break;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    this.roundRect(x, y, pipW, pipH, PIP_RADIUS);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = PIP_BORDER;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    this.roundRect(x, y, pipW, pipH, PIP_RADIUS);
    ctx.clip();
    this.drawContain(video, { x, y, w: pipW, h: pipH });
    ctx.restore();
  }

  private drawBranding(): void {
    const { ctx, branding } = this;
    const x = LOGO_PADDING;
    const y = LOGO_PADDING;

    if (this.logoLoaded && this.logoImage) {
      const img = this.logoImage;
      const scale = Math.min(LOGO_MAX / img.width, LOGO_MAX / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;

      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      this.roundRect(x - 8, y - 8, w + 16, h + 16, 10);
      ctx.fill();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      return;
    }

    if (branding.churchName) {
      const barH = 40;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      this.roundRect(x, y, Math.min(this.width * 0.4, 360), barH, 8);
      ctx.fill();
      ctx.fillStyle = branding.primaryColor || "#fff";
      ctx.font = "600 18px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(branding.churchName, x + 14, y + barH / 2);
      ctx.restore();
    }
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
