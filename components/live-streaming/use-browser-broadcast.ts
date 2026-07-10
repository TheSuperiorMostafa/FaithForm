"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getCameraStream,
  getScreenStream,
  publishViaWhip,
  stopMediaStream,
} from "@/lib/stream/browser-publish";
import { publishViaWebSocket } from "@/lib/stream/browser-publish-ws";

export type BrowserSource = "camera" | "screen" | null;

export function useBrowserBroadcast() {
  const [source, setSource] = useState<BrowserSource>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [publishing, setPublishing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const stopWhipRef = useRef<(() => void) | null>(null);
  const whipLocationRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    stopWhipRef.current?.();
    stopWhipRef.current = null;
    if (whipLocationRef.current) {
      void fetch("/api/stream/whip", {
        method: "DELETE",
        headers: { Location: whipLocationRef.current },
      }).catch(() => null);
      whipLocationRef.current = null;
    }
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    setLocalStream(null);
    setSource(null);
    setPublishing(false);
  }, []);

  const start = useCallback(async (mode: "camera" | "screen") => {
    if (!navigator.mediaDevices) {
      toast.error("Your browser does not support camera or screen capture.");
      return;
    }

    stop();

    try {
      setPublishing(true);
      const stream =
        mode === "camera" ? await getCameraStream() : await getScreenStream();

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stop();
      });

      streamRef.current = stream;
      setLocalStream(stream);
      setSource(mode);

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
        const { stop: stopIngest } = await publishViaWebSocket(
          config.wsIngestUrl,
          stream,
        );
        stopWhipRef.current = stopIngest;
      } else {
        const { stop: stopWhip, location } = await publishViaWhip(
          config.whipUrl,
          stream,
          config.iceServers,
        );
        stopWhipRef.current = stopWhip;
        whipLocationRef.current = location;
      }
      toast.success(
        mode === "camera"
          ? "Camera preview started."
          : "Screen share started.",
      );
    } catch (error) {
      stop();
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not access camera or screen.",
      );
    } finally {
      setPublishing(false);
    }
  }, [stop]);

  return {
    source,
    localStream,
    publishing,
    startCamera: () => void start("camera"),
    startScreen: () => void start("screen"),
    stop,
  };
}
