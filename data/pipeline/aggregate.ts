#!/usr/bin/env bun
// S002: Aggregate parsed NDJSON by (date, project_hash, model). Reads stdin, writes JSON array to stdout.
// Normalisation: S001's parser uses basename(dirname(path)) which produces the literal "subagents"
// for nested sub-agent JSONLs (path .../<project-dir>/<session-uuid>/subagents/<...>.jsonl). We remap
// such records to a synthetic project "__subagents__" so they don't get attributed to whatever real
// project happens to hash first. The original (raw) value is preserved on each row as project_raw.
// S001 path-walk fix landed in S019 (parse-jsonl.ts now resolves real project ancestors).

import { createHash } from "node:crypto";

type ParsedRecord = {
  ts?: string;
  project?: string;
  session_id?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type AggregateRow = {
  date: string;
  project_hash: string;
  project_raw: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  message_count: number;
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function hashProject(project: string): string {
  return createHash("sha256").update(project).digest("hex").slice(0, 12);
}

function normaliseProject(raw: string): string {
  // S001 reports "subagents" when JSONL lives under <project>/<session>/subagents/. Disambiguate.
  if (raw === "subagents") return "__subagents__";
  return raw;
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

function aggregate(input: string): AggregateRow[] {
  const rows = new Map<string, AggregateRow>();
  const lines = input.split("\n");
  let lineNo = 0;
  for (const rawLine of lines) {
    lineNo++;
    const line = rawLine.trim();
    if (!line) continue;
    let obj: ParsedRecord;
    try {
      obj = JSON.parse(line) as ParsedRecord;
    } catch (e: any) {
      process.stderr.write(`warn: parse error stdin:${lineNo} ${e?.message ?? "unknown"}\n`);
      continue;
    }
    const ts = typeof obj.ts === "string" ? obj.ts : "";
    if (ts.length < 10) continue;
    const date = ts.slice(0, 10);
    const projectRaw = typeof obj.project === "string" ? obj.project : "";
    const project = normaliseProject(projectRaw);
    const project_hash = hashProject(project);
    const model = typeof obj.model === "string" ? obj.model : "";
    const key = `${date}|${project_hash}|${model}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        date,
        project_hash,
        project_raw: projectRaw,
        model,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        message_count: 0,
      };
      rows.set(key, row);
    }
    row.input_tokens += num(obj.input_tokens);
    row.output_tokens += num(obj.output_tokens);
    row.cache_creation_input_tokens += num(obj.cache_creation_input_tokens);
    row.cache_read_input_tokens += num(obj.cache_read_input_tokens);
    row.message_count += 1;
  }
  const arr = Array.from(rows.values());
  arr.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.project_hash !== b.project_hash) return a.project_hash < b.project_hash ? -1 : 1;
    if (a.model !== b.model) return a.model < b.model ? -1 : 1;
    return 0;
  });
  return arr;
}

async function main() {
  const input = await readAllStdin();
  const result = aggregate(input);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.message ?? e}\n`);
  process.exit(1);
});
