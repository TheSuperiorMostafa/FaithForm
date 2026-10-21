"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveChurchHealth } from "@/app/admin/church-health-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChurchHealth } from "@/lib/admin/church-health";

const colors = { green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", yellow: "bg-amber-500/15 text-amber-800 dark:text-amber-300", red: "bg-red-500/15 text-red-700 dark:text-red-400", unknown: "bg-muted text-muted-foreground" };
export function ChurchHealthControl({ churchId, health }: { churchId: string; health: ChurchHealth }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(health.manual ? health.status : "auto");
  const [note, setNote] = useState(health.manual ? health.reason : "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <div className="min-w-52 space-y-2">
    <span className={`inline-flex rounded-full px-3 py-1 font-medium ${colors[health.status]}`}>{health.status === "unknown" ? "Unavailable" : health.status === "green" ? "Green · Active" : health.status === "yellow" ? "Yellow · Watch" : "Red · At risk"}</span>
    <p className="text-sm text-muted-foreground">{health.reason}</p>
    {editing ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); startTransition(async () => {
      try { const result = await saveChurchHealth({ churchId, status, note }); if (!result.ok) { toast.error(result.error); return; } toast.success("Church health status saved."); setEditing(false); router.refresh(); }
      catch { toast.error("We couldn't save this church's health status. Please try again."); }
    }); }}>
      <label className="block text-sm">Health status<select aria-label="Health status" value={status} onChange={e => setStatus(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3" disabled={pending}><option value="auto">Use activity and support</option><option value="yellow">Yellow · Watch</option><option value="red">Red · At risk</option></select></label>
      {status !== "auto" && <label className="block text-sm">Reason<Input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} required disabled={pending} /></label>}
      <div className="flex gap-2"><Button type="submit" disabled={pending}>Save health</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>Cancel</Button></div>
    </form> : <Button type="button" variant="ghost" onClick={() => setEditing(true)}>Update health</Button>}
  </div>;
}
