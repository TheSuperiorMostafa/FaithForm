/**
 * The name and one-sentence description of each top-level Groups page. Used
 * by the page and by its loading skeleton, so the static text is identical in
 * both (static-first skeletons: titles never shimmer).
 */
export const GROUPS_SECTIONS = {
  list: { title: "Groups", description: "Small groups, classes and teams in your church: who’s in them and when they meet." },
  messages: { title: "Group messages", description: "Read and send messages in your groups’ chats. Members on the app see them." },
  requests: { title: "Join requests", description: "People who asked to join a group in the app. Approve them to add them." },
  insights: { title: "Reports", description: "How many people are in groups, and who is showing up." },
  moderation: { title: "Safety", description: "Messages people have reported in the app, and what your team did about them." },
  settings: { title: "Group settings", description: "Church-wide settings for group chats, and the kinds of groups people can choose." },
} as const;

export type GroupsSection = keyof typeof GROUPS_SECTIONS;
