export function isStudioSupported(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return (
    typeof canvas.captureStream === "function" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
