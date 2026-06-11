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
  "Church App Updated": {
    category: "Calendar",
    taskId: "CAL",
    minutes: 6,
  },
  "Update Church Calendar": {
    category: "Calendar",
    taskId: "CAL",
    minutes: 8,
  },
  "Announcement Email": {
    category: "Communication",
    taskId: "ANN",
    minutes: 20,
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
    minutes: 15,
  },
  "Right Now Media Post": { category: "Social", taskId: "SOC", minutes: 7 },
  "Pastor Repost Live on Personal Account": {
    category: "Social",
    taskId: "SOC",
    minutes: 5,
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
    minutes: 5,
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
  "Missed Sunday list creation and send": {
    category: "Admin",
    taskId: "ATT",
    minutes: 10,
  },
  "Sent Personalized Pastoral Follow up if msg": {
    category: "Admin",
    taskId: "OUT",
    minutes: 60,
  },
  "Annual Attendance Report": {
    category: "Admin",
    taskId: "REP",
    minutes: 45,
  },
  "Sermon Created": {
    category: "Admin",
    taskId: "REP",
    minutes: 10,
  },
  "Sermon Outline Generated": {
    category: "Admin",
    taskId: "REP",
    minutes: 20,
  },
  "Sermon Draft Generated": {
    category: "Admin",
    taskId: "REP",
    minutes: 30,
  },
  "Sermon Published": {
    category: "Admin",
    taskId: "REP",
    minutes: 5,
  },
  "Social Snippet Generated": {
    category: "Social",
    taskId: "SOC",
    minutes: 7,
  },
  "Discussion Questions Generated": {
    category: "Admin",
    taskId: "REP",
    minutes: 10,
  },
  "Sermon PDF Exported": {
    category: "Admin",
    taskId: "REP",
    minutes: 8,
  },
  "Sermon PPTX Exported": {
    category: "Admin",
    taskId: "REP",
    minutes: 12,
  },
  "Sermon Series Created": {
    category: "Admin",
    taskId: "REP",
    minutes: 15,
  },
} as const satisfies Record<string, AutomationEntry>;

export type AutomationType = keyof typeof AUTOMATION_CATALOG;

/** Types credited by operational-table derivation (excluded from activity_log extras). */
export const DERIVED_AUTOMATION_TYPES = new Set<string>([
  "Church App Updated",
  "Facebook Post about Announcement",
  "Announcement Email",
  "Phone Call + Duration of Call",
  "Track Weekly Attendance",
  "Monthly Attendance Report",
  "Quarterly Attendance Report",
  "Annual Attendance Report",
  "Right Now Media Post",
  "Pastor Repost Live on Personal Account",
]);

export function getCatalogMinutes(type: string): number {
  const entry = AUTOMATION_CATALOG[type as AutomationType];
  return entry?.minutes ?? 0;
}
