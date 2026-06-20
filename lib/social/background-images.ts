import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SOCIAL_BACKGROUNDS_BUCKET,
  type SocialBackgroundTag,
} from "@/lib/social/constants";

export type SocialBackgroundImage = {
  id: string;
  storagePath: string;
  publicUrl: string;
  tags: string[];
  attribution: string | null;
};

function publicBackgroundUrl(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${SOCIAL_BACKGROUNDS_BUCKET}/${storagePath}`;
}

export async function pickBackgroundImage(
  supabase: SupabaseClient,
  tag: SocialBackgroundTag,
): Promise<SocialBackgroundImage | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;

  const tagsToTry: SocialBackgroundTag[] =
    tag === "default" ? ["default"] : [tag, "default"];

  for (const candidateTag of tagsToTry) {
    const { data, error } = await supabase
      .from("social_background_images")
      .select("id, storage_path, tags, attribution")
      .eq("active", true)
      .contains("tags", [candidateTag])
      .order("sort_order", { ascending: true });

    if (error || !data?.length) continue;

    const picked = data[Math.floor(Math.random() * data.length)];
    const storagePath = picked.storage_path as string;

    return {
      id: picked.id as string,
      storagePath,
      publicUrl: publicBackgroundUrl(supabaseUrl, storagePath),
      tags: (picked.tags as string[]) ?? [],
      attribution: (picked.attribution as string | null) ?? null,
    };
  }

  return null;
}
