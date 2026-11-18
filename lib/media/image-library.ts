import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ARTWORK_BUCKET, ARTWORK_CROPS } from "@/lib/media/artwork";
import { listSlideThemes } from "@/lib/queries/slide-themes";
import { SOCIAL_GRAPHICS_BUCKET } from "@/lib/social/constants";
import { absoluteAppPath } from "@/lib/site-url";

/**
 * A church's picture library: every image it has uploaded for announcements
 * and for recording artwork, plus FaithForm's stock images (the sermon slide
 * theme backgrounds). Shared by the event picture picker and the Live artwork
 * picker so both offer the same pictures.
 */

export type LibraryImage = {
  /** `bucket:path`, the id the browser sends back when it picks one. */
  id: string;
  url: string;
  createdAt: string | null;
};

export type StockImage = { id: string; name: string; url: string };

/** Buckets whose church folder may be offered as library pictures. */
const LIBRARY_BUCKETS = [SOCIAL_GRAPHICS_BUCKET, ARTWORK_BUCKET] as const;
type LibraryBucket = (typeof LIBRARY_BUCKETS)[number];

const IMAGE_NAME = /\.(jpe?g|png|webp)$/i;

type StorageEntry = { name: string; created_at?: string | null; id?: string | null };

async function listFolder(
  admin: SupabaseClient,
  bucket: LibraryBucket,
  prefix: string,
  search?: string,
): Promise<LibraryImage[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
    ...(search ? { search } : {}),
  });
  if (error || !data) return [];
  return (data as StorageEntry[])
    .filter((entry) => entry.id && IMAGE_NAME.test(entry.name) && (!search || entry.name.startsWith(search)))
    .map((entry) => {
      const path = `${prefix}/${entry.name}`;
      return {
        id: `${bucket}:${path}`,
        url: admin.storage.from(bucket).getPublicUrl(path).data.publicUrl,
        createdAt: entry.created_at ?? null,
      };
    });
}

/** Newest first, at most `limit`. Uploaded event pictures and artwork crops. */
export async function listChurchImageLibrary(
  admin: SupabaseClient,
  churchId: string,
  limit = 60,
): Promise<LibraryImage[]> {
  const folders = await Promise.all([
    listFolder(admin, SOCIAL_GRAPHICS_BUCKET, churchId, "upload-"),
    // The wide crop is the fullest picture of each artwork upload; the tile
    // and banner crops of the same photo would only repeat it.
    listFolder(admin, ARTWORK_BUCKET, `${churchId}/media/wide`),
    ...ARTWORK_CROPS.filter((crop) => crop !== "wide").map((crop) =>
      listFolder(admin, ARTWORK_BUCKET, `${churchId}/media/${crop}`),
    ),
  ]);
  const [social, wide, ...rest] = folders;
  return [...social, ...wide, ...rest.flat()]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, limit);
}

/** FaithForm's stock pictures: the sermon theme backgrounds that are photos. */
export async function listStockImages(): Promise<StockImage[]> {
  const themes = await listSlideThemes();
  return themes
    .filter((theme) => theme.backgroundType === "image" && theme.imageUrl)
    .map((theme) => ({
      id: theme.id,
      name: theme.name,
      url: /^https?:\/\//i.test(theme.imageUrl!) ? theme.imageUrl! : absoluteAppPath(theme.imageUrl!),
    }));
}

/**
 * Reads the bytes of a picture the browser picked, after checking it really
 * is this church's library picture or a stock picture. Never fetches an
 * arbitrary URL: the browser names a library id or a stock theme id only.
 */
export async function readPickedImage(
  admin: SupabaseClient,
  churchId: string,
  pick: { kind: "library"; id: string } | { kind: "stock"; id: string },
): Promise<{ ok: true; bytes: Buffer; bucket: string | null; path: string | null } | { ok: false; error: string }> {
  if (pick.kind === "library") {
    const separator = pick.id.indexOf(":");
    const bucket = pick.id.slice(0, separator) as LibraryBucket;
    const path = pick.id.slice(separator + 1);
    if (
      separator < 1 ||
      !LIBRARY_BUCKETS.includes(bucket) ||
      !path.startsWith(`${churchId}/`) ||
      path.includes("..") ||
      !IMAGE_NAME.test(path)
    ) {
      return { ok: false, error: "That picture isn't in your library." };
    }
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) return { ok: false, error: "That picture couldn't be opened. Try another one." };
    return { ok: true, bytes: Buffer.from(await data.arrayBuffer()), bucket, path };
  }

  const stock = (await listStockImages()).find((image) => image.id === pick.id);
  if (!stock) return { ok: false, error: "That stock picture isn't available any more." };
  const response = await fetch(stock.url);
  if (!response.ok) return { ok: false, error: "That stock picture couldn't be opened. Try another one." };
  return { ok: true, bytes: Buffer.from(await response.arrayBuffer()), bucket: null, path: null };
}
