/**
 * The relay's ingest bridge runs `ffmpeg -f webm -i pipe:0`, so the browser must
 * be able to record WebM. Safari's MediaRecorder only produces MP4: it passes
 * every other check here, then feeds ffmpeg a container it was not told to
 * parse, and ingest dies a few seconds in with a broken pipe. Checking codec
 * support explicitly means unsupported browsers get the "use Chrome or Edge"
 * notice instead of a Start button that produces a dead stream.
 */
export function isWebmRecordingSupported(): boolean {
  if (typeof MediaRecorder === "undefined") return false;
  return (
    MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ||
    MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ||
    MediaRecorder.isTypeSupported("video/webm")
  );
}

export function isStudioSupported(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return (
    typeof canvas.captureStream === "function" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    isWebmRecordingSupported()
  );
}
