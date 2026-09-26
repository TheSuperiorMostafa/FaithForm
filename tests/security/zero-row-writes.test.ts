import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isChurchLocation } from "@/lib/checkin/owned-location";

/**
 * Found by calling the dashboard's own actions as a second church (local
 * audit, Docker stack): saving care notes or a thumbnail for another church's
 * record wrote nothing — the church predicate held — but answered "saved".
 * And a check-in room id from the form was written without checking it was
 * this church's room. A write that matched no row is now reported, and rooms
 * are checked before they are used.
 */

function fakeDb(rooms: { id: string; church_id: string }[]) {
  return {
    from: () => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => ((filters[column] = value), builder),
        maybeSingle: async () => ({
          data: rooms.find((r) => r.id === filters.id && r.church_id === filters.church_id) ?? null,
          error: null,
        }),
      };
      return builder;
    },
  } as never;
}

test("a room is this church's only when both the id and the church match", async () => {
  const db = fakeDb([{ id: "room-1", church_id: "church-a" }]);
  assert.equal(await isChurchLocation(db, "church-a", "room-1"), true);
  assert.equal(await isChurchLocation(db, "church-b", "room-1"), false);
  assert.equal(await isChurchLocation(db, "church-a", "room-2"), false);
});

test("care notes, room moves and thumbnails report a write that changed nothing", () => {
  const care = readFileSync("app/dashboard/people/care-actions.ts", "utf8");
  assert.match(care, /\(saved \?\? \[\]\)\.length === 0/);
  assert.match(care, /isChurchLocation\(admin, auth\.churchId, input\.defaultLocationId\)/);

  const checkin = readFileSync("app/dashboard/checkin/actions.ts", "utf8");
  const careDetails = checkin.slice(checkin.indexOf("export async function updateMemberCareDetails"));
  assert.match(careDetails.slice(0, careDetails.indexOf("\n}\n")), /isChurchLocation\(/);
  const move = checkin.slice(checkin.indexOf("export async function moveSession"));
  const moveBody = move.slice(0, move.indexOf("\n}\n"));
  assert.match(moveBody, /isChurchLocation\(/);
  assert.match(moveBody, /\(moved \?\? \[\]\)\.length === 0/);

  const publication = readFileSync("lib/stream/recording-publication.ts", "utf8");
  const choose = publication.slice(publication.indexOf("export async function chooseThumbnail("));
  assert.match(choose.slice(0, choose.indexOf("\n}\n")), /\(saved \?\? \[\]\)\.length === 0/);
});
