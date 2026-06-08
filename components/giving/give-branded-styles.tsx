import { cn } from "@/lib/utils";

export function giveBtnPrimary(active: boolean, className?: string) {
  return cn(
    "give-btn",
    active ? "give-btn-primary-active" : "give-btn-primary-outline",
    className,
  );
}

export function giveBtnCta(className?: string) {
  return cn("give-btn give-btn-cta", className);
}

export function giveLinkAccent(className?: string) {
  return cn("give-link-accent", className);
}
