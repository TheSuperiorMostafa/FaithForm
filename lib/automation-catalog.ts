import type { FeatureKey } from "@/lib/features/catalog";

export type AutomationCategory =
  | "Calendar"
  | "Communication"
  | "Phone"
  | "Social"
  | "Admin";

export type TaskId = "CAL" | "ANN" | "CALL" | "SOC" | "REP" | "ATT" | "OUT";

export type AutomationEntry = {
  category: AutomationCategory;
  taskId: TaskId;
  minutes: number;
};

export const AUTOMATION_CATALOG = {
  "Attendance Follow-up Text": { category: "Communication", taskId: "OUT", minutes: 4 },
  "Church App Updated": {
    category: "Calendar",
    taskId: "CAL",
    minutes: 8,
  },
  "Update Church Calendar": {
    category: "Calendar",
    taskId: "CAL",
    minutes: 8,
  },
  "Announcement Email": {
    category: "Communication",
    taskId: "ANN",
    minutes: 5,
  },
  "Publish Announcement": {
    category: "Communication",
    taskId: "ANN",
    minutes: 5,
  },
  "Phone Call + Duration of Call": {
    category: "Phone",
    taskId: "CALL",
    minutes: 5,
  },
  "Rental Booked": { category: "Phone", taskId: "CALL", minutes: 11 },
  "Help is Asked About": { category: "Phone", taskId: "CALL", minutes: 6 },
  "Facebook Post about Announcement": {
    category: "Social",
    taskId: "SOC",
    minutes: 20,
  },
  "Monthly Attendance Report": {
    category: "Admin",
    taskId: "REP",
    minutes: 25,
  },
  "Quarterly Attendance Report": {
    category: "Admin",
    taskId: "REP",
    minutes: 40,
  },
  "Track Weekly Attendance": {
    category: "Admin",
    taskId: "ATT",
    minutes: 10,
  },
  "Missed 4 weeks in a row notification": {
    category: "Admin",
    taskId: "ATT",
    minutes: 22,
  },
  "Missed 2 weeks in a row notification": {
    category: "Admin",
    taskId: "ATT",
    minutes: 15,
  },
  "Personalized Pastoral Follow-up": {
    category: "Admin",
    taskId: "OUT",
    minutes: 60,
  },
  "Annual Attendance Report": {
    category: "Admin",
    taskId: "REP",
    minutes: 90,
  },
  "Sermon Created": {
    category: "Admin",
    taskId: "REP",
    minutes: 15,
  },
  "Sermon Outline Generated": {
    category: "Admin",
    taskId: "REP",
    minutes: 30,
  },
  "Sermon Draft Generated": {
    category: "Admin",
    taskId: "REP",
    minutes: 30,
  },
  "Sermon Published": {
    category: "Admin",
    taskId: "REP",
    minutes: 10,
  },
  "Discussion Questions Generated": {
    category: "Admin",
    taskId: "REP",
    minutes: 15,
  },
  "Sermon PDF Exported": {
    category: "Admin",
    taskId: "REP",
    minutes: 15,
  },
  "Sermon PPTX Exported": {
    category: "Admin",
    taskId: "REP",
    minutes: 45,
  },
  "Sermon Series Created": {
    category: "Admin",
    taskId: "REP",
    minutes: 45,
  },
  "Image Generation": { category: "Social", taskId: "SOC", minutes: 10 },
} as const satisfies Record<string, AutomationEntry>;

export type AutomationType = keyof typeof AUTOMATION_CATALOG;

/**
 * The product feature (lib/features/catalog.ts) each credit comes from, so the
 * admin Activity tab can filter by feature. Image Generation is credited from
 * Events graphics and the image chat; both sit under Events.
 */
export const AUTOMATION_FEATURE = {
  "Attendance Follow-up Text": "attendance_follow_up",
  "Church App Updated": "announcements",
  "Update Church Calendar": "announcements",
  "Announcement Email": "announcements",
  "Publish Announcement": "announcements",
  "Phone Call + Duration of Call": "voice_assistant",
  "Rental Booked": "voice_assistant",
  "Help is Asked About": "voice_assistant",
  "Facebook Post about Announcement": "announcements",
  "Monthly Attendance Report": "library",
  "Quarterly Attendance Report": "library",
  "Track Weekly Attendance": "attendance",
  "Missed 4 weeks in a row notification": "attendance",
  "Missed 2 weeks in a row notification": "attendance",
  "Personalized Pastoral Follow-up": "attendance_follow_up",
  "Annual Attendance Report": "library",
  "Sermon Created": "sermon_builder",
  "Sermon Outline Generated": "sermon_builder",
  "Sermon Draft Generated": "sermon_builder",
  "Sermon Published": "sermon_builder",
  "Discussion Questions Generated": "sermon_builder",
  "Sermon PDF Exported": "sermon_builder",
  "Sermon PPTX Exported": "sermon_builder",
  "Sermon Series Created": "sermon_builder",
  "Image Generation": "announcements",
} as const satisfies Record<AutomationType, FeatureKey>;

/** Activity types credited by a feature. */
export function automationTypesForFeature(feature: FeatureKey): AutomationType[] {
  return (Object.keys(AUTOMATION_FEATURE) as AutomationType[]).filter(
    (type) => AUTOMATION_FEATURE[type] === feature,
  );
}

export function featureForAutomationType(type: string): FeatureKey | null {
  return AUTOMATION_FEATURE[type as AutomationType] ?? null;
}

/** Types credited by operational-table derivation (excluded from activity_log extras). */
export const DERIVED_AUTOMATION_TYPES = new Set<string>([
  "Phone Call + Duration of Call",
  "Track Weekly Attendance",
  "Sermon Created",
  "Sermon Outline Generated",
  "Sermon Draft Generated",
  "Sermon Published",
]);

export function getCatalogMinutes(type: string): number {
  const entry = AUTOMATION_CATALOG[type as AutomationType];
  return entry?.minutes ?? 0;
}
