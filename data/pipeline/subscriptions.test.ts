// S041: Unit tests for the subscriptions loader.
// Run: bun test data/pipeline/subscriptions.test.ts

import { describe, test, expect } from "bun:test";
import { computeFromParsed, type SubscriptionYaml } from "./subscriptions";

describe("subscriptions loader", () => {
  // Test A — Basic computation (acceptance bullet 3)
  // 17 whole months × €22.14 = €376.38 for start: "2025-01", end: null, asOf: "2026-05-11"
  test("A: basic month computation (17 months × 22.14 = 376.38)", () => {
    const fixture: SubscriptionYaml = {
      currency: "EUR",
      subscriptions: [{ plan: "pro", monthly: 22.14, start: "2025-01", end: null }],
    };
    const result = computeFromParsed(fixture, { asOf: "2026-05-11" });
    expect(result.total).toBe(376.38);
    expect(result.currency).toBe("EUR");
  });

  // Test B — Proration (acceptance bullet 4)
  // One row: 1 month at €22.14 + proration €73.57 = €95.71
  test("B: proration amount added exactly once", () => {
    const fixture: SubscriptionYaml = {
      currency: "EUR",
      subscriptions: [
        {
          plan: "max",
          monthly: 22.14,
          start: "2026-05",
          end: null,
          proration: [{ date: "2026-05-01", amount: 73.57 }],
        },
      ],
    };
    const result = computeFromParsed(fixture, { asOf: "2026-05-11" });
    // 1 month (May) × 22.14 = 22.14, + proration 73.57 = 95.71
    expect(result.total).toBe(95.71);
  });

  // Test C — Validation rejects start > end (acceptance bullet 5)
  test("C: rejects row where start > end", () => {
    const fixture: SubscriptionYaml = {
      currency: "EUR",
      subscriptions: [{ plan: "pro", monthly: 22.14, start: "2026-05", end: "2025-01" }],
    };
    expect(() => computeFromParsed(fixture)).toThrow(/start.*after.*end|after/i);
  });

  // Test D — Validation rejects unknown plan (acceptance bullet 5)
  test("D: rejects unknown plan", () => {
    const fixture = {
      currency: "EUR",
      subscriptions: [{ plan: "enterprise", monthly: 99.00, start: "2025-01", end: null }],
    } as unknown as SubscriptionYaml;
    expect(() => computeFromParsed(fixture)).toThrow(/unknown plan/i);
  });

  // Test E — Validation rejects per-row currency mismatch (acceptance bullet 5)
  test("E: rejects per-row currency that mismatches top-level", () => {
    const fixture = {
      currency: "EUR",
      subscriptions: [{ plan: "pro", monthly: 22.14, start: "2025-01", end: null, currency: "USD" }],
    } as unknown as SubscriptionYaml;
    expect(() => computeFromParsed(fixture)).toThrow(/mismatches/i);
  });

  // Test F — paying_since reflects the FIRST plan's start (lifetime tenure),
  // not the current plan's start. Anchors the lifetime-total card subtitle.
  test("F: paying_since = first plan's start, current_plan_since = current plan's start", () => {
    const fixture: SubscriptionYaml = {
      currency: "EUR",
      subscriptions: [
        { plan: "pro", monthly: 22.14, start: "2025-01", end: "2026-03" },
        { plan: "max", monthly: 90.0, start: "2026-03", end: null },
      ],
    };
    const result = computeFromParsed(fixture, { asOf: "2026-05-11" });
    expect(result.paying_since).toBe("2025-01");
    expect(result.current_plan).toBe("max");
    expect(result.current_plan_since).toBe("2026-03");
  });
});
