/**
 * Shapes shared by the Service Plans screens, server actions, PDF and share
 * pages. Database rows are mapped into these in `queries.ts`; nothing outside
 * that file sees snake_case.
 */

export const ITEM_TYPES = ["item", "song", "header", "media"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const NOTE_CATEGORIES = ["general", "tech", "worship", "slides"] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export const NOTE_CATEGORY_LABELS: Record<NoteCategory, string> = {
  general: "General",
  tech: "Tech and sound",
  worship: "Worship",
  slides: "Slides",
};

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  item: "Item",
  song: "Song",
  header: "Header",
  media: "Media",
};

export const TIME_KINDS = ["service", "rehearsal", "other"] as const;
export type TimeKind = (typeof TIME_KINDS)[number];

export const TEAM_MEMBER_STATUSES = ["unconfirmed", "confirmed", "declined"] as const;
export type TeamMemberStatus = (typeof TEAM_MEMBER_STATUSES)[number];

export const SHARE_PRESETS = ["full", "team", "person", "order"] as const;
export type SharePreset = (typeof SHARE_PRESETS)[number];

export const SHARE_PRESET_LABELS: Record<SharePreset, string> = {
  full: "Full plan",
  team: "Team view",
  person: "Person view",
  order: "Order only",
};

export const SHARE_CHANNELS = ["email", "sms", "in_app", "link"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export type ServiceTypeTime = {
  id: string;
  kind: TimeKind;
  label: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** `HH:mm`. */
  localTime: string;
};

export type ServiceType = {
  id: string;
  name: string;
  defaultWeekday: number | null;
  targetSeconds: number | null;
  defaultTemplateId: string | null;
  times: ServiceTypeTime[];
};

export type ServiceTypeSummary = ServiceType & {
  nextPlan: { id: string; date: string; firstTime: string | null } | null;
  upcomingCount: number;
  defaultTemplateName: string | null;
};

export type PlanTime = {
  id: string;
  kind: TimeKind;
  label: string;
  /** ISO timestamp. */
  startsAt: string;
};

export type Leader = {
  /** Row id is not needed by the UI; the set is replaced atomically. */
  personId: string | null;
  teamPositionId: string | null;
  /** Person's name, or the open position's name. */
  name: string;
  /** For an open position: "Worship · Keys". */
  positionLabel: string | null;
  photoUrl: string | null;
};

export type PlanNote = {
  id: string;
  itemId: string | null;
  category: NoteCategory;
  body: string;
  updatedAt: string;
};

export type PlanItemSong = {
  songId: string;
  title: string;
  author: string | null;
  ccliNumber: string | null;
  arrangementId: string | null;
  arrangementName: string | null;
  key: string | null;
};

export type PlanItem = {
  id: string;
  position: string;
  itemType: ItemType;
  title: string;
  lengthSeconds: number;
  description: string | null;
  mediaUrl: string | null;
  song: PlanItemSong | null;
  leaders: Leader[];
  updatedAt: string;
  updatedBy: string | null;
};

export type PlanTeamMember = {
  id: string;
  teamId: string;
  teamName: string;
  positionId: string;
  positionName: string;
  personId: string;
  personName: string;
  status: TeamMemberStatus;
};

export type TeamStatus = {
  confirmed: number;
  pending: number;
  unfilled: number;
};

export type Plan = {
  id: string;
  serviceTypeId: string;
  serviceTypeName: string;
  /** `YYYY-MM-DD`, null for templates. */
  date: string | null;
  title: string | null;
  series: string | null;
  isTemplate: boolean;
  shareVersion: number;
  /** Highest version any live share was sent at; null when never shared. */
  lastSharedVersion: number | null;
  targetSeconds: number | null;
  times: PlanTime[];
  items: PlanItem[];
  notes: PlanNote[];
  team: PlanTeamMember[];
  updatedAt: string;
};

export type PlanListRow = {
  id: string;
  date: string;
  title: string | null;
  series: string | null;
  itemCount: number;
  totalSeconds: number;
  teamStatus: TeamStatus;
};

export type Team = {
  id: string;
  name: string;
  noteCategories: NoteCategory[];
  positions: { id: string; name: string }[];
};

export type PersonOption = {
  id: string;
  name: string;
  photoUrl: string | null;
};
