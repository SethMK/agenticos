#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

type OutRecord = {
  ts: string;
  project: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as any;
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(p);
    }
  }
  return out;
}

async function processFile(path: string, write: (line: string) => void): Promise<void> {
  // S019: walk up path segments looking for a `-Users-*-Projects-*` ancestor so nested
  // sub-agent JSONLs attribute their tokens to the parent project rather than bucketing
  // under a synthetic "subagents" basename. Fall back to basename(dirname(path)) if none.
  const segments = path.split("/");
  const projectsRe = /^-Users-.*-Projects-.*$/;
  let project = basename(dirname(path));
  for (let i = segments.length - 2; i >= 0; i--) {
    if (projectsRe.test(segments[i])) {
      project = segments[i];
      break;
    }
  }
  const session_id = basename(path, ".jsonl");
  const stream = Bun.file(path).stream();
  const decoder = new TextDecoder();
  let buf = "";
  let lineNo = 0;
  const handleLine = (line: string) => {
    lineNo++;
    if (!line) return;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch (e: any) {
      process.stderr.write(`warn: parse error ${path}:${lineNo} ${e?.message ?? "unknown"}\n`);
      return;
    }
    if (obj?.type !== "assistant") return;
    const msg = obj.message;
    if (!msg || typeof msg !== "object") return;
    if (msg.role !== "assistant") return;
    const usage = msg.usage;
    if (!usage || typeof usage !== "object") return;
    // S021: skip Claude Code's client-fabricated "synthetic" assistant turns.
    // These are CLI-emitted records for rate-limit / API-error / status messages
    // (e.g. "You've hit your limit", "API Error: 500", "No response requested").
    // They carry model: "<synthetic>" and strictly zero usage across all four
    // token fields, so they never produced billable model output. Counting them
    // pollutes the model list with a fake 5th "model" and emits a stderr warning
    // on every pricing run for $0 of cost. See notes/synthetic-model-investigation.md.
    if (msg.model === "<synthetic>") return;
    const rec: OutRecord = {
      ts: typeof obj.timestamp === "string" ? obj.timestamp : "",
      project,
      session_id,
      model: typeof msg.model === "string" ? msg.model : "",
      input_tokens: num(usage.input_tokens),
      output_tokens: num(usage.output_tokens),
      cache_creation_input_tokens: num(usage.cache_creation_input_tokens),
      cache_read_input_tokens: num(usage.cache_read_input_tokens),
    };
    write(JSON.stringify(rec) + "\n");
  };
  // @ts-ignore — async iteration over Bun stream
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) handleLine(buf);
}

async function main() {
  const argPath = process.argv[2];
  const files: string[] = argPath
    ? [argPath]
    : await listJsonlFiles(join(homedir(), ".claude", "projects"));
  const write = (s: string) => process.stdout.write(s);
  for (const f of files) {
    await processFile(f, write);
  }
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.message ?? e}\n`);
  process.exit(1);
});
