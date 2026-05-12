#!/usr/bin/env bun
// S041: Subscription history loader — computes total paid (EUR) over the Claude plan history.
// Reads data/subscriptions.yaml, validates rows, and returns { total, currency, current_plan, current_plan_since, paying_since }.
// Run: bun run data/pipeline/subscriptions.ts [path-to-yaml]

import { resolve } from "node:path";

// ---------- types ----------

export type ProrationEntry = {
  date: string;   // YYYY-MM-DD
  amount: number; // amount charged for this proration event
};

export type SubscriptionRow = {
  plan: "pro" | "max" | "team";
  monthly: number;
  start: string;          // YYYY-MM
  end: string | null;     // YYYY-MM or null (still active)
  status?: "paid" | "partially_refunded";
  refund?: number;        // known refund amount; subtract from total if set
  proration?: ProrationEntry[];
  currency?: string;      // per-row currency override — must match top-level if set
  notes?: string;
};

export type SubscriptionYaml = {
  currency: string;
  subscriptions: SubscriptionRow[];
};

export type LoaderResult = {
  total: number;
  currency: string;
  current_plan: string;
  current_plan_since: string;
  paying_since: string;
  rows: SubscriptionRow[];
};

// ---------- validation ----------

const VALID_PLANS = new Set(["pro", "max", "team"]);

function validateRow(row: SubscriptionRow, topCurrency: string, index: number): void {
  if (!VALID_PLANS.has(row.plan)) {
    throw new Error(`subscriptions[${index}]: unknown plan "${row.plan}" (allowed: pro, max, team)`);
  }
  if (row.end !== null && row.end !== undefined && row.start > row.end) {
    throw new Error(`subscriptions[${index}]: start "${row.start}" is after end "${row.end}"`);
  }
  if (row.currency !== undefined && row.currency !== topCurrency) {
    throw new Error(
      `subscriptions[${index}]: per-row currency "${row.currency}" mismatches top-level "${topCurrency}"`
    );
  }
}

// ---------- computation ----------

// Count whole months from startYM to endYM, inclusive on both ends.
// e.g. "2025-01" to "2026-05" => Jan 2025 ... May 2026 = 17 months.
function wholeMonths(startYM: string, endYM: string): number {
  const [sy, sm] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

// Extract YYYY-MM from a YYYY-MM-DD or YYYY-MM string.
function toYM(s: string): string {
  return s.slice(0, 7);
}

export function computeFromParsed(
  data: SubscriptionYaml,
  opts?: { asOf?: string }
): LoaderResult {
  const currency = data.currency;
  const rows = data.subscriptions;

  // asOf: default to today; we only need YYYY-MM precision for month counting.
  const asOfFull = opts?.asOf ?? new Date().toISOString().slice(0, 10);
  const asOfYM = toYM(asOfFull);

  // Validate all rows first.
  rows.forEach((row, i) => validateRow(row, currency, i));

  let total = 0;

  for (const row of rows) {
    const endYM = row.end !== null && row.end !== undefined ? row.end : asOfYM;
    // Clamp to asOf so future end dates don't inflate total.
    const effectiveEnd = endYM < asOfYM ? endYM : asOfYM;

    const months = wholeMonths(row.start, effectiveEnd);
    if (months > 0) {
      total += row.monthly * months;
    }

    // Add proration entries (charged separately, not monthly-based).
    if (row.proration) {
      for (const p of row.proration) {
        // Only count proration events on or before asOf.
        if (toYM(p.date) <= asOfYM) {
          total += p.amount;
        }
      }
    }

    // Subtract known refunds.
    if (typeof row.refund === "number") {
      total -= row.refund;
    }
  }

  // Round to 2 decimal places to avoid floating-point drift.
  total = Math.round(total * 100) / 100;

  // Find current plan: the row that contains asOf (end: null or end >= asOf).
  const currentRow = [...rows].reverse().find((row) => {
    const endYM = row.end ?? asOfYM;
    return row.start <= asOfYM && asOfYM <= endYM;
  }) ?? rows[rows.length - 1];

  // paying_since: start of the FIRST subscription row — anchors the lifetime
  // total to total tenure, not just the current plan's start.
  const payingSince = rows[0]?.start ?? currentRow.start;

  return {
    total,
    currency,
    current_plan: currentRow.plan,
    current_plan_since: currentRow.start,
    paying_since: payingSince,
    rows,
  };
}

export async function loadSubscriptions(
  yamlPath: string,
  opts?: { asOf?: string }
): Promise<LoaderResult> {
  const file = Bun.file(resolve(yamlPath));
  const text = await file.text();
  const data = Bun.YAML.parse(text) as SubscriptionYaml;
  return computeFromParsed(data, opts);
}

// ---------- CLI entry ----------

async function main() {
  const args = process.argv.slice(2);
  const yamlPath = args[0] ?? resolve(import.meta.dir, "..", "subscriptions.yaml");
  const result = await loadSubscriptions(yamlPath);
  const { total, currency, current_plan, current_plan_since, paying_since } = result;
  process.stdout.write(JSON.stringify({ total, currency, current_plan, current_plan_since, paying_since }, null, 2) + "\n");
}

if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`fatal: ${e?.message ?? e}\n`);
    process.exit(1);
  });
}
