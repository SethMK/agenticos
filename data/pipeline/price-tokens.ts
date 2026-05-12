#!/usr/bin/env bun
// S003: Multiply aggregated token rows by data/pricing.json to produce a usd field per row.
// Reads aggregate JSON array from stdin, writes the same array with usd added to stdout.
// Unknown models => usd: 0 + a deduped stderr warning (not a hard fail).

import { resolve } from "node:path";

type PriceEntry = {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_creation_per_mtok: number;
  cache_read_per_mtok: number;
};

type AggregateRow = {
  date: string;
  project_hash: string;
  project_raw?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  message_count: number;
};

type PricedRow = AggregateRow & { usd: number };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

async function readAllStdin(): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  // @ts-ignore — Bun.stdin.stream is async-iterable
  for await (const chunk of Bun.stdin.stream()) {
    out += decoder.decode(chunk, { stream: true });
  }
  out += decoder.decode();
  return out;
}

async function loadPricing(): Promise<Record<string, PriceEntry>> {
  // pricing.json lives at data/pricing.json relative to repo root; resolve from this script's dir.
  const path = resolve(import.meta.dir, "..", "pricing.json");
  const file = Bun.file(path);
  const json = await file.json();
  const out: Record<string, PriceEntry> = {};
  for (const [k, v] of Object.entries(json)) {
    if (k.startsWith("_")) continue; // skip _meta and any other metadata keys
    out[k] = v as PriceEntry;
  }
  return out;
}

function priceRows(rows: AggregateRow[], pricing: Record<string, PriceEntry>): PricedRow[] {
  const warned = new Set<string>();
  const out: PricedRow[] = [];
  for (const row of rows) {
    const p = pricing[row.model];
    let usd = 0;
    if (!p) {
      if (!warned.has(row.model)) {
        warned.add(row.model);
        process.stderr.write(`warn: unknown model "${row.model}"\n`);
      }
    } else {
      const raw =
        (num(row.input_tokens) * p.input_per_mtok +
          num(row.output_tokens) * p.output_per_mtok +
          num(row.cache_creation_input_tokens) * p.cache_creation_per_mtok +
          num(row.cache_read_input_tokens) * p.cache_read_per_mtok) /
        1_000_000;
      // Round to USD micros so JSON output is stable across runs.
      usd = Math.round(raw * 1_000_000) / 1_000_000;
    }
    out.push({ ...row, usd });
  }
  return out;
}

async function main() {
  const text = await readAllStdin();
  const trimmed = text.trim();
  const rows: AggregateRow[] = trimmed ? (JSON.parse(trimmed) as AggregateRow[]) : [];
  const pricing = await loadPricing();
  const priced = priceRows(rows, pricing);
  process.stdout.write(JSON.stringify(priced, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.message ?? e}\n`);
  process.exit(1);
});
