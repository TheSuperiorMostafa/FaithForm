"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

/**
 * Find a recording by title, series or speaker. Kept in the address (`?q=`)
 * so a search survives a refresh and the back button.
 */
export function RecordingSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  // The search the address already holds. Typing changes the address only
  // when the words differ.
  const applied = useRef(initial);

  // Back / Forward change the address without typing: bring the box along.
  // Only then, so a slow page never overwrites what someone is still typing.
  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
      applied.current = q;
      setValue(q);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (value.trim() === applied.current) return;
    const timer = setTimeout(() => {
      applied.current = value.trim();
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
    // Only the typed value drives this; params is read fresh when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Find a recording"
        aria-label="Find a recording"
        className="min-h-11 pl-12 text-base"
      />
    </div>
  );
}
