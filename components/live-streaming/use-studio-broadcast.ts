"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getCameraStream,
  getScreenStream,
  publishViaWhip,
  stopMediaStream,
} from "@/lib/stream/browser-publish";
import { publishViaWebSocket } from "@/lib/stream/browser-publish-ws";
import {
  StudioCompositor,
  type PipCorner,
  type StudioBranding,
  type StudioLayout,
} from "@/lib/stream/studio-compositor";

export type { StudioLayout, PipCorner, StudioBranding };

export function useStudioBroadcast(branding: StudioBranding) {
  const [layout, setLayoutState] = useState<StudioLayout>("camera");
  const [pipCorner, setPipCornerState] = useState<PipCorner>("bottom-right");
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [videoBitrate, setVideoBitrate] = useState<number | null>(null);
  const [reducedQuality, setReducedQuality] = useState(false);

  const compositorRef = useRef<StudioCompositor | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const stopIngestRef = useRef<(() => void) | null>(null);
  const whipLocationRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);
  const brandingRef = useRef(branding);
  // One warning per broadcast. Quality can step down several times on a bad
  // connection, and a toast per rung would bury the operator mid-service.
  const warnedAboutQualityRef = useRef(false);

  useEffect(() => {
    brandingRef.current = branding;
    compositorRef.current?.setBranding(branding);
  }, [branding]);

  const stopMicMeter = useCallback(() => {
    if (micRafRef.current !== null) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    void audioContextRef.current?.close().catch(() => null);
    audioContextRef.current = null;
    analyserRef.current = null;
    setMicLevel(0);
  }, []);

  const startMicMeter = useCallback((stream: MediaStream) => {
    stopMicMeter();
    const track = stream.getAudioTracks()[0];
    if (!track) return;

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          sum += data[i] ?? 0;
        }
        const avg = sum / data.length / 255;
        setMicLevel(avg);
        micRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Mic meter is optional.
    }
  }, [stopMicMeter]);

  const stopScreenVideoOnly = useCallback(() => {
    const screen = screenStreamRef.current;
    if (!screen) return;
    for (const track of screen.getVideoTracks()) {
      track.stop();
    }
    screenStreamRef.current = null;
    void compositorRef.current?.setScreenStream(null);
  }, []);

  const stopStudio = useCallback(() => {
    stopIngestRef.current?.();
    stopIngestRef.current = null;
    if (whipLocationRef.current) {
      void fetch("/api/stream/whip", {
        method: "DELETE",
        headers: { Location: whipLocationRef.current },
      }).catch(() => null);
      whipLocationRef.current = null;
    }

    compositorRef.current?.stop();
    compositorRef.current = null;

    stopMediaStream(cameraStreamRef.current);
    stopMediaStream(screenStreamRef.current);
    cameraStreamRef.current = null;
    screenStreamRef.current = null;

    stopMicMeter();
    setOutputStream(null);
    setIsLive(false);
    setLayoutState("camera");
    setPublishing(false);
    setVideoBitrate(null);
    setReducedQuality(false);
    warnedAboutQualityRef.current = false;
  }, [stopMicMeter]);

  const connectIngest = useCallback(async (
    stream: MediaStream,
    output: { width: number; height: number; fps: number },
  ) => {
    const configRes = await fetch("/api/stream/browser-publish", {
      cache: "no-store",
    });
    if (!configRes.ok) {
      throw new Error("Could not load browser publish settings.");
    }

    const config = (await configRes.json()) as {
      method?: "websocket" | "whip";
      wsIngestUrl?: string | null;
      whipUrl: string;
      iceServers: RTCIceServer[];
    };

    if (config.method === "websocket" && config.wsIngestUrl) {
      const handle = await publishViaWebSocket(config.wsIngestUrl, stream, {
        output,
        onCongestion: () => {
          const shed = compositorRef.current?.shedQuality() ?? false;
          if (shed && !warnedAboutQualityRef.current) {
            warnedAboutQualityRef.current = true;
            toast.warning(
              "Your connection slowed down, so the stream quality was reduced. " +
                "The broadcast is still going out.",
            );
          }
          setReducedQuality(true);
          return shed;
        },
        shedLevel: () => compositorRef.current?.getQualityLevel() ?? 0,
        onFatal: (message) => {
          // The uplink could not carry even the lowest quality. Surface it and
          // reset the studio rather than leaving the UI showing a dead "live".
          toast.error(message);
          stopStudio();
        },
      });
      stopIngestRef.current = handle.stop;
      setVideoBitrate(handle.videoBitsPerSecond);
    } else {
      const { stop: stopWhip, location } = await publishViaWhip(
        config.whipUrl,
        stream,
        config.iceServers,
      );
      stopIngestRef.current = stopWhip;
      whipLocationRef.current = location;
    }
  }, [stopStudio]);

  const ensureScreenStream = useCallback(async (): Promise<MediaStream> => {
    if (screenStreamRef.current?.getVideoTracks().some((t) => t.readyState === "live")) {
      return screenStreamRef.current;
    }

    const stream = await getScreenStream();
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      stopMediaStream(stream);
      throw new Error("Could not capture screen.");
    }

    videoTrack.addEventListener("ended", () => {
      stopScreenVideoOnly();
      if (compositorRef.current?.getLayout() !== "camera") {
        compositorRef.current?.setLayout("camera");
        setLayoutState("camera");
        toast.info("Screen share ended — switched to camera.");
      }
    });

    for (const track of stream.getAudioTracks()) {
      track.stop();
    }

    screenStreamRef.current = new MediaStream([videoTrack]);
    await compositorRef.current?.setScreenStream(screenStreamRef.current);
    return screenStreamRef.current;
  }, [stopScreenVideoOnly]);

  const startStudio = useCallback(async () => {
    if (!navigator.mediaDevices) {
      toast.error("Your browser does not support camera capture.");
      return;
    }

    if (isLive) return;

    try {
      setPublishing(true);
      const camera = await getCameraStream();
      cameraStreamRef.current = camera;
      startMicMeter(camera);

      const compositor = new StudioCompositor();
      compositor.setBranding(brandingRef.current);
      compositor.setLayout("camera");
      compositor.setPipCorner("bottom-right");
      await compositor.setCameraStream(camera);
      const out = compositor.start();
      compositorRef.current = compositor;

      await connectIngest(out, compositor.getOutputSettings());
      setOutputStream(out);
      setLayoutState("camera");
      setPipCornerState("bottom-right");
      setIsLive(true);
      toast.success("Studio started.");
    } catch (error) {
      stopStudio();
      toast.error(
        error instanceof Error ? error.message : "Could not start studio.",
      );
    } finally {
      setPublishing(false);
    }
  }, [connectIngest, isLive, startMicMeter, stopStudio]);

  const switchLayout = useCallback(
    async (next: StudioLayout) => {
      if (!isLive || !compositorRef.current) return;

      try {
        setPublishing(true);

        if (next === "screen" || next === "screenWithCamera") {
          await ensureScreenStream();
        }

        if (next === "camera") {
          stopScreenVideoOnly();
        }

        compositorRef.current.setLayout(next);
        setLayoutState(next);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not switch layout.",
        );
      } finally {
        setPublishing(false);
      }
    },
    [ensureScreenStream, isLive, stopScreenVideoOnly],
  );

  const setPipCorner = useCallback(
    (corner: PipCorner) => {
      if (!compositorRef.current) return;
      compositorRef.current.setPipCorner(corner);
      setPipCornerState(corner);
    },
    [],
  );

  useEffect(() => () => stopStudio(), [stopStudio]);

  return {
    layout,
    pipCorner,
    outputStream,
    isLive,
    publishing,
    micLevel,
    videoBitrate,
    reducedQuality,
    startStudio,
    stopStudio,
    switchLayout,
    setPipCorner,
  };
}
