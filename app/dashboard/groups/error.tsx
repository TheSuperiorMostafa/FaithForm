"use client";
import { Button } from "@/components/ui/button";
export default function GroupsError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-lg py-24 text-center"><h2 className="text-2xl font-semibold">We couldn’t load this workspace</h2><p className="mb-6 mt-3 text-muted-foreground">Your changes are safe. Check your connection and try again.</p><Button onClick={reset}>Try again</Button></div>;
}
