/**
 * The titles and one-line descriptions of the Attendance pages, shared by each
 * page and its loading skeleton so the static text is identical in both
 * (static-first: only data shimmers). Titles match the section tabs.
 */
export const ATTENDANCE_COPY = {
  sundayCount: {
    title: "Sunday count",
    description:
      "Pick a Sunday to count who came. Anyone who checked in on their phone, at the kiosk or in a kids room is already counted.",
  },
  followUp: {
    title: "Follow-up",
    description: "Send a friendly text to people who missed a Sunday. Nothing is sent until you choose.",
  },
  followUpLog: {
    title: "Message log",
    description: "Every text your church has sent to people who missed, grouped by Sunday.",
  },
  services: {
    title: "Services",
    description:
      "Every service that counts attendance, on any day. Open one to see who came or mark people by hand.",
  },
  setup: {
    title: "Setup",
    description:
      "Your service times, and the ways people can check in. Changes apply to services that haven't started yet.",
  },
} as const;
