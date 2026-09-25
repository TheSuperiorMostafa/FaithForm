import type { FeatureKey } from "@/lib/features/catalog";

/**
 * The questions churches ask most, answered in a sentence with a link to the
 * page that does it. Each answer only shows when this person can open that
 * page, so nobody is sent somewhere they can't go.
 */
export type HelpAnswer = {
  id: string;
  question: string;
  answer: string;
  href: string;
  linkLabel: string;
  feature: FeatureKey;
};

export const HELP_ANSWERS: readonly HelpAnswer[] = [
  {
    id: "add-person",
    question: "How do I add a person?",
    answer:
      "Open People and choose Add person. Fill in what you know; you can add more details later.",
    href: "/dashboard/people",
    linkLabel: "Go to People",
    feature: "people",
  },
  {
    id: "go-live",
    question: "How do I go live on Sunday?",
    answer:
      "Open Live and follow the steps on the page to start your broadcast. The page tells you when you're live.",
    href: "/dashboard/live-streaming",
    linkLabel: "Go to Live",
    feature: "live_stream",
  },
  {
    id: "check-in",
    question: "How do I check kids in?",
    answer:
      "Open Kids Check-in, find the child by name, and check them in.",
    href: "/dashboard/checkin",
    linkLabel: "Go to Kids Check-in",
    feature: "checkin",
  },
  {
    id: "announcement",
    question: "How do I post an announcement?",
    answer:
      "Open Announcements, write what's happening, and choose when it should appear in the app.",
    href: "/dashboard/announcements",
    linkLabel: "Go to Announcements",
    feature: "announcements",
  },
  {
    id: "giving",
    question: "How do I set up online giving?",
    answer:
      "Open Giving and follow the setup steps to connect your church's bank account. Gifts go straight to your church.",
    href: "/dashboard/giving",
    linkLabel: "Go to Giving",
    feature: "giving",
  },
];

export function helpAnswersFor(allowed: readonly FeatureKey[]): HelpAnswer[] {
  const set = new Set(allowed);
  return HELP_ANSWERS.filter((answer) => set.has(answer.feature));
}
