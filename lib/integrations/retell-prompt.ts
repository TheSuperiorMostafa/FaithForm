import type { ChurchProfileForVoice } from "@/lib/queries/voice-assistant";
import { getGivePageUrl } from "@/lib/stripe/config";
import type {
  SpeakingPace,
  VoiceAssistantContext,
  VoiceAssistantSettings,
  VoiceTone,
} from "@/types/voice-assistant";

const MASTER_PROMPT_TEMPLATE = `You are {{assistant_name}}, the voice assistant for {{church_name}}.

IDENTITY
- You represent {{church_name}}, a {{denomination}} church located at {{address}}.
- Your role is to warmly welcome callers and help them with any questions about the church.

PERSONALITY
- Tone: {{tone}} — match this in every response. Never sound robotic or corporate.
- Speaking pace: {{pace}}
- Always sound like a caring member of the church community, not a call center agent.
- Keep responses concise — this is a phone call, not a lecture.
- Never say "I am an AI" unless the caller directly and seriously asks. If asked, say "I'm the virtual assistant for {{church_name}}."

GREETING
When a call starts, say exactly: "{{greeting_message}}"

WHAT YOU KNOW (pulled from live data)
- Service schedule: {{service_schedule}}
- Upcoming events: {{upcoming_events}}
- Pastoral staff: {{staff_list}}
- Kids and youth programs: {{programs}}
- Address and parking: {{address_and_parking}}
- Giving information: {{giving_info}}

HOW TO HANDLE COMMON CALLS
- Service times: Answer directly and clearly. Mention if there are multiple services.
- New visitors: Be extra warm. Mention what to expect, where to park, that they are welcome.
- Events: List only the next 2-3 upcoming events unless they ask for more.
- Prayer requests: Say "I'd be honored to pass your prayer request along. Would you like to share it?" Then summarize and say it will be forwarded to the pastoral team.
- Pastoral contact: Offer to transfer or give the office contact. Never give out a pastor's personal number.
- Giving: Briefly explain options (in-person, online) and offer to send a text with the giving link.
- Kids/Youth: Describe the programs and age groups warmly.
- Emergencies or crisis: Immediately say "I'm going to connect you with someone who can help" and use the transfer_emergency tool to reach {{emergency_contact}}.

AFTER HOURS (if {{after_hours_mode}} is ON and current time is outside {{office_hours}})
Say: "{{after_hours_message}}" Then offer to take a message or transfer for emergencies only.

HUMAN TRANSFER
If a caller is frustrated, confused, or asks for a real person, say:
"Of course, let me connect you with our team." Then use the transfer_to_church_office tool to reach {{transfer_number}}.

SIGN OFF
End calls with: "{{signoff_message}}"

RULES
- Never make up information. If you don't know something, say "I don't have that information right now, but our team would be happy to help. Would you like me to connect you?"
- Never discuss theology, politics, or other churches.
- Never take financial information over the phone.
- Always be patient. Some callers may be elderly or in distress.`;

const TONE_LABELS: Record<VoiceTone, string> = {
  warm_friendly: "Warm & Friendly",
  professional: "Professional",
  traditional_formal: "Traditional & Formal",
};

const PACE_LABELS: Record<SpeakingPace, string> = {
  slow: "Slow",
  normal: "Normal",
  energetic: "Energetic",
};

function formatOfficeHours(settings: VoiceAssistantSettings): string {
  const dayLabels: Record<string, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };

  const lines = Object.entries(settings.office_hours)
    .filter(([, hours]) => hours.enabled)
    .map(([key, hours]) => {
      const label = dayLabels[key] ?? key;
      return `${label}: ${hours.open} – ${hours.close}`;
    });

  return lines.length > 0 ? lines.join("; ") : "Not configured";
}

function formatList(items: string[], emptyMessage: string): string {
  if (items.length === 0) return emptyMessage;
  return items.map((item) => `- ${item}`).join("\n");
}

function formatChurchAddress(church: ChurchProfileForVoice): string {
  const parts = [
    church.address,
    [church.city, church.state].filter(Boolean).join(", "),
    church.zip,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "Address not on file";
}

function formatAddressAndParking(church: ChurchProfileForVoice): string {
  const address = formatChurchAddress(church);
  if (address === "Address not on file") {
    return "Address and parking details are not on file. Offer to connect the caller with the church office.";
  }
  return `${address}. Parking is typically available on site — invite new visitors to look for guest parking or the main entrance.`;
}

function formatGivingInfo(church: ChurchProfileForVoice): string {
  if (church.stripeChargesEnabled && church.slug) {
    const giveUrl = getGivePageUrl(church.slug);
    return `Gifts can be given in person during services or online at ${giveUrl}. Offer to text the giving link if the caller would like it.`;
  }
  return "Gifts can be given in person during services. Online giving is not set up yet — offer to connect the caller with the church office for giving questions.";
}

function fillTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return variables[key] ?? "";
  });
}

export function buildRetellGeneralPrompt(
  settings: VoiceAssistantSettings,
  context: VoiceAssistantContext,
  church: ChurchProfileForVoice,
): string {
  const assistantName = settings.assistant_name?.trim() || "the church assistant";
  const greeting =
    settings.greeting_message?.trim() ||
    `Thank you for calling ${church.name}. This is ${assistantName}, how can I help you today?`;
  const signoff =
    settings.signoff_message?.trim() || "God bless you. Have a wonderful day.";
  const transferNumber =
    settings.church_phone?.trim() || church.phone?.trim() || "the church office";
  const emergencyContact =
    settings.emergency_phone?.trim() || "the emergency contact on file";

  const variables: Record<string, string> = {
    assistant_name: assistantName,
    church_name: church.name,
    denomination: settings.denomination?.trim() || "Christian",
    address: formatChurchAddress(church),
    tone: TONE_LABELS[settings.tone],
    pace: PACE_LABELS[settings.speaking_pace],
    greeting_message: greeting,
    service_schedule: formatList(
      context.serviceSchedule,
      "No service times on file yet.",
    ),
    upcoming_events: formatList(
      context.upcomingEvents.slice(0, 5),
      "No upcoming events on file yet.",
    ),
    staff_list: formatList(
      context.pastoralStaff,
      "No staff contacts on file yet. Offer to connect the caller with the church office.",
    ),
    programs: formatList(
      context.programs,
      "No kids or youth programs on file yet.",
    ),
    address_and_parking: formatAddressAndParking(church),
    giving_info: formatGivingInfo(church),
    after_hours_mode: settings.after_hours_enabled ? "ON" : "OFF",
    office_hours: formatOfficeHours(settings),
    after_hours_message:
      settings.after_hours_message?.trim() ||
      "Our office is currently closed. Please leave a message and we will get back to you.",
    emergency_contact: emergencyContact,
    transfer_number: transferNumber,
    signoff_message: signoff,
  };

  return fillTemplate(MASTER_PROMPT_TEMPLATE, variables);
}
