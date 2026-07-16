import type { ChurchProfileForVoice } from "@/lib/queries/voice-assistant";
import { getGivePageUrl } from "@/lib/stripe/config";
import {
  buildRetellStates,
  RETELL_STARTING_STATE,
  type RetellStateDefinition,
} from "@/lib/integrations/retell-prompt-states";
import type {
  SpeakingPace,
  VoiceAssistantContext,
  VoiceAssistantSettings,
  VoiceTone,
} from "@/types/voice-assistant";

const GENERAL_PROMPT_TEMPLATE = `You are {{assistant_name}} at {{church_name}}. You've answered this church phone for years.

IDENTITY
- You represent {{church_name}}, a {{denomination}} church at {{address}}.
- You are a warm church secretary — not customer support, not a chatbot, not a call center, not a virtual assistant.
- Friendly. Calm. Comfortable. Confident. Natural. Never overly enthusiastic. Never overly formal.

PERSONALITY FILTER (soft — stay human either way)
- Preferred tone color: {{tone}}
- Preferred pace feel: {{pace}}
- These nudge you; they never turn you into a script or a corporate agent.

HOW YOU SPEAK
- Answer first. Explain only if they need it.
- Short sentences. Vary length. Occasional trailing thought is fine.
- Perfect textbook grammar every turn sounds fake — be clear, not polished.
- One question at a time. Never stack questions.
- Don't repeat their question back. Don't over-confirm. Don't over-explain.
- Don't sound prepared, scripted, or like documentation.
- Don't force the conversation forward. Comfortable silence is okay.
- Prefer spontaneous wording. Same idea, different words next time.

NEVER SOUND LIKE THIS
Avoid these habits and anything in the same family:
- "Absolutely!" / "Certainly." / "Of course!"
- "I'd be happy to help" / "How may I assist you today?"
- "Thank you for your patience" / "I understand" as filler
- Repeating the caller's question
- Explaining obvious things
- Long paragraph answers
- Robotic greetings, confirmations, or transitions
- Salesy or corporate phrasing

EMOTIONAL MIRRORING
Adapt continuously without performing:
- Confused → slow down, simpler words
- Excited → a little brighter, still grounded
- Upset → calmer, softer, fewer words
- Elderly → simpler, unhurried
- In a hurry → short answers, no extras
Never fake empathy. Never match anger with anger.

TURN-TAKING & INTERRUPTIONS
- Don't rush to fill silence.
- Don't dump information.
- If interrupted, drop the old track and answer what they just said.
- If you were mid-list and they cut in, don't restart from the top unless they ask.

WHAT YOU KNOW (live data — stay inside this)
Service schedule:
{{service_schedule}}

Upcoming events:
{{upcoming_events}}

Pastoral staff:
{{staff_list}}

Kids and youth programs:
{{programs}}

Address and parking:
{{address_and_parking}}

Giving:
{{giving_info}}

GUARDRAILS
- Never invent facts. If it's not here, say you don't have it and offer the office if that helps.
- Never discuss theology, politics, or other churches.
- Never take financial information over the phone.
- Never give out a pastor's personal number.
- Don't say you're an AI unless they directly and seriously ask. If they do: "I'm the phone assistant for {{church_name}}."
- Be patient. Some callers are elderly, nervous, or hurting.`;

const TONE_LABELS: Record<VoiceTone, string> = {
  warm_friendly: "warm and friendly — like someone who knows half the congregation by name",
  professional: "steady and clear — still a church desk, never corporate",
  traditional_formal: "a bit more traditional and respectful — still natural speech, not stiff",
};

const PACE_LABELS: Record<SpeakingPace, string> = {
  slow: "unhurried; leave space",
  normal: "natural conversational pace",
  energetic: "a touch brighter and quicker — still calm, never peppy",
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

/** Replace form placeholders so Retell never speaks bracket tokens literally. */
export function resolveGreetingTemplate(
  template: string,
  vars: { assistantName: string; churchName: string; officeHours?: string },
): string {
  return template
    .replace(/\[\s*Assistant Name\s*\]/gi, vars.assistantName)
    .replace(/\[\s*Church Name\s*\]/gi, vars.churchName)
    .replace(/\[\s*Name\s*\]/gi, vars.assistantName)
    .replace(/\[\s*hours\s*\]/gi, vars.officeHours?.trim() || "our normal office hours")
    .replace(/\{\{\s*assistant_name\s*\}\}/gi, vars.assistantName)
    .replace(/\{\{\s*church_name\s*\}\}/gi, vars.churchName)
    .trim();
}

export type RetellLlmConversation = {
  general_prompt: string;
  begin_message: string | undefined;
  starting_state: string;
  states: RetellStateDefinition[];
  greeting: string;
  signoff: string;
  afterHoursMessage: string;
  officeHours: string;
  transferNumber: string;
  emergencyContact: string;
  hasOfficeTransfer: boolean;
  hasEmergencyTransfer: boolean;
};

function resolveSpokenMessages(
  settings: VoiceAssistantSettings,
  church: ChurchProfileForVoice,
) {
  const assistantName = settings.assistant_name?.trim() || "the church desk";
  const officeHours = formatOfficeHours(settings);
  const spokenVars = {
    assistantName,
    churchName: church.name,
    officeHours,
  };

  const rawGreeting =
    settings.greeting_message?.trim() ||
    `Hi, you've reached ${church.name}. This is ${assistantName}.`;
  const greeting = resolveGreetingTemplate(rawGreeting, spokenVars);

  const signoff = resolveGreetingTemplate(
    settings.signoff_message?.trim() || "Alright — take care. God bless.",
    spokenVars,
  );

  const afterHoursMessage = resolveGreetingTemplate(
    settings.after_hours_message?.trim() ||
      "The office is closed right now. You can leave a message and someone will get back to you.",
    spokenVars,
  );

  const transferNumber =
    settings.church_phone?.trim() || church.phone?.trim() || "the church office";
  const emergencyContact =
    settings.emergency_phone?.trim() || "the emergency contact on file";

  return {
    assistantName,
    officeHours,
    greeting,
    signoff,
    afterHoursMessage,
    transferNumber,
    emergencyContact,
  };
}

export function buildRetellGeneralPrompt(
  settings: VoiceAssistantSettings,
  context: VoiceAssistantContext,
  church: ChurchProfileForVoice,
): string {
  const spoken = resolveSpokenMessages(settings, church);

  const variables: Record<string, string> = {
    assistant_name: spoken.assistantName,
    church_name: church.name,
    denomination: settings.denomination?.trim() || "Christian",
    address: formatChurchAddress(church),
    tone: TONE_LABELS[settings.tone],
    pace: PACE_LABELS[settings.speaking_pace],
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
  };

  return fillTemplate(GENERAL_PROMPT_TEMPLATE, variables);
}

/** Full Multi-Prompt conversation payload pieces for Retell LLM sync. */
export function buildRetellLlmConversation(
  settings: VoiceAssistantSettings,
  context: VoiceAssistantContext,
  church: ChurchProfileForVoice,
  options?: {
    hasOfficeTransfer?: boolean;
    hasEmergencyTransfer?: boolean;
  },
): RetellLlmConversation {
  const spoken = resolveSpokenMessages(settings, church);
  const hasOfficeTransfer = options?.hasOfficeTransfer ?? false;
  const hasEmergencyTransfer = options?.hasEmergencyTransfer ?? false;

  const general_prompt = buildRetellGeneralPrompt(settings, context, church);
  const states = buildRetellStates({
    greeting_message: spoken.greeting,
    signoff_message: spoken.signoff,
    after_hours_message: spoken.afterHoursMessage,
    office_hours: spoken.officeHours,
    after_hours_mode: settings.after_hours_enabled ? "ON" : "OFF",
    transfer_number: spoken.transferNumber,
    emergency_contact: spoken.emergencyContact,
    has_office_transfer: hasOfficeTransfer,
    has_emergency_transfer: hasEmergencyTransfer,
  });

  return {
    general_prompt,
    begin_message: spoken.greeting,
    starting_state: RETELL_STARTING_STATE,
    states,
    greeting: spoken.greeting,
    signoff: spoken.signoff,
    afterHoursMessage: spoken.afterHoursMessage,
    officeHours: spoken.officeHours,
    transferNumber: spoken.transferNumber,
    emergencyContact: spoken.emergencyContact,
    hasOfficeTransfer,
    hasEmergencyTransfer,
  };
}
