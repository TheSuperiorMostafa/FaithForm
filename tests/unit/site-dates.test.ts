import assert from "node:assert/strict";
import test from "node:test";
import {formatLongDate} from "@/lib/sites/format";
import {eventsListSection} from "@/components/sites/sections/events-list";
import {sermonFeedSection} from "@/components/sites/sections/sermon-feed";
import {DEV_PREVIEW_PROFILE} from "@/lib/sites/dev-preview-profile";

test("timestamp dates follow the church timezone and calendar-only dates never move to yesterday",()=>{
  assert.equal(formatLongDate("2026-11-13T00:30:00Z","America/New_York"),"Nov 12, 2026");
  assert.equal(formatLongDate("2026-11-13T00:30:00Z","Asia/Tokyo"),"Nov 13, 2026");
  assert.equal(formatLongDate("2026-11-13","America/Los_Angeles"),"Nov 13, 2026");
  assert.equal(formatLongDate("2026-02-31","America/New_York"),null);
  assert.equal(formatLongDate("bad date","America/New_York"),null);
  assert.doesNotThrow(()=>formatLongDate("2026-11-13T00:30:00Z","Invalid/Timezone"));
});

test("automatic events and sermon feeds share the church's date instead of leaking raw timestamps",()=>{
  const profile={...DEV_PREVIEW_PROFILE,timezone:"America/New_York",events:[{title:"Evening gathering",date:"2026-11-13T00:30:00Z",location:null,note:null}],media:[{...DEV_PREVIEW_PROFILE.media[0],date:"2026-11-13T00:30:00Z"}]};
  const events=eventsListSection.derive?.(profile).items as {date:string}[];
  const sermons=sermonFeedSection.derive?.(profile).items as {date:string}[];
  assert.equal(events[0].date,"Nov 12, 2026");
  assert.equal(sermons[0].date,"Nov 12, 2026");
});
