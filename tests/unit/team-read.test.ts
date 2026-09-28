import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getChurchTeamMembers } from "@/lib/queries/team";

const rows = Array.from({ length: 1001 }, (_, index) => ({
  id: String(index).padStart(5, "0"),
  user_id: `user-${index}`,
  role: "viewer",
  created_at: `2026-09-27T${String(index % 24).padStart(2, "0")}:00:00Z`,
  feature_permissions: [],
  invited_at: null,
}));

function client(failSecondPage = false): SupabaseClient {
  return {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        range(from: number, to: number) {
          return Promise.resolve(failSecondPage && from > 0
            ? { data: null, error: { message: "network failed" } }
            : { data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const authUsers = async (ids: string[]) => new Map(ids.map((id) => [id, {
  id,
  email: `${id}@example.test`,
  lastSignInAt: null,
  createdAt: null,
  appMetadata: null,
}]));

test("team roster includes a member beyond the first API page", async () => {
  const team = await getChurchTeamMembers("church-a", client(), authUsers);
  assert.equal(team.length, 1001);
  assert.equal(team.some((member) => member.userId === "user-1000"), true);
});

test("failed team page does not look like an empty roster", async () => {
  await assert.rejects(
    getChurchTeamMembers("church-a", client(true), authUsers),
    /church team: network failed/,
  );
});

test("missing account details cannot misstate a member's access", async () => {
  await assert.rejects(
    getChurchTeamMembers("church-a", client(), async () => new Map()),
    /church team account details unavailable/,
  );
});
