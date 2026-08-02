export type StudioLayout = "camera" | "screen" | "screenWithCamera";

export type PipCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type StudioBranding = {
  logoUrl: string | null;
  churchName: string;
  primaryColor: string;
};

type DrawRect = { x: number; y: number; w: number; h: number };

/** A canvas capture track can be asked for frames explicitly. */
type CanvasCaptureTrack = MediaStreamTrack & { requestFrame?: () => void };

/**
 * Resolutions the studio may open at, best first.
 *
 * Chosen once, before the recorder starts, and then never changed. Resizing a
 * canvas that is being captured changes the dimensions of the live video track,
 * and a MediaRecorder is not obliged to survive that — so the canvas is fixed
 * for the life of the broadcast and load is shed by other means.
 */
const OUTPUT_PRESETS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
] as const;

/**
 * Load-shedding ladder, applied without touching the canvas size.
 *
 * Frame rate only. A canvas capture track emits a frame when the canvas is drawn
 * to, so a redraw we skip produces no frame at all rather than a duplicate one —
 * throttling redraws is a genuine cut in output. It matters because a
 * MediaRecorder's bitrate cannot be changed once it has started, so this is the
 * only lever left mid-broadcast.
 */
const SHED_LEVELS = [
  { fps: 30 },
  { fps: 20 },
  { fps: 15 },
  { fps: 12 },
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
  private clockWorker: Worker | null = null;
  private captureTrack: CanvasCaptureTrack | null = null;
  private framesDrawn = 0;

  private maxWidth: number | null = null;

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

    const presets = this.maxWidth
      ? OUTPUT_PRESETS.filter((p) => p.width <= this.maxWidth!)
      : OUTPUT_PRESETS;

    for (const preset of presets.length ? presets : [OUTPUT_PRESETS[OUTPUT_PRESETS.length - 1]]) {
      try {
        this.levelIndex = 0;
        this.width = preset.width;
        this.height = preset.height;
        this.fps = SHED_LEVELS[0].fps;

        this.canvas.width = preset.width;
        this.canvas.height = preset.height;

        // Captured at 0 fps, which means "produce a frame only when asked".
        // Rate-driven capture is fed by the browser's compositor, and a canvas
        // that is not being composited — a page in the background — yields no
        // frames however diligently it is drawn to. That is why a broadcast kept
        // reporting itself as recording, with a live track and an empty send
        // queue, while producing nothing at all. Asking for each frame
        // explicitly takes the compositor out of the path.
        const manual = this.canvas.captureStream(0);
        const [candidate] = manual.getVideoTracks();
        const capture = candidate as CanvasCaptureTrack | undefined;

        if (capture && typeof capture.requestFrame === "function") {
          this.captureTrack = capture;
          this.outputStream = manual;
        } else {
          // No manual capture available; fall back to the rate-driven track,
          // which works while the page is in front.
          for (const t of manual.getTracks()) t.stop();
          this.captureTrack = null;
          this.outputStream = this.canvas.captureStream(SHED_LEVELS[0].fps);
        }
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
    this.framesDrawn = 0;
    this.startClock();
    return this.outputStream;
  }

  stop(): void {
    this.running = false;
    this.stopClock();
    this.captureTrack = null;
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

  /**
   * Ticks the render loop from a worker rather than requestAnimationFrame.
   *
   * A canvas capture track only emits a frame when the canvas is actually
   * drawn to, and requestAnimationFrame stops firing when the tab is not
   * visible. So the moment an operator switched to another tab — to check the
   * stream on YouTube, say — redraws stopped, the capture produced no frames,
   * the recorder had nothing to encode, and the broadcast went silent while
   * still reporting itself as recording with an empty send queue and a live
   * track. That is precisely what the diagnostics showed.
   *
   * Worker timers are not throttled the way main-thread animation callbacks
   * are, so the tick keeps arriving and the main thread keeps drawing.
   */
  private startClock(): void {
    const interval = Math.max(1, Math.round(1000 / this.fps));

    if (this.clockWorker) {
      this.clockWorker.postMessage({ interval });
      return;
    }

    try {
      const source =
        "let id=null;onmessage=e=>{" +
        "if(id!==null){clearInterval(id);id=null;}" +
        "if(e.data&&e.data.stop)return;" +
        "id=setInterval(()=>postMessage(0),e.data.interval);};";
      const url = URL.createObjectURL(
        new Blob([source], { type: "application/javascript" }),
      );
      this.clockWorker = new Worker(url);
      URL.revokeObjectURL(url);
      this.clockWorker.onmessage = () => this.tick();
      this.clockWorker.postMessage({ interval });
    } catch {
      // No worker available — fall back to the old behaviour, which at least
      // works while the tab is in front.
      this.clockWorker = null;
      this.scheduleFrame();
    }
  }

  private stopClock(): void {
    if (this.clockWorker) {
      this.clockWorker.postMessage({ stop: true });
      this.clockWorker.terminate();
      this.clockWorker = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick(): void {
    if (!this.running) return;

    const start = performance.now();

    // Honour the current rung's frame rate. A redraw we skip produces no frame
    // at all — the capture track only emits on canvas modification — so this is
    // a genuine reduction in output, which is what makes it the shedding lever.
    const interval = 1000 / this.fps;
    if (start - this.lastDrawAt < interval - 1) return;
    this.lastDrawAt = start;

    this.drawFrame();
    // Explicit capture: the drawn pixels become a frame now, rather than
    // whenever the compositor next gets around to the canvas.
    this.captureTrack?.requestFrame?.();
    this.framesDrawn += 1;

    const elapsed = performance.now() - start;
    if (elapsed > interval * 1.5) {
      this.missedFrames += 1;
      if (this.missedFrames >= 3 && this.shedQuality()) {
        this.startClock();
      }
    } else {
      this.missedFrames = 0;
    }
  }

  /** Fallback loop for browsers without workers. Throttled when hidden. */
  private scheduleFrame(): void {
    if (!this.running) return;
    this.tick();
    this.rafId = requestAnimationFrame(() => this.scheduleFrame());
  }

  /**
   * Caps the opening resolution. Must be called before start().
   *
   * Set from the measured uplink, because the encoder's bitrate target is only
   * a hint — a 1080p canvas full of detail overshoots it badly, and the only
   * reliable way to hold the rate down is to give the encoder less to encode.
   */
  setMaxWidth(width: number | null): void {
    this.maxWidth = width;
  }

  /**
   * Steps down one rung of the shedding ladder. Returns false at the bottom.
   *
   * Deliberately never touches canvas.width/height: that would change the
   * dimensions of the live track the MediaRecorder is mid-recording, which is
   * not something a recorder is obliged to survive. Only redraw rate and
   * internal render scale move, so the track is untouched and the picture just
   * softens.
   */
  shedQuality(): boolean {
    if (!this.outputStream) return false;
    if (this.levelIndex >= SHED_LEVELS.length - 1) return false;

    this.levelIndex += 1;
    const next = SHED_LEVELS[this.levelIndex];
    this.fps = next.fps;
    this.missedFrames = 0;
    if (this.clockWorker) this.startClock();
    return true;
  }

  /**
   * Resolution and frame rate the broadcast is opening at, for the relay to
   * scale to. Read once, immediately after start().
   */
  getOutputSettings(): { width: number; height: number; fps: number } {
    return { width: this.width, height: this.height, fps: SHED_LEVELS[0].fps };
  }

  getQualityLevel(): number {
    return this.levelIndex;
  }

  /** Frames handed to the capture track. Diagnostics only. */
  getFramesDrawn(): number {
    return this.framesDrawn;
  }

  /** Whether frames are being requested explicitly rather than by the compositor. */
  isManualCapture(): boolean {
    return this.captureTrack !== null;
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
