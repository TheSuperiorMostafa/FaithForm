import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSongDetail, searchSongOptions } from "@/lib/service-plans/songs/queries";
import type { SongDetail, SongPickerOption } from "@/lib/service-plans/songs/types";

/**
 * Where songs come from. Plan screens and the song picker only talk to this,
 * so a CCLI SongSelect source can be added later beside the church's own
 * library without touching them.
 */
export interface SongSource {
  readonly id: string;
  readonly label: string;
  search(query: string, limit?: number): Promise<SongPickerOption[]>;
  fetch(id: string): Promise<SongDetail | null>;
}

/** The church's own song library. */
export class LocalLibrarySource implements SongSource {
  readonly id = "local";
  readonly label = "Your song library";

  constructor(
    private readonly client: SupabaseClient,
    private readonly churchId: string,
  ) {}

  search(query: string, limit?: number): Promise<SongPickerOption[]> {
    return searchSongOptions(this.client, this.churchId, query, limit);
  }

  fetch(id: string): Promise<SongDetail | null> {
    return getSongDetail(this.client, this.churchId, id);
  }
}

export function songSource(client: SupabaseClient, churchId: string): SongSource {
  return new LocalLibrarySource(client, churchId);
}
