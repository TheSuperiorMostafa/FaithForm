import { NextResponse } from "next/server";
import { loadSharedSongs } from "@/lib/service-plans/share";
import { renderSongPdf, songPdfFileName } from "@/lib/service-plans/songs/song-pdf";
import { buildPlanView } from "@/lib/service-plans/view";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { loadSharedPlanByToken, shareViewOptions } from "../../../load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = { chart: "chart", lyrics: "lyrics" } as const;

function notFound() {
  return NextResponse.json(
    { error: "That song isn't available on this link." },
    { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

/**
 * The chord chart or lyrics PDF of one song on a share link, made on demand
 * so a song whose PDFs were never generated (imported, never re-saved) can
 * still be opened. The token is the credential: the song must be on a row
 * this link's own view shows (never on an Order only link), and everything is
 * read scoped to the share's church.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; itemId: string; kind: string }> },
) {
  const { token, itemId, kind: rawKind } = await params;
  const kind = Object.prototype.hasOwnProperty.call(KINDS, rawKind) ? KINDS[rawKind as keyof typeof KINDS] : null;
  if (!kind || !UUID.test(itemId)) return notFound();
  const loaded = await loadSharedPlanByToken(token);
  if (!loaded) return notFound();
  const admin = createAdminClientOrNull();
  if (!admin) return notFound();
  const { share, plan } = loaded;

  const view = buildPlanView(plan, shareViewOptions(share));
  const [song] = await loadSharedSongs(admin, share, plan, view, itemId);
  const text = song ? song[kind] : null;
  if (!song || !text) return notFound();

  try {
    const pdf = await renderSongPdf({
      kind,
      song: { title: song.title, author: song.author, ccliNumber: song.ccliNumber, copyright: song.copyright },
      arrangement: { name: song.arrangementName ?? "", key: song.chartKey, bpm: song.bpm },
      text,
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${songPdfFileName(song.title, song.arrangementName ?? "", kind)}"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("service-plans share song pdf:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "We couldn't make the PDF. Please try again." }, { status: 500 });
  }
}
