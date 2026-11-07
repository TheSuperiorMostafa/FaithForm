/**
 * Test E4: Recurring event occurrence generation.
 * Validates timezone handling, bounded generation, idempotency.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { generateOccurrenceDates } from "@/lib/announcements/recurring-events";

describe("Recurring event generation (E4)", () => {
  it("generates daily occurrences correctly", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "daily" as const,
      startDate: "2026-01-01",
      startTime: "10:00",
      endTime: "11:00",
      untilDate: "2026-01-07",
      timezone: "America/New_York",
      allDay: false,
    };
    
    const occurrences = generateOccurrenceDates(config);
    
    assert.equal(occurrences.length, 7, "Should generate 7 daily occurrences");
    assert.equal(occurrences[0].date, "2026-01-01");
    assert.equal(occurrences[6].date, "2026-01-07");
  });
  
  it("generates weekly occurrences correctly", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "weekly" as const,
      startDate: "2026-01-01",
      startTime: "19:00",
      endTime: "20:30",
      untilDate: "2026-02-28",
      timezone: "America/Los_Angeles",
      allDay: false,
    };
    
    const occurrences = generateOccurrenceDates(config);
    
    assert.equal(occurrences.length, 9, "Should generate 9 weekly occurrences");
    assert.equal(occurrences[0].date, "2026-01-01");
    assert.equal(occurrences[1].date, "2026-01-08");
    assert.equal(occurrences[8].date, "2026-02-26");
  });
  
  it("generates monthly occurrences correctly", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "monthly" as const,
      startDate: "2026-01-15",
      startTime: "18:00",
      endTime: "19:00",
      untilDate: "2026-06-30",
      timezone: "America/Chicago",
      allDay: false,
    };
    
    const occurrences = generateOccurrenceDates(config);
    
    assert.equal(occurrences.length, 6, "Should generate 6 monthly occurrences");
    assert.equal(occurrences[0].date, "2026-01-15");
    assert.equal(occurrences[1].date, "2026-02-15");
    assert.equal(occurrences[5].date, "2026-06-15");
  });
  
  it("handles month-end edge cases", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "monthly" as const,
      startDate: "2026-01-31",
      startTime: "10:00",
      endTime: "11:00",
      untilDate: "2026-04-30",
      timezone: "America/New_York",
      allDay: false,
    };
    
    const occurrences = generateOccurrenceDates(config);
    
    assert.equal(occurrences.length, 4, "Should generate 4 monthly occurrences");
    assert.equal(occurrences[0].date, "2026-01-31");
    assert.equal(occurrences[1].date, "2026-02-28", "Feb should use last day (28)");
    assert.equal(occurrences[2].date, "2026-03-31");
    assert.equal(occurrences[3].date, "2026-04-30", "Apr should use last day (30)");
  });
  
  it("generates all-day occurrences with UTC midnight", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "weekly" as const,
      startDate: "2026-01-01",
      startTime: null,
      endTime: null,
      untilDate: "2026-01-15",
      timezone: "America/New_York",
      allDay: true,
    };
    
    const occurrences = generateOccurrenceDates(config);
    
    assert.equal(occurrences.length, 3, "Should generate 3 weekly occurrences");
    assert.equal(occurrences[0].startAt, "2026-01-01T00:00:00.000Z");
    assert.equal(occurrences[0].endAt, null);
    assert.equal(occurrences[1].startAt, "2026-01-08T00:00:00.000Z");
  });
  
  it("enforces maximum occurrences limit", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "daily" as const,
      startDate: "2026-01-01",
      startTime: "10:00",
      endTime: "11:00",
      untilDate: "2028-12-31", // 3 years
      timezone: "America/New_York",
      allDay: false,
    };
    
    const occurrences = generateOccurrenceDates(config);
    
    assert.ok(occurrences.length <= 365, "Should cap at 365 occurrences");
    assert.equal(occurrences.length, 365, "Should generate exactly 365");
  });
  
  it("enforces 5-year maximum limit", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "weekly" as const,
      startDate: "2026-01-01",
      startTime: "10:00",
      endTime: "11:00",
      untilDate: "2035-12-31", // 10 years (should cap at 5)
      timezone: "America/New_York",
      allDay: false,
    };
    
    const occurrences = generateOccurrenceDates(config);
    
    // 5 years of weekly = ~260 occurrences, but we also cap at 365
    assert.ok(occurrences.length <= 365, "Should respect hard limit");
    
    const lastDate = new Date(occurrences[occurrences.length - 1].date);
    const startDate = new Date(config.startDate);
    const yearsDiff = (lastDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    assert.ok(yearsDiff <= 5.1, "Should not exceed 5 years");
  });
  
  it("rejects invalid date ranges", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "daily" as const,
      startDate: "2026-12-31",
      startTime: "10:00",
      endTime: "11:00",
      untilDate: "2026-01-01", // Before start
      timezone: "America/New_York",
      allDay: false,
    };
    
    assert.throws(
      () => generateOccurrenceDates(config),
      /end date must be after start date/i
    );
  });
  
  it("requires start time for non-all-day events", () => {
    const config = {
      churchId: "church-1",
      announcementId: "event-1",
      frequency: "daily" as const,
      startDate: "2026-01-01",
      startTime: null,
      endTime: null,
      untilDate: "2026-01-07",
      timezone: "America/New_York",
      allDay: false,
    };
    
    assert.throws(
      () => generateOccurrenceDates(config),
      /start time required/i
    );
  });
  
  it("handles different timezones correctly", () => {
    const configs = [
      {
        churchId: "church-1",
        announcementId: "event-1",
        frequency: "weekly" as const,
        startDate: "2026-01-01",
        startTime: "10:00",
        endTime: "11:00",
        untilDate: "2026-01-15",
        timezone: "America/New_York",
        allDay: false,
      },
      {
        ...({}  as Partial<typeof validConfig>),
        timezone: "America/Los_Angeles",
      },
      {
        ...({}  as Partial<typeof validConfig>),
        timezone: "America/Chicago",
      },
    ];
    
    // Copy config for different timezones
    const nyConfig = configs[0];
    const laConfig = { ...nyConfig, timezone: "America/Los_Angeles" };
    const chiConfig = { ...nyConfig, timezone: "America/Chicago" };
    
    const nyOccurrences = generateOccurrenceDates(nyConfig);
    const laOccurrences = generateOccurrenceDates(laConfig);
    const chiOccurrences = generateOccurrenceDates(chiConfig);
    
    // All should generate same number of dates
    assert.equal(nyOccurrences.length, 3);
    assert.equal(laOccurrences.length, 3);
    assert.equal(chiOccurrences.length, 3);
    
    // But UTC timestamps should differ
    assert.notEqual(nyOccurrences[0].startAt, laOccurrences[0].startAt);
    assert.notEqual(nyOccurrences[0].startAt, chiOccurrences[0].startAt);
  });
});
