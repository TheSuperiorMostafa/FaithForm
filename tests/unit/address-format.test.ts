import assert from "node:assert/strict";
import test from "node:test";
import { formatAddressLine } from "../../lib/utils/address";

test("formats a complete address and trims each part", () => {
  assert.equal(formatAddressLine({ address: " 123 Main St ", city: " Louisville ", state: " KY ", zip: " 40202 " }), "123 Main St, Louisville, KY 40202");
});

test("omits missing address parts without extra punctuation", () => {
  assert.equal(formatAddressLine({ city: "Louisville", zip: "40202" }), "Louisville, 40202");
  assert.equal(formatAddressLine({ address: "123 Main St", state: "KY" }), "123 Main St, KY");
  assert.equal(formatAddressLine({ address: null, city: " ", state: null, zip: null }), "");
  assert.equal(formatAddressLine({}), "");
});
