import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  addedMessage,
  addPeopleLabel,
  capacityProblem,
  categoryImpliesYouth,
  createdMessage,
  ENROLLMENT_LABELS,
  enrollmentLabel,
  NEW_GROUP_DEFAULTS,
  reachSentence,
  reportReasonLabel,
  VISIBILITY_LABELS,
  visibilityLabel,
} from "@/components/groups/labels";
import { GROUPS_SECTIONS } from "@/components/groups/sections";
import { GROUP_ENROLLMENTS, GROUP_VISIBILITIES } from "@/lib/groups/types";
import { REPORT_REASONS } from "@/lib/messaging/safety";

const read = (path: string) => readFileSync(path, "utf8");
const componentFiles = readdirSync("components/groups").filter((f) => f.endsWith(".tsx")).map((f) => `components/groups/${f}`);
const allGroupsUi = [...componentFiles, "app/dashboard/groups/[[...path]]/page.tsx", "app/dashboard/groups/loading.tsx"];

// ---------------------------------------------------------------------------
// Plain words
// ---------------------------------------------------------------------------

test("every visibility and join setting has a human label (no raw enums)", () => {
  for (const v of GROUP_VISIBILITIES) assert.ok(VISIBILITY_LABELS[v], v);
  for (const e of GROUP_ENROLLMENTS) assert.ok(ENROLLMENT_LABELS[e], e);
  assert.equal(visibilityLabel("unlisted"), "People with a link");
  assert.equal(visibilityLabel("private"), "Group members only");
  assert.equal(enrollmentLabel("approval_required"), "Ask to join");
  for (const reason of REPORT_REASONS) assert.doesNotMatch(reportReasonLabel(reason), /_/);
});

test("the Groups UI never renders enum values through a generic label() helper", () => {
  for (const file of allGroupsUi) {
    assert.doesNotMatch(read(file), /\blabel\((g|r|report|detail\.group|l|t)\.[a-z_]+\)/, file);
  }
});

test("headings name the page; slogans and the eyebrow are gone", () => {
  assert.deepEqual(
    Object.values(GROUPS_SECTIONS).map((s) => s.title),
    ["Groups", "Group messages", "Join requests", "Reports", "Safety", "Group settings"],
  );
  const slogans = [/Better together/, /A place to belong/, /Keep the connection going/, /Care for the conversation/, /A healthy space for everyone/, /See your community grow/, /LIFE TOGETHER/, /Made for life together/];
  for (const file of allGroupsUi) for (const slogan of slogans) assert.doesNotMatch(read(file), slogan, `${file} ${slogan}`);
});

test("church-facing copy says Meetings, not Gatherings", () => {
  for (const file of allGroupsUi) {
    for (const old of ["Plan a gathering", "Cancel gathering", "Past gatherings", "Show more gatherings", "Edit gathering", "Gathering planned", ">Gatherings<"]) {
      assert.ok(!read(file).includes(old), `${file}: ${old}`);
    }
  }
  assert.match(read("components/groups/group-detail.tsx"), /title: "Meetings"/);
});

// ---------------------------------------------------------------------------
// Create a group with its people
// ---------------------------------------------------------------------------

test("the success toast names the group and how many people were added", () => {
  assert.equal(createdMessage("Choir", 8), "Choir created with 8 people.");
  assert.equal(createdMessage("Choir", 1), "Choir created with 1 person.");
  assert.equal(createdMessage("Choir", 0), "Choir created.");
});

test("quick-create defaults are exactly the old form's safe defaults", () => {
  assert.deepEqual(NEW_GROUP_DEFAULTS, {
    visibility: "public",
    enrollment: "open",
    locationVisibility: "members",
    chatEnabled: true,
    chatPosting: "everyone",
    allowMemberMedia: true,
    allowMemberLinks: true,
    memberListVisibility: "members",
    safetyProfile: "standard",
    defaultNotificationLevel: "all",
  });
});

test("youth-sounding categories ask the youth question", () => {
  for (const name of ["Youth", "Kids Church", "Teens", "Students", "Children's Choir", "High School Girls"]) assert.equal(categoryImpliesYouth(name), true, name);
  for (const name of ["Young Adults", "Men", "Women", "Small Groups", "Worship Teams", null]) assert.equal(categoryImpliesYouth(name), false, String(name));
});

test("the create flow is Name → Who's in it? → Create group, and lands on Members", () => {
  const form = read("components/groups/group-form.tsx");
  assert.match(form, /Step 1 of 2/);
  assert.match(form, /Who’s in \$\{trimmed\}\?/);
  assert.match(form, /createGroupWithPeople\(values, chosen, leaders\)/);
  assert.match(form, /router\.push\(`\$\{base\}\/\$\{result\.data\.id\}\/members`\)/);
  assert.match(form, /<AdvancedSection/);
  // The youth question has no pre-chosen answer.
  assert.match(form, /setSafety\(""\)/);
  assert.match(form, /name="youthAnswer" required/);
});

test("create-with-people uses the guarded staff functions and never loses the group", () => {
  const actions = read("app/dashboard/groups/actions.ts");
  assert.match(actions, /export async function createGroupWithPeople[\s\S]*?groups\.createStaffGroup\(ctx, values\)[\s\S]*?addChosenPeople\(ctx, id, memberIds, leaderIds\)/);
  assert.match(actions, /people\.addStaffMembers\(ctx, group\.id, \{ memberIds: leaders, role: "leader" \}\)/);
  assert.match(actions, /The group was created, but the people weren’t added/);
  // Every action still re-derives the church and rights from the session.
  assert.match(actions, /const ctx = await requireGroupsStaff\(\{ adminOnly \}\)/);
  assert.match(actions, /saveMessagingSettings[\s\S]*?, true\); \}/);
  // Only messages written for people (VisitorError, StaffFieldError) pass through as is.
  for (const line of actions.split("\n").filter((l) => /error\.message/.test(l))) {
    assert.match(line, /instanceof (VisitorError|StaffFieldError)/, line);
  }
  assert.match(actions, /toUserError\(error, fallback\)/);
});

test("the people directory is scoped to the church", () => {
  const people = read("lib/groups/staff/people.ts");
  const fn = people.slice(people.indexOf("export async function listStaffPeopleOptions"), people.indexOf("export async function addStaffMembers"));
  assert.equal((fn.match(/\.eq\("church_id", ctx\.churchId\)/g) ?? []).length, 3);
  assert.match(fn, /loadStaffGroup\(ctx, groupId\)/);
});

// ---------------------------------------------------------------------------
// Add people
// ---------------------------------------------------------------------------

test("the add button counts the people chosen", () => {
  assert.equal(addPeopleLabel(3), "Add 3 people");
  assert.equal(addPeopleLabel(1), "Add 1 person");
  assert.equal(addPeopleLabel(0), "Add people");
  assert.equal(addedMessage("Choir", 1, ["Maria Lopez"]), "Maria Lopez added to Choir.");
  assert.equal(addedMessage("Choir", 3, ["a", "b", "c"]), "3 people added to Choir.");
});

test("the capacity error never offers to add them anyway", () => {
  assert.equal(capacityProblem(null, 10, 50), null);
  assert.equal(capacityProblem(12, 10, 2), null);
  assert.match(capacityProblem(12, 10, 3) ?? "", /Only 2 more people fit/);
  assert.match(capacityProblem(10, 10, 1) ?? "", /full/);
  for (const text of [capacityProblem(12, 10, 3), capacityProblem(10, 10, 1), read("lib/groups/staff/people.ts"), read("app/dashboard/groups/actions.ts")]) {
    assert.doesNotMatch(text ?? "", /anyway/i);
  }
});

test("Add people uses the SearchPicker so chosen people stay visible", () => {
  assert.match(read("components/groups/people-picker.tsx"), /<SearchPicker\s+multiple/);
  assert.match(read("components/groups/people.tsx"), /addPeopleLabel\(chosen\.length\)/);
});

// ---------------------------------------------------------------------------
// Navigation, messaging, safety
// ---------------------------------------------------------------------------

test("the Groups nav shows three everyday links, a labelled More row, and real counts", () => {
  const shared = read("components/groups/shared.tsx");
  assert.match(shared, /"All groups"[\s\S]*"Messages"[\s\S]*"Join requests"/);
  assert.match(shared, /More:/);
  assert.match(shared, /"Reports"[\s\S]*"Safety"[\s\S]*"Group settings"/);
  const page = read("app/dashboard/groups/[[...path]]/page.tsx");
  assert.match(page, /groupsNavCounts\(ctx\)/);
  assert.match(page, /<GroupsNav requests=\{counts\.requests\} reports=\{counts\.reports\} \/>/);
  const detail = read("components/groups/group-detail.tsx");
  assert.match(detail, /"Members"[\s\S]*"Chat"[\s\S]*"Meetings"[\s\S]*"About"/);
});

test("every group header has a Message group button that says who sees it", () => {
  const detail = read("components/groups/group-detail.tsx");
  assert.match(detail, /<MessageCircle[^>]*\/>\}\{archived \? "Read chat history" : "Message group"\}/);
  assert.match(detail, /Members on the app will see your message\./);
  assert.equal(reachSentence(14, 18), "14 of 18 people will see it. 4 people aren’t on the app yet.");
});

test("the Messages inbox leaves out groups with no chat and labels read-only ones", () => {
  const chat = read("components/groups/chat.tsx");
  assert.match(chat, /g\.chatState === "ready"/);
  assert.match(chat, /Read-only/);
  assert.match(chat, /no chat and/);
});

test("risky changes ask first; long forms don't lose work", () => {
  assert.match(read("components/groups/people.tsx"), /confirmAction\(\{ title: "Turn off this invite link\?"/);
  assert.match(read("components/groups/people.tsx"), /role === "manager" && !\(await confirmAction/);
  assert.match(read("components/groups/settings.tsx"), /confirmAction\(\{ title: `Delete/);
  const shared = read("components/groups/shared.tsx");
  assert.match(shared, /title: "Discard changes\?"/);
  assert.match(shared, /if \(e\.target === e\.currentTarget && !changed\) onClose\(\)/);
  for (const file of allGroupsUi) assert.doesNotMatch(read(file), /window\.(confirm|prompt)/, file);
  // The archive → type-the-name → delete flow stays.
  assert.match(read("components/groups/group-detail.tsx"), /Type “\$\{name\}” to confirm/);
});

// ---------------------------------------------------------------------------
// Density and tokens
// ---------------------------------------------------------------------------

test("groups.css uses design tokens and no text under 14px", () => {
  const css = read("app/dashboard/groups/groups.css");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  for (const [, size] of css.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(size) >= 14, `font-size ${size}px`);
  assert.doesNotMatch(css, /max-width:\s*1440px/);
});

test("Groups UI avoids tiny text and tiny buttons", () => {
  for (const file of allGroupsUi) {
    const src = read(file);
    assert.doesNotMatch(src, /text-xs|text-\[(9|10|11|12|13)px\]/, file);
    assert.doesNotMatch(src, /size="(xs|sm|icon-xs)"/, file);
  }
});

test("loading mirrors the pages: real titles, SkeletonContainer, no page max-width", () => {
  const skeleton = read("components/groups/skeletons.tsx");
  assert.match(skeleton, /<SkeletonContainer label=/);
  assert.match(skeleton, /<PageHeader title=\{copy\.title\}/);
  assert.match(skeleton, /<GroupsNav \/>/);
  assert.match(skeleton, /className="flex w-full flex-col gap-8"/);
  for (const file of [...allGroupsUi, "components/groups/skeletons.tsx"]) assert.doesNotMatch(read(file), /mx-auto max-w-/, file);
});
