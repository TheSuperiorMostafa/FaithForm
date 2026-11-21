"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  copyShareLinkAction,
  createShareAction,
  listSharesAction,
  revokeShareAction,
  type ShareListRow,
  type ShareResult,
} from "@/app/dashboard/plans/share-actions";
import { AnswerBadge } from "@/components/service-plans/answer-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABELS,
  SHARE_LINK_PRESETS,
  SHARE_PRESET_LABELS,
  type NoteCategory,
  type PersonOption,
  type Plan,
  type SharePreset,
  type Team,
} from "@/lib/service-plans/types";

type TeamChoice = { on: boolean; preset: SharePreset; categories: NoteCategory[] };

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[hsl(var(--accent))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function CategoryChips({ value, onChange, idPrefix }: { value: NoteCategory[]; onChange: (v: NoteCategory[]) => void; idPrefix: string }) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">Note categories they see</legend>
      {NOTE_CATEGORIES.map((c) => (
        <label
          key={c}
          htmlFor={`${idPrefix}-${c}`}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-sm font-semibold has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        >
          <input
            id={`${idPrefix}-${c}`}
            type="checkbox"
            className="size-4 accent-[hsl(var(--accent))]"
            checked={value.includes(c)}
            onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))}
          />
          {NOTE_CATEGORY_LABELS[c]}
        </label>
      ))}
    </fieldset>
  );
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied. Paste it wherever your team talks.");
  } catch {
    toast.error("Your browser didn't allow copying. Select the link and copy it instead.");
  }
}

export function ShareDialog({
  open,
  onOpenChange,
  plan,
  teams,
  people,
  onShared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan;
  teams: Team[];
  people: PersonOption[];
  onShared: () => void;
}) {
  const [pending, start] = useTransition();
  const [tab, setTab] = useState("share");
  const [teamChoices, setTeamChoices] = useState<Record<string, TeamChoice>>({});
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [personPreset, setPersonPreset] = useState<SharePreset>("person");
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(false);
  const [makeLink, setMakeLink] = useState(false);
  const [linkPreset, setLinkPreset] = useState<SharePreset>("order");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ShareResult | null>(null);
  const [shares, setShares] = useState<ShareListRow[] | null>(null);

  const scheduled = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of plan.team) if (m.status !== "declined") counts.set(m.teamId, (counts.get(m.teamId) ?? 0) + 1);
    return counts;
  }, [plan.team]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setTab("share");
    setTeamChoices(Object.fromEntries(teams.map((t) => [t.id, { on: false, preset: "full" as SharePreset, categories: t.noteCategories }])));
  }, [open, teams]);

  const loadShares = () =>
    start(async () => {
      const r = await listSharesAction(plan.id);
      if (r.ok) setShares(r.shares);
      else toast.error(r.error);
    });

  const recipientCount =
    new Set([
      ...plan.team.filter((m) => m.status !== "declined" && teamChoices[m.teamId]?.on).map((m) => m.personId),
      ...personIds,
    ]).size;

  const send = () =>
    start(async () => {
      const r = await createShareAction(plan.id, {
        teams: Object.entries(teamChoices)
          .filter(([, c]) => c.on)
          .map(([teamId, c]) => ({ teamId, preset: c.preset, categories: c.categories })),
        people: personIds.map((personId) => ({
          personId,
          preset: personPreset,
          categories: personPreset === "order" ? [] : [...NOTE_CATEGORIES],
        })),
        channels: [...(email ? (["email"] as const) : []), ...(sms ? (["sms"] as const) : [])],
        link: makeLink ? { preset: linkPreset, categories: linkPreset === "full" ? [...NOTE_CATEGORIES] : ["general"] } : null,
        message,
      });
      if (!r.ok) return void toast.error(r.error);
      setResult(r);
      onShared();
      if (r.sent) toast.success(`Plan sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share this plan</DialogTitle>
          <DialogDescription>
            Each person gets their own read-only link where they can answer “I’ll be there” or “Can’t make it”. It always shows the latest plan and stops working the day after the service.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-auto overflow-y-auto px-6 py-5">
          <Tabs
            defaultValue="share"
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              if (v === "shared") loadShares();
            }}
          >
            <TabsList aria-label="Share or see who has it">
              <TabsTrigger value="share">Share</TabsTrigger>
              <TabsTrigger value="shared">Shared with</TabsTrigger>
            </TabsList>

            <TabsContent value="share" className="mt-5 space-y-6">
              {result ? (
                <div className="space-y-4">
                  <p className="text-[15px] font-semibold">
                    {result.sent ? `Sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}.` : "Nothing was sent by email or text."}
                  </p>
                  {result.problems.length > 0 && (
                    <div className="rounded-xl border border-amber-500/50 bg-amber-50 p-4 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                      <p className="font-semibold">Some people weren’t reached:</p>
                      <ul className="mt-1 list-disc pl-5 text-[15px]">
                        {result.problems.map((p, i) => (
                          <li key={i}>
                            {p.name} {p.reason}.
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-sm">You can copy their link from Shared with and send it yourself.</p>
                    </div>
                  )}
                  {result.links.map((l) => (
                    <div key={l.url} className="space-y-2">
                      <Label htmlFor="share-link">{l.label}</Label>
                      <div className="flex gap-2">
                        <input id="share-link" readOnly value={l.url} className="min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-muted/40 px-3 text-sm" onFocus={(e) => e.target.select()} />
                        <Button onClick={() => copy(l.url)}>
                          <Copy aria-hidden />
                          Copy
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <section className="space-y-3" aria-labelledby="share-teams">
                    <h3 id="share-teams" className="font-semibold">
                      Teams
                    </h3>
                    {teams.length === 0 && <p className="text-[15px] text-muted-foreground">No teams yet. Add them on the service type’s Teams tab.</p>}
                    {teams.map((t) => {
                      const c = teamChoices[t.id];
                      if (!c) return null;
                      const count = scheduled.get(t.id) ?? 0;
                      const set = (patch: Partial<TeamChoice>) => setTeamChoices((all) => ({ ...all, [t.id]: { ...all[t.id], ...patch } }));
                      return (
                        <div key={t.id} className="rounded-xl border border-border p-3">
                          <Checkbox
                            checked={c.on}
                            onChange={(on) => set({ on })}
                            label={t.name}
                            hint={count ? `${count} scheduled on this plan` : "No one scheduled on this plan yet"}
                          />
                          {c.on && (
                            <div className="mt-2 space-y-3 pl-8">
                              <div className="space-y-1.5">
                                <Label htmlFor={`share-preset-${t.id}`}>They see</Label>
                                <Select id={`share-preset-${t.id}`} value={c.preset} onChange={(e) => set({ preset: e.target.value as SharePreset })}>
                                  {SHARE_LINK_PRESETS.map((p) => (
                                    <option key={p} value={p}>
                                      {SHARE_PRESET_LABELS[p]}
                                      {p === "person" ? " (only what they lead)" : ""}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                              {c.preset !== "order" && (
                                <CategoryChips idPrefix={`share-cat-${t.id}`} value={c.categories} onChange={(categories) => set({ categories })} />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>

                  <section className="space-y-3" aria-labelledby="share-people">
                    <h3 id="share-people" className="font-semibold">
                      People
                    </h3>
                    <SearchPicker
                      label="Send to these people too"
                      items={people.map((p) => ({ id: p.id, label: p.name }))}
                      value={personIds}
                      onChange={setPersonIds}
                      multiple
                    />
                    {personIds.length > 0 && (
                      <div className="space-y-1.5">
                        <Label htmlFor="share-person-preset">They see</Label>
                        <Select id="share-person-preset" value={personPreset} onChange={(e) => setPersonPreset(e.target.value as SharePreset)}>
                          {(["person", "full", "order"] as const).map((p) => (
                            <option key={p} value={p}>
                              {SHARE_PRESET_LABELS[p]}
                              {p === "person" ? " (only what they lead)" : ""}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </section>

                  <section className="space-y-1" aria-labelledby="share-channels">
                    <h3 id="share-channels" className="font-semibold">
                      Send by
                    </h3>
                    <Checkbox checked={email} onChange={setEmail} label="Email" />
                    <Checkbox checked={sms} onChange={setSms} label="Text message" hint="Uses your church's texting number." />
                    <Checkbox checked={makeLink} onChange={setMakeLink} label="Also make a link to copy" hint="For a group chat or the ushers' clipboard. People can't answer through it." />
                    {makeLink && (
                      <div className="space-y-1.5 pl-8">
                        <Label htmlFor="share-link-preset">The link shows</Label>
                        <Select id="share-link-preset" value={linkPreset} onChange={(e) => setLinkPreset(e.target.value as SharePreset)}>
                          {(["order", "full"] as const).map((p) => (
                            <option key={p} value={p}>
                              {SHARE_PRESET_LABELS[p]}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </section>

                  <div className="space-y-1.5">
                    <Label htmlFor="share-message">Message (optional)</Label>
                    <Textarea id="share-message" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Rehearsal moved to 5:30 this week." />
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="shared" className="mt-5">
              {!shares ? (
                <p className="text-[15px] text-muted-foreground">Loading…</p>
              ) : shares.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">This plan hasn’t been shared yet.</p>
              ) : (
                <ul className="divide-y divide-border rounded-2xl border border-border">
                  {shares.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{s.name}</span>
                        <span className="block text-sm text-muted-foreground">
                          {SHARE_PRESET_LABELS[s.preset]} ·{" "}
                          {s.firstViewedAt ? `Opened ${new Date(s.firstViewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not opened yet"}
                        </span>
                      </span>
                      {s.answer && <AnswerBadge status={s.answer} />}
                      {s.revoked ? (
                        <StatusBadge tone="neutral">Turned off</StatusBadge>
                      ) : Date.parse(s.expiresAt) < Date.now() ? (
                        <StatusBadge tone="neutral">Expired</StatusBadge>
                      ) : s.upToDate ? (
                        <StatusBadge tone="ready">
                          <Check aria-hidden className="size-3.5" /> Up to date
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="attention">Older version</StatusBadge>
                      )}
                      {!s.revoked && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              start(async () => {
                                const r = await copyShareLinkAction(s.id);
                                if (r.ok) await copy(r.url);
                                else toast.error(r.error);
                              })
                            }
                          >
                            <Copy aria-hidden />
                            Copy link
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              start(async () => {
                                const r = await revokeShareAction(s.id, true);
                                if (!r.ok) return void toast.error(r.error);
                                toast.success(`${s.name}'s link turned off.`);
                                loadShares();
                              })
                            }
                          >
                            Turn off link
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {result ? "Done" : "Cancel"}
          </Button>
          {tab === "share" && !result && (
            <Button disabled={pending || (!recipientCount && !makeLink) || (recipientCount > 0 && !email && !sms)} onClick={send}>
              {pending
                ? "Sending…"
                : recipientCount
                  ? `Send to ${recipientCount} ${recipientCount === 1 ? "person" : "people"}`
                  : "Make the link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
