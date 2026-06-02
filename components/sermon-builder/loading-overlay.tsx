import { Loader2 } from "lucide-react";

type LoadingOverlayProps = {
  message: string;
};

export function LoadingOverlay({ message }: LoadingOverlayProps) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-xl bg-card/90 backdrop-blur-sm">
      <Loader2 className="size-10 animate-spin text-accent" strokeWidth={1.75} />
      <p className="font-heading text-base font-semibold text-foreground">{message}</p>
    </div>
  );
}
