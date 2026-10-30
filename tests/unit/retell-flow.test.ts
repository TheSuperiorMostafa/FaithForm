import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationFlowPayload, isConversationFlowId } from "@/lib/integrations/retell-flow";
import { buildRetellStates, RETELL_STARTING_STATE } from "@/lib/integrations/retell-prompt-states";

const vars = {
  greeting_message: "Hi, thanks for calling.", signoff_message: "God bless.", after_hours_message: "We're closed.",
  office_hours: "9-5", after_hours_mode: "OFF" as const, transfer_number: "+15025550100", emergency_contact: "911",
  has_office_transfer: true, has_emergency_transfer: false,
};
const toolsByName = new Map([
  ["end_call", { type: "end_call", name: "end_call" }],
  ["transfer_to_church_office", { type: "transfer_call", name: "transfer_to_church_office" }],
]);

function build(beginMessage: string | null = "Hi, thanks for calling.") {
  return buildConversationFlowPayload({
    generalPrompt: "You are the church secretary.", beginMessage, startingState: RETELL_STARTING_STATE,
    states: buildRetellStates(vars), toolsByName, dynamicVariables: { church_id: "c1" },
  });
}

test("every receptionist state becomes a subagent node with its tools and prompt edges, never a retell-llm state", () => {
  const flow = build();
  const states = buildRetellStates(vars);
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  assert.equal(flow.global_prompt, "You are the church secretary.");
  assert.equal(flow.start_speaker, "agent");
  assert.deepEqual(flow.model_config, { type: "cascading", primary: { model: "gpt-5.6-terra", tier: "standard" } });
  assert.ok(!("states" in flow) && !("general_tools" in flow));
  for (const state of states) {
    const node = nodes.get(state.name)!;
    assert.equal(node.type, "subagent");
    assert.equal(node.instruction.text, state.state_prompt);
    assert.deepEqual((node.edges ?? []).map((e) => e.destination_node_id), (state.edges ?? []).map((e) => e.destination_state_name));
    for (const edge of node.edges ?? []) assert.equal(edge.transition_condition.type, "prompt");
  }
  assert.deepEqual(nodes.get("wrap_up")!.tools?.map((t) => t.name), ["end_call"]);
  assert.deepEqual(nodes.get("transfer_office")!.tools?.map((t) => t.name), ["transfer_to_church_office"]);
  const ids = new Set(flow.nodes.map((n) => n.id));
  for (const node of flow.nodes) for (const edge of [...(node.edges ?? []), ...(node.else_edge ? [node.else_edge] : [])]) assert.ok(ids.has(edge.destination_node_id));
});

test("the begin message is spoken verbatim from a start node that hands off to the starting state", () => {
  const flow = build();
  const begin = flow.nodes.find((n) => n.id === flow.start_node_id)!;
  assert.deepEqual(begin.instruction, { type: "static_text", text: "Hi, thanks for calling." });
  assert.equal(begin.else_edge?.destination_node_id, RETELL_STARTING_STATE);
  assert.equal(build(null).start_node_id, RETELL_STARTING_STATE);
});

test("edges to states that are not defined are dropped and a missing starting state fails loudly", () => {
  const flow = buildConversationFlowPayload({
    generalPrompt: "g", startingState: "a", toolsByName: new Map(), dynamicVariables: {},
    states: [{ name: "a", state_prompt: "p", edges: [{ destination_state_name: "missing", description: "x" }, { destination_state_name: "a", description: "loop" }] }],
  });
  assert.deepEqual(flow.nodes[0].edges?.map((e) => e.destination_node_id), ["a"]);
  assert.throws(() => buildConversationFlowPayload({ generalPrompt: "g", startingState: "nope", states: [], toolsByName: new Map(), dynamicVariables: {} }));
});

test("only conversation flow ids are treated as flows so legacy llm ids get migrated", () => {
  assert.equal(isConversationFlowId("conversation_flow_79ed5f9966f2"), true);
  assert.equal(isConversationFlowId("llm_7b256025f245fe537f61fcaedb3b"), false);
  assert.equal(isConversationFlowId(null), false);
});
