import type { ItemType, NoteCategory } from "@/lib/service-plans/types";

/**
 * The one-click Sunday Morning starter: a typical order, the usual teams, and
 * which notes each team sees. Everything here is a starting point the church
 * edits; nothing depends on these names afterwards.
 */

export const STARTER_SERVICE_TYPE = {
  name: "Sunday Morning",
  defaultWeekday: 0,
  targetSeconds: 75 * 60,
  times: [
    { kind: "rehearsal", label: "Rehearsal", weekday: 6, localTime: "18:00" },
    { kind: "service", label: "Service", weekday: 0, localTime: "09:00" },
  ],
} as const;

export const STARTER_ITEMS: {
  itemType: ItemType;
  title: string;
  lengthSeconds: number;
  description?: string;
  position?: string;
}[] = [
  { itemType: "header", title: "Pre-Service", lengthSeconds: 0 },
  { itemType: "item", title: "Welcome", lengthSeconds: 2 * 60, description: "Greet everyone and introduce the service." },
  {
    itemType: "item",
    title: "Announcements",
    lengthSeconds: 3 * 60,
    description: "Welcome guests, upcoming events, offering reminder.",
  },
  { itemType: "header", title: "Worship", lengthSeconds: 0 },
  { itemType: "song", title: "Opening song", lengthSeconds: 5 * 60 },
  { itemType: "song", title: "Worship song", lengthSeconds: 5 * 60 },
  { itemType: "song", title: "Worship song", lengthSeconds: 5 * 60 },
  { itemType: "item", title: "Offering", lengthSeconds: 4 * 60 },
  { itemType: "header", title: "Message", lengthSeconds: 0 },
  { itemType: "item", title: "Message", lengthSeconds: 35 * 60 },
  { itemType: "song", title: "Response song", lengthSeconds: 5 * 60 },
  { itemType: "item", title: "Closing", lengthSeconds: 2 * 60, description: "Benediction and dismissal." },
];

export const STARTER_TEAMS: { name: string; positions: string[]; categories: NoteCategory[] }[] = [
  { name: "Worship", positions: ["Worship leader", "Vocals", "Keys", "Guitar", "Bass", "Drums"], categories: ["general", "worship"] },
  { name: "Tech", positions: ["Sound", "Slides", "Lights", "Stream"], categories: ["general", "tech", "slides"] },
  { name: "Welcome", positions: ["Greeter", "Usher"], categories: ["general"] },
];

/** Default categories for a team the church adds later, from its name. */
export function defaultCategoriesForTeam(name: string): NoteCategory[] {
  const n = name.toLowerCase();
  if (/tech|sound|media|production|av\b|stream|light/.test(n)) return ["general", "tech", "slides"];
  if (/worship|music|band|choir|vocal/.test(n)) return ["general", "worship"];
  return ["general"];
}
