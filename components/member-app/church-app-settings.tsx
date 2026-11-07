"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Image as ImageIcon, Link2, MapPin, Users } from "lucide-react";

import { ChurchInfoEditor } from "@/components/member-app/church-info-editor";
import { SectionHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChurchAppInfo, ChurchAppInfoContext } from "@/lib/queries/church-app-info";

const PAGES = [
  { id: "appearance", label: "Appearance", icon: ImageIcon },
  { id: "church-details", label: "Church details", icon: MapPin },
  { id: "links-and-social", label: "Links & social", icon: Link2 },
  { id: "find-and-join", label: "Find & join", icon: Users },
] as const;

type AppPage = (typeof PAGES)[number]["id"];
export type ChurchEditorPage = Exclude<AppPage, "find-and-join">;

const LEGACY_PAGES: Record<string, ChurchEditorPage> = {
  "app-colors": "appearance",
  "church-identity": "appearance",
  "church-about": "church-details",
  "church-services": "church-details",
  "church-contact": "church-details",
  "church-social": "links-and-social",
  "church-links": "links-and-social",
};

export function ChurchAppSettings({
  churchInfo,
  canEdit = false,
  editorFallback,
  colors,
  access,
}: {
  churchInfo?: { info: ChurchAppInfo; context: ChurchAppInfoContext } | null;
  canEdit?: boolean;
  editorFallback?: ReactNode;
  colors?: ReactNode;
  access?: ReactNode;
}) {
  const [page, setPage] = useState<AppPage>("appearance");
  const hasAccess = Boolean(access);
  const pages = hasAccess ? PAGES : PAGES.filter(({ id }) => id !== "find-and-join");

  useEffect(() => {
    let frame = 0;
    function syncPage() {
      const hash = window.location.hash.slice(1);
      const matchingPage = PAGES.find(({ id }) => id === hash)?.id;
      const legacyPage = Object.hasOwn(LEGACY_PAGES, hash) ? LEGACY_PAGES[hash] : undefined;
      const next = matchingPage ?? legacyPage ?? "appearance";
      setPage(next === "find-and-join" && !hasAccess ? "appearance" : next);
      cancelAnimationFrame(frame);
      if (legacyPage) {
        frame = requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
      }
    }
    syncPage();
    window.addEventListener("hashchange", syncPage);
    return () => {
      window.removeEventListener("hashchange", syncPage);
      cancelAnimationFrame(frame);
    };
  }, [hasAccess]);

  const openPage = useCallback((next: AppPage) => {
    setPage(next);
    if (window.location.hash !== `#${next}`) {
      window.history.pushState(null, "", `#${next}`);
    }
  }, []);

  const editorPage = page === "find-and-join" ? "appearance" : page;
  return (
    <Tabs
      defaultValue="appearance"
      value={page}
      onValueChange={(value) => {
        const next = pages.find(({ id }) => id === value);
        if (next && next.id !== page) openPage(next.id);
      }}
      className="flex min-w-0 flex-col gap-8"
    >
      <TabsList aria-label="Church App settings" className="h-auto w-fit max-w-full flex-wrap justify-start">
        {pages.map(({ id, label, icon: Icon }) => (
          <TabsTrigger key={id} value={id} className="gap-2 px-3 sm:px-4">
            <Icon className="size-4" aria-hidden />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value={editorPage} className="mt-0" keepMounted>
        <div className="flex min-w-0 flex-col gap-8">
          <section className="flex flex-col gap-4" aria-labelledby="church-page-heading">
            <SectionHeader
              id="church-page-heading"
              title="Your church page"
              description="What people see when they open your church in the app. Your website and phone assistant use the same details, so a change here updates them too."
            />
            {churchInfo ? (
              <ChurchInfoEditor
                initial={churchInfo.info}
                context={churchInfo.context}
                canEdit={canEdit}
                page={editorPage}
                onPageChange={openPage}
              />
            ) : editorFallback}
          </section>
          <div hidden={editorPage !== "appearance" || !colors}>{colors}</div>
        </div>
      </TabsContent>

      {access && (
        <TabsContent value="find-and-join" className="mt-0" keepMounted>
          {access}
        </TabsContent>
      )}
    </Tabs>
  );
}
