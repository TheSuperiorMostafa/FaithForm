/** Friendly labels for Monthly Report PDF top-automation list. */
const AUTOMATION_DISPLAY_LABELS: Record<string, string> = {
  "Facebook Post about Announcement": "Social Media Post Created",
  "Announcement Email": "Email Drafted for Bulletin & Tech",
  "Publish Announcement": "Announcement Published",
  "Update Church Calendar": "Church Calendar Updated",
  "Church App Updated": "Posted to Church App",
  "Monthly Attendance Report": "Created Monthly Attendance Report",
  "Quarterly Attendance Report": "Created Quarterly Attendance Report",
  "Annual Attendance Report": "Created Annual Attendance Report",
  "Phone Call + Duration of Call": "Phone Call Handled",
  "Sermon Outline Generated": "Sermon Outline Generated",
  "Sermon Draft Generated": "Sermon Draft Generated",
  "Sermon Created": "Sermon Created",
  "Sermon Published": "Sermon Published",
};

export function automationDisplayLabel(automationType: string): string {
  return AUTOMATION_DISPLAY_LABELS[automationType] ?? automationType;
}
