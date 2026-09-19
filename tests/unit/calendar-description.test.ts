import assert from "node:assert/strict";
import test from "node:test";
import { calendarDescriptionText } from "@/lib/integrations/calendar-description";

test("plain text descriptions pass through with their line breaks", () => {
  assert.equal(
    calendarDescriptionText("Bring a dish to share.\r\nKids welcome!"),
    "Bring a dish to share.\nKids welcome!",
  );
});

test("an empty or missing description is empty", () => {
  assert.equal(calendarDescriptionText(undefined), "");
  assert.equal(calendarDescriptionText(null), "");
  assert.equal(calendarDescriptionText("   \n  "), "");
});

test("Google's HTML becomes readable text", () => {
  assert.equal(
    calendarDescriptionText(
      "<b>Potluck</b> after service<br>Bring a dish &amp; a friend<br><br><br>See you there",
    ),
    "Potluck after service\nBring a dish & a friend\n\nSee you there",
  );
});

test("list items become bulleted lines", () => {
  assert.equal(
    calendarDescriptionText("What to bring:<ul><li>Bible</li><li>Notebook</li></ul>"),
    "What to bring:\n• Bible\n• Notebook",
  );
});

test("a link keeps its address", () => {
  assert.equal(
    calendarDescriptionText('Sign up <a href="https://example.org/signup">here</a>'),
    "Sign up here (https://example.org/signup)",
  );
  assert.equal(
    calendarDescriptionText(
      '<a href="https://example.org/signup">https://example.org/signup</a>',
    ),
    "https://example.org/signup",
  );
});

test("angle brackets in plain text are left alone", () => {
  assert.equal(calendarDescriptionText("Ages 5 < 12 welcome"), "Ages 5 < 12 welcome");
});
