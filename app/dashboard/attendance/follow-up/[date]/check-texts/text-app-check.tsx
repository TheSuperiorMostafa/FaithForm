"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextAppCheckContent } from "./text-app-check-content";
import { confirmTextAppCheck } from "./actions";

export function TextAppCheck({ serviceDate, through }: { serviceDate: string; through: string }) {
  const router = useRouter();
  const started = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);

  function stop() {
    started.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  }

  useEffect(() => {
    const cancel = () => stop();
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function begin() {
    if (pending || started.current !== null || submitting.current) return;
    setError(null);
    started.current = performance.now();
    timer.current = setInterval(() => {
      if (started.current === null) return;
      const elapsed = performance.now() - started.current;
      setProgress(Math.min(100, elapsed / 30));
      if (elapsed < 3_000) return;
      stop();
      submitting.current = true;
      startTransition(async () => {
        try {
          const result = await confirmTextAppCheck(serviceDate, through);
          if (!result.ok) { setError(result.error); return; }
          router.push(`/dashboard/attendance/follow-up/${serviceDate}`);
          router.refresh();
        } catch {
          setError("We couldn't save your app check. Try again shortly.");
        } finally {
          submitting.current = false;
        }
      });
    }, 50);
  }

  return (
    <TextAppCheckContent>
      <Button type="button" size="lg" className="relative h-12 overflow-hidden select-none touch-none" disabled={pending}
        onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); begin(); }}
        onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop}
        onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat) begin(); } }}
        onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); stop(); } }}
        aria-describedby="text-app-check-help">
        <span aria-hidden className="absolute inset-y-0 left-0 bg-white/20 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        <span className="relative">{pending ? "Saving your check…" : progress > 0 ? `Keep holding… ${Math.ceil(3 - progress * 0.03)} seconds` : "Hold for 3 seconds to confirm"}</span>
      </Button>
      <p id="text-app-check-help" className="text-sm text-muted-foreground">Hold with your mouse or finger, or hold the Space or Enter key while the button is selected. Releasing early restarts the check.</p>
      {error ? <p role="alert" className="text-base text-destructive">{error}</p> : null}
    </TextAppCheckContent>
  );
}
