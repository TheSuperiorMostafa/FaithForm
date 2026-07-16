/**
 * Retell Multi-Prompt state definitions for the church voice assistant.
 * System prompt per turn = general_prompt + state_prompt.
 */

export type RetellStateEdge = {
  destination_state_name: string;
  description: string;
};

export type RetellStateDefinition = {
  name: string;
  state_prompt: string;
  edges?: RetellStateEdge[];
  /** Tool names to attach from the shared tool catalog (built in retell.ts). */
  toolNames?: string[];
};

export type RetellStatePromptVars = {
  greeting_message: string;
  signoff_message: string;
  after_hours_message: string;
  office_hours: string;
  after_hours_mode: "ON" | "OFF";
  transfer_number: string;
  emergency_contact: string;
  has_office_transfer: boolean;
  has_emergency_transfer: boolean;
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

const GREETING_PROMPT = `## Task
You just answered the church phone. A begin message may already have been spoken — do not repeat it.

Your only job here:
1. Listen for what they need.
2. Route to the right place.

## Routing
- Crisis, suicide risk, abuse, medical emergency, or urgent pastoral danger → transition_to_emergency immediately. Do not chat first.
- After-hours mode is {{after_hours_mode}}. Office hours: {{office_hours}}.
  - If mode is ON and it is clearly outside office hours → transition_to_after_hours (unless they only need a quick info answer you already have — then go to conversation).
- Otherwise → transition_to_conversation as soon as their intent is clear, even mid-sentence.

## Style
Keep this state short. One warm beat if they haven't spoken yet is fine — then listen. Do not stack questions. Do not pitch help.`;

const CONVERSATION_PROMPT = `## Task
Help with everyday church questions the way a longtime church secretary would — calm, direct, human.

## What to handle here
- Service times: answer straight. If there are a few services, say so simply.
- Visitors / first-timers: warm, not gushy. Parking, what to expect, that they're welcome — only what they asked for.
- Events: next 2–3 unless they want more.
- Kids / youth: programs and ages, briefly.
- Staff / pastoral contact: {{staff_contact_guidance}}
- Giving: short — in person and/or online from what you know. No card numbers, no banking details.
- Directions / parking: from what you know. If thin, say so and offer the office.
- Small talk: fine in small doses. Don't force it. Don't steer every turn back to "how can I help."

## When to leave this state
- They want to leave a prayer request → transition_to_prayer_request
{{transfer_transition_line}}- Crisis / emergency → transition_to_emergency right away
- Call is wrapping up / they're done → transition_to_wrap_up
- Clearly after hours and they need the office (not just info) → transition_to_after_hours

## Style for this state
Answer first. One question at a time if you need something. Prefer one or two short sentences over a speech. If you don't know it, say you don't — then ask if they want the office. Never invent schedule, names, or policies.`;

const PRAYER_REQUEST_PROMPT = `## Task
Take a prayer request the way someone at the church desk would — quiet, patient, no performance.

## Flow
1. Invite them to share, simply. One open question. Then stop talking.
2. Listen. Soft acknowledgements are fine. Don't interrupt with process talk.
3. When they're done, briefly reflect what you heard in plain words — not a polished paraphrase speech.
4. Say you'll pass it to the pastoral team. Don't oversell how honored you are.
5. Ask if there's anything else, then:
   - more church questions → transition_to_conversation
   - done → transition_to_wrap_up
{{prayer_transfer_bullet}}   - crisis emerges → transition_to_emergency

## Style
Slower than usual. Comfortable with silence. Never stack questions. Never turn prayer into a form.`;

const AFTER_HOURS_PROMPT = `## Task
Office is closed. Be clear and kind — not apologetic theater.

## Content to convey
Something like: "{{after_hours_message}}"
Say it naturally; don't sound like you're reading a policy.

Office hours for reference: {{office_hours}}

## What you can still do
- Answer simple info you already know (times, address, events) — or transition_to_conversation if they're in a normal Q&A.
- Offer to leave a short message for the office (name + callback + what they need), then transition_to_wrap_up when done.
- Real emergency / crisis → transition_to_emergency only.
- Do not pretend staff are available. Do not over-promise callbacks.`;

const TRANSFER_OFFICE_PROMPT = `## Task
Hand them to the church office. Keep it brief and human.

Transfer destination: {{transfer_number}}

## Flow
1. One short line that you're connecting them — vary the wording. No "Of course" / "Absolutely" / "I'd be happy to."
2. Call transfer_to_church_office right away. Don't narrate the tool. Don't ask more questions.

If transfer isn't possible, say the office path didn't go through and offer to take a message, then transition isn't available — stay calm and close toward wrap-up by asking if they want to leave a note (then they'll need to go back via conversation if still needed). Prefer completing the transfer.`;

const EMERGENCY_PROMPT = `## Task
Someone may be in crisis. Stay calm. Move now.

Emergency contact: {{emergency_contact}}

## Flow
1. One short line: you're connecting them with someone who can help.
2. Call transfer_emergency immediately.
3. No questions. No theology. No delay. No small talk.`;

const WRAP_UP_PROMPT = `## Task
End the call cleanly.

Sign-off flavor to use (say naturally, not robotically): "{{signoff_message}}"

## Flow
1. Brief goodbye — warm, short, not a speech.
2. Call end_call.
3. Don't reopen the whole conversation unless they clearly start a new ask mid-goodbye.`;

export function buildRetellStates(
  vars: RetellStatePromptVars,
): RetellStateDefinition[] {
  const fillVars: Record<string, string> = {
    greeting_message: vars.greeting_message,
    signoff_message: vars.signoff_message,
    after_hours_message: vars.after_hours_message,
    office_hours: vars.office_hours,
    after_hours_mode: vars.after_hours_mode,
    transfer_number: vars.transfer_number,
    emergency_contact: vars.emergency_contact,
    staff_contact_guidance: vars.has_office_transfer
      ? "offer the office path. Never give a pastor's personal number."
      : "share what you know from the staff list. Never give a pastor's personal number. If they need someone live, take a message.",
    transfer_transition_line: vars.has_office_transfer
      ? "- Frustrated, confused after you tried, or asks for a real person / pastor / staff → transition_to_transfer_office\n"
      : "- Frustrated or asks for a real person → take a clear message (name, number, need) and offer wrap-up\n",
    prayer_transfer_bullet: vars.has_office_transfer
      ? "   - want a person → transition_to_transfer_office\n"
      : "",
  };

  const transferEdge: RetellStateEdge | null = vars.has_office_transfer
    ? {
        destination_state_name: "transfer_office",
        description:
          "Caller wants a real person, pastor, or staff; is frustrated; or needs the office after you couldn't help.",
      }
    : null;

  const emergencyEdge: RetellStateEdge = {
    destination_state_name: "emergency",
    description:
      "Crisis, suicide risk, abuse, medical emergency, or urgent pastoral danger — transition immediately.",
  };

  const greetingEdges: RetellStateEdge[] = [
    {
      destination_state_name: "conversation",
      description:
        "Caller has a normal question or need, or finished greeting and is ready to talk.",
    },
    {
      destination_state_name: "after_hours",
      description:
        "After-hours mode is ON and it is outside office hours, and they need office handling rather than a quick info answer.",
    },
    emergencyEdge,
  ];

  const conversationEdges: RetellStateEdge[] = [
    {
      destination_state_name: "prayer_request",
      description: "Caller wants to leave or share a prayer request.",
    },
    {
      destination_state_name: "wrap_up",
      description: "Caller is done, saying goodbye, or the need is fully met.",
    },
    {
      destination_state_name: "after_hours",
      description:
        "Outside office hours and they need the office or to leave a message (not just info).",
    },
    emergencyEdge,
  ];
  if (transferEdge) conversationEdges.splice(1, 0, transferEdge);

  const prayerEdges: RetellStateEdge[] = [
    {
      destination_state_name: "conversation",
      description: "Prayer request is handled and they have another church question.",
    },
    {
      destination_state_name: "wrap_up",
      description: "Prayer request is handled and they are finished.",
    },
    emergencyEdge,
  ];
  if (transferEdge) prayerEdges.splice(2, 0, transferEdge);

  const afterHoursEdges: RetellStateEdge[] = [
    {
      destination_state_name: "conversation",
      description:
        "They only need information you know (times, address, events) — continue helping.",
    },
    {
      destination_state_name: "wrap_up",
      description: "Message taken or they're done for now.",
    },
    emergencyEdge,
  ];

  const states: RetellStateDefinition[] = [
    {
      name: "greeting",
      state_prompt: fill(GREETING_PROMPT, fillVars),
      edges: greetingEdges,
    },
    {
      name: "conversation",
      state_prompt: fill(CONVERSATION_PROMPT, fillVars),
      edges: conversationEdges,
    },
    {
      name: "prayer_request",
      state_prompt: fill(PRAYER_REQUEST_PROMPT, fillVars),
      edges: prayerEdges,
    },
    {
      name: "after_hours",
      state_prompt: fill(AFTER_HOURS_PROMPT, fillVars),
      edges: afterHoursEdges,
    },
    {
      name: "wrap_up",
      state_prompt: fill(WRAP_UP_PROMPT, fillVars),
      toolNames: ["end_call"],
    },
  ];

  if (vars.has_office_transfer) {
    states.push({
      name: "transfer_office",
      state_prompt: fill(TRANSFER_OFFICE_PROMPT, fillVars),
      toolNames: ["transfer_to_church_office"],
    });
  }

  if (vars.has_emergency_transfer) {
    states.push({
      name: "emergency",
      state_prompt: fill(EMERGENCY_PROMPT, fillVars),
      toolNames: ["transfer_emergency"],
    });
  } else {
    // Still allow the edge targets to exist as a calm fallback state without a tool.
    states.push({
      name: "emergency",
      state_prompt: fill(
        `## Task
Someone may be in crisis. Stay calm.

No emergency transfer number is configured. Tell them gently you can't connect an emergency line from this call, and urge them to call local emergency services (911 in the US) or a crisis line if they are in immediate danger. Offer to take a short message for the church if appropriate. Then transition is not available — keep them safe with clear next steps.

Emergency contact on file (may be unavailable): {{emergency_contact}}`,
        fillVars,
      ),
      edges: [
        {
          destination_state_name: "wrap_up",
          description: "Immediate safety guidance given; close the call carefully.",
        },
        ...(transferEdge ? [transferEdge] : []),
      ],
    });
  }

  return states;
}

export const RETELL_STARTING_STATE = "greeting";
