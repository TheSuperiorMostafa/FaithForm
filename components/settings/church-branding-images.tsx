"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { downscaleForUpload } from "@/lib/sites/downscale-image";
import { updateChurchBranding } from "@/app/dashboard/settings/branding-actions";
import { Button } from "@/components/ui/button";
import type { Area } from "react-easy-crop";

export function ChurchBrandingImages({ logoUrl, coverUrl }: { logoUrl: string | null; coverUrl: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<{ kind: "logo" | "cover"; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(kind: "logo" | "cover", file: File | null, crop?: Area) {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      if (file) form.set("photo", file); else form.set("remove", "true");
      if (crop) form.set("crop", JSON.stringify(crop));
      const result = await updateChurchBranding(kind, form);
      if ("error" in result) setError(result.error ?? "Try again."); else router.refresh();
    } catch { setError("The image could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
    <h2 className="font-heading text-lg font-semibold">Church profile images</h2>
    <p className="text-sm text-muted-foreground">Choose a logo and cover for your church’s profile in the app and on the web.</p>
    <div className="grid gap-6 sm:grid-cols-2">{(["logo", "cover"] as const).map(kind => {
      const url = kind === "logo" ? logoUrl : coverUrl;
      return <div key={kind} className="space-y-3">
        <label className="block space-y-2"><span>{kind === "logo" ? "Church logo" : "Cover photo"}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url && <img src={url} alt={kind === "logo" ? "Church logo" : "Church cover"} className={kind === "logo" ? "h-24 w-24 rounded-xl object-cover" : "aspect-video w-full max-w-sm rounded-xl object-cover"} />}
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
            setBusy(true); setError(null);
            try { if (file.size > 12 * 1024 * 1024) throw new Error(); const prepared = await downscaleForUpload(file); if (prepared.size > 3_400_000) throw new Error(); setDraft({ kind, file: prepared }); }
            catch { setError("Choose a readable image under 12 MB."); } finally { setBusy(false); }
          }} /></label>
        {url && <Button variant="ghost" disabled={busy} onClick={() => void save(kind, null)}>Remove {kind === "logo" ? "logo" : "cover"}</Button>}
      </div>;
    })}</div>
    {busy && <p role="status">Saving image…</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    {draft && <ImageCropper file={draft.file} shape={{ label: draft.kind === "logo" ? "Church logo" : "Church cover", hint: "Drag and zoom to choose the crop", ratio: draft.kind === "logo" ? 1 : 16 / 9 }} onCancel={() => setDraft(null)} onConfirm={crop => { const selected = draft; setDraft(null); void save(selected.kind, selected.file, crop); }} />}
  </section>;
}
