/**
 * Retell conversation-flow payload builder.
 *
 * Retell is retiring multi-prompt (retell-llm `states`) agents on
 * 2026-12-15. FaithForm still describes the receptionist as named states with
 * prompt edges (see retell-prompt-states.ts); this module maps that shape onto
 * a conversation flow:
 * - general prompt   -> flow `global_prompt`
 * - begin message    -> a static-text start node that hands off to the
 *                       starting state (or straight to a matching edge)
 * - each state       -> a `subagent` node that owns its tools
 * - each state edge  -> a prompt-condition node edge
 */

import type { RetellStateDefinition } from "@/lib/integrations/retell-prompt-states";

export type RetellTool = Record<string, unknown> & { name: string };

// Retell reserves the id "begin" (create accepts it, update rejects it).
export const RETELL_FLOW_BEGIN_NODE_ID = "begin_message";

/** Stored ids that point at a conversation flow (vs. a legacy retell-llm). */
export function isConversationFlowId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.startsWith("conversation_flow_");
}

type FlowEdge = {
  id: string;
  destination_node_id: string;
  transition_condition: { type: "prompt"; prompt: string };
};

type FlowNode = {
  id: string;
  name: string;
  type: "conversation" | "subagent";
  instruction: { type: "prompt" | "static_text"; text: string };
  edges?: FlowEdge[];
  else_edge?: FlowEdge;
  tools?: RetellTool[];
};

/**
 * Conversation flows require an explicit model. Default matches what Retell
 * assigned FaithForm's managed multi-prompt agents; override with RETELL_MODEL.
 */
export const DEFAULT_RETELL_FLOW_MODEL = "gpt-5.6-terra";

export type RetellFlowModelConfig = {
  type: "cascading";
  primary: { model: string; tier: "standard" };
};

export type RetellConversationFlowPayload = {
  model_config: RetellFlowModelConfig;
  global_prompt: string;
  start_speaker: "agent";
  start_node_id: string;
  nodes: FlowNode[];
  default_dynamic_variables: Record<string, string>;
};

export function buildConversationFlowPayload(input: {
  generalPrompt: string;
  beginMessage?: string | null;
  startingState: string;
  states: RetellStateDefinition[];
  toolsByName: Map<string, RetellTool>;
  dynamicVariables: Record<string, string>;
  model?: string | null;
}): RetellConversationFlowPayload {
  const stateNames = new Set(input.states.map((state) => state.name));
  if (!stateNames.has(input.startingState)) {
    throw new Error(`Retell starting state "${input.startingState}" is not defined.`);
  }

  const edgesFor = (state: RetellStateDefinition, prefix: string): FlowEdge[] =>
    (state.edges ?? [])
      .filter((edge) => stateNames.has(edge.destination_state_name))
      .map((edge, index) => ({
        id: `${prefix}_${index}`,
        destination_node_id: edge.destination_state_name,
        transition_condition: { type: "prompt", prompt: edge.description },
      }));

  const nodes: FlowNode[] = input.states.map((state) => {
    const tools = (state.toolNames ?? [])
      .map((name) => input.toolsByName.get(name))
      .filter((tool): tool is RetellTool => Boolean(tool));
    const edges = edgesFor(state, `edge_${state.name}`);
    return {
      id: state.name,
      name: state.name,
      type: "subagent",
      instruction: { type: "prompt", text: state.state_prompt },
      ...(edges.length > 0 ? { edges } : {}),
      ...(tools.length > 0 ? { tools } : {}),
    };
  });

  let startNodeId = input.startingState;
  const beginMessage = input.beginMessage?.trim();
  if (beginMessage) {
    const starting = input.states.find((state) => state.name === input.startingState)!;
    nodes.unshift({
      id: RETELL_FLOW_BEGIN_NODE_ID,
      name: "Begin message",
      type: "conversation",
      instruction: { type: "static_text", text: beginMessage },
      edges: edgesFor(starting, "edge_begin"),
      else_edge: {
        id: "edge_begin_else",
        destination_node_id: input.startingState,
        transition_condition: { type: "prompt", prompt: "Else" },
      },
    });
    startNodeId = RETELL_FLOW_BEGIN_NODE_ID;
  }

  return {
    model_config: {
      type: "cascading",
      primary: { model: input.model?.trim() || DEFAULT_RETELL_FLOW_MODEL, tier: "standard" },
    },
    global_prompt: input.generalPrompt,
    start_speaker: "agent",
    start_node_id: startNodeId,
    nodes,
    default_dynamic_variables: input.dynamicVariables,
  };
}
