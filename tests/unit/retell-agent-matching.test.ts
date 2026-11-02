import assert from "node:assert/strict";
import test from "node:test";
import {
  agentIdsForChurch,
  agentIdsOnNumber,
  churchForSiblingAgent,
  churchSideNumber,
} from "../../lib/integrations/retell-calls";

const split = {
  phone_number: "+15025550100",
  inbound_agents: [{ agent_id: "agent_main" }, { agent_id: "agent_b" }],
  outbound_agents: null,
};
const other = { phone_number: "+16065550100", inbound_agents: [{ agent_id: "agent_other" }] };
const call = { call_id: "c1", call_type: "phone_call" as const, from_number: "+15025559999", to_number: "+15025550100" };

test("the church side of a call is the dialed number inbound and the caller ID outbound", () => {
  assert.equal(churchSideNumber({ ...call, direction: "inbound" }), "+15025550100");
  assert.equal(churchSideNumber(call), "+15025550100", "Retell omits direction on some inbound payloads");
  assert.equal(churchSideNumber({ ...call, direction: "outbound" }), "+15025559999");
  assert.equal(churchSideNumber({ ...call, to_number: "5025550100" }), null, "only E.164 is looked up");
  assert.equal(churchSideNumber({ ...call, to_number: "+1/../x" }), null);
});

test("every agent on a split number answers for the church that saved one of them", () => {
  assert.deepEqual(agentIdsOnNumber({ ...split, outbound_agents: [{ agent_id: "agent_main" }, { agent_id: "agent_out" }] }), ["agent_main", "agent_b", "agent_out"]);
  assert.deepEqual(agentIdsForChurch("agent_main", [split, other]), ["agent_main", "agent_b"]);
  assert.deepEqual(agentIdsForChurch("agent_lonely", [split, other]), ["agent_lonely"], "an agent on no number still imports its own calls");
});

test("a sibling agent's call goes to the one church whose saved agent shares the number", () => {
  const rows = [
    { church_id: "lgnaz", retail_ai_agent_id: "agent_main" },
    { church_id: "somerset", retail_ai_agent_id: "agent_other" },
  ];
  assert.equal(churchForSiblingAgent({ ...call, agent_id: "agent_b" }, split, rows), "lgnaz");
  assert.equal(churchForSiblingAgent({ ...call, agent_id: "agent_stranger" }, split, rows), null, "an agent not bound to the number is never matched");
  assert.equal(churchForSiblingAgent({ ...call, agent_id: "agent_b" }, other, rows), null);
  assert.equal(churchForSiblingAgent({ ...call }, split, rows), null);
  assert.equal(
    churchForSiblingAgent({ ...call, agent_id: "agent_b" }, split, [...rows, { church_id: "third", retail_ai_agent_id: "agent_b" }]),
    null,
    "two churches on one number is ambiguous, so neither gets the call",
  );
});
