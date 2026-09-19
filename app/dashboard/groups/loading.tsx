export default function LoadingGroups() {
  return <div className="space-y-6 p-6" role="status" aria-label="Loading groups"><div className="h-10 w-52 animate-pulse rounded-xl bg-muted" /><div className="h-40 animate-pulse rounded-3xl bg-muted" /><div className="grid gap-5 md:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-72 animate-pulse rounded-2xl bg-muted" />)}</div><span className="sr-only">Loading groups…</span></div>;
}
