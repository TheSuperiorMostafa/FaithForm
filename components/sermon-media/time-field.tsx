"use client";

import { useEffect, useId, useState } from "react";
import { Clock, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatTime, parseTime } from "@/components/sermon-media/time";

/**
 * A labelled h:mm:ss time with "Use current time", 5-second nudges and an
 * optional preview button. The typed text is only applied when it reads as a
 * time; otherwise the field says how to type one and keeps the last value.
 */
export function TimeField({
  label,
  value,
  onChange,
  onUseCurrent,
  onPreview,
  previewLabel,
  disabled,
  min = 0,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (seconds: number) => void;
  onUseCurrent?: () => void;
  onPreview?: () => void;
  previewLabel?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  hint?: React.ReactNode;
}) {
  const id = useId();
  const [text, setText] = useState(() => formatTime(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatTime(value));
    setInvalid(false);
  }, [value]);

  const bound = (seconds: number) => Math.min(Math.max(seconds, min), max ?? Number.POSITIVE_INFINITY);

  const commit = () => {
    const parsed = parseTime(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = bound(parsed);
    setText(formatTime(next));
    if (next !== value) onChange(next);
  };

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id} className="text-[15px]">
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          value={text}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder="0:00"
          aria-invalid={invalid || undefined}
          aria-describedby={[invalid ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          className="w-32 font-mono tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(bound(value - 5))}
          aria-label={`${label}: 5 seconds earlier`}
        >
          −5 s
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(bound(value + 5))}
          aria-label={`${label}: 5 seconds later`}
        >
          +5 s
        </Button>
        {onUseCurrent ? (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onUseCurrent} className="gap-1.5">
            <Clock aria-hidden />
            Use current time
          </Button>
        ) : null}
        {onPreview ? (
          <Button type="button" variant="ghost" size="sm" onClick={onPreview} className="gap-1.5">
            <Play aria-hidden />
            {previewLabel ?? "Play from here"}
          </Button>
        ) : null}
      </div>
      {invalid ? (
        <p id={errorId} className="text-sm text-destructive">
          Type a time like 31:02 or 1:10:48.
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
