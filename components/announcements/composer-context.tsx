"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Megaphone } from "lucide-react";

import {
  AnnouncementComposer,
  type ComposerMode,
  type ComposerSettings,
} from "@/components/announcements/announcement-composer";
import { Button } from "@/components/ui/button";

type ComposerContextValue = {
  settings: ComposerSettings;
  openComposer: (mode: ComposerMode) => void;
};

const ComposerContext = createContext<ComposerContextValue | null>(null);

export function useAnnouncementComposer(): ComposerContextValue {
  const ctx = useContext(ComposerContext);
  if (!ctx) {
    throw new Error("useAnnouncementComposer must be used inside AnnouncementsComposerProvider");
  }
  return ctx;
}

/**
 * One composer for the whole page. "New announcement", every "Announce" on a
 * calendar event, "Change" and "Post again" all open this same form, so
 * posting reads the same wherever it starts.
 *
 * `?compose=1` (the Home tile) opens it straight away and is then removed
 * from the address, so a refresh doesn't open it again.
 */
export function AnnouncementsComposerProvider({
  settings,
  children,
}: {
  settings: ComposerSettings;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<ComposerMode | null>(null);
  // Bumped for every open, so reopening always starts from the mode given.
  const [session, setSession] = useState(0);

  const openComposer = useCallback((next: ComposerMode) => {
    setMode(next);
    setSession((n) => n + 1);
  }, []);

  useEffect(() => {
    if (searchParams.get("compose") !== "1") return;
    openComposer({ kind: "new" });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("compose");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, openComposer]);

  const value = useMemo(() => ({ settings, openComposer }), [settings, openComposer]);

  return (
    <ComposerContext.Provider value={value}>
      {children}
      {mode && (
        <AnnouncementComposer
          key={session}
          mode={mode}
          settings={settings}
          onClose={() => setMode(null)}
          onPosted={() => router.refresh()}
        />
      )}
    </ComposerContext.Provider>
  );
}

/** The page's one primary action. */
export function NewAnnouncementButton() {
  const { openComposer } = useAnnouncementComposer();
  return (
    <Button size="lg" onClick={() => openComposer({ kind: "new" })}>
      <Megaphone aria-hidden strokeWidth={1.75} />
      New announcement
    </Button>
  );
}
