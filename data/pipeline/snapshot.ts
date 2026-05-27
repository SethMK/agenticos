#!/usr/bin/env bun
// S005: End-to-end pipeline runner + atomic snapshot writer.
//
// Chain: walk ~/.claude/projects/*/*.jsonl → parse assistant.usage → aggregate
// (date, project_hash, model) → price via data/pricing.json → redact (stable
// project-hash → "Project X" map) → merge PMO board → write two snapshots:
//   - data/snapshots/public.json (redacted names, no project_raw)
//   - data/snapshots/ops.json    (real project_raw names)
//
// The four upstream stages (parse-jsonl, aggregate, price-tokens, redact) are
// done + tested. parse/aggregate/price are CLI scripts with no exports; their
// pure logic is re-implemented inline here per the S005 brief's "do not edit
// the source files" constraint. redact.ts exports its `redact()` function and
// is imported directly so the persisted redaction-map.json stays single-source.
//
// Atomic write: every output goes through write-to-`.tmp.json` + rename, so a
// kill -9 mid-run can never leave a half-written snapshot visible to readers.

import { readdir, rename, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { redact } from "./redact";
import { loadSubscriptions } from "./subscriptions";
import { PLAN_QUOTAS } from "./quotas";

// ---------- types ----------

type ParsedRow = {
  ts: string;
  project: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
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

type PriceEntry = {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_creation_per_mtok: number;
  cache_read_per_mtok: number;
};

type PricedRow = AggregateRow & { usd: number };

// ---------- helpers ----------

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function hashProject(project: string): string {
  return createHash("sha256").update(project).digest("hex").slice(0, 12);
}

function normaliseProject(raw: string): string {
  if (raw === "subagents") return "__subagents__";
  return raw;
}

// S024: worktree-shadow dedup.
//
// Claude Code creates a per-branch session directory when you run inside a git
// worktree under `<repo>/.claude-worktrees/<branch-slug>/`. ~/.claude/projects/
// encodes that as a sibling directory with the literal `--claude-worktrees-`
// substring (leading `.` becomes `-`, so `.claude-worktrees` → `-claude-worktrees`,
// and the join between repo path and worktrees dir produces a `--` double-dash).
//
// Examples observed on Marcin's machine:
//   -Users-marcinkokott-Projects-personal-202603-Future--claude-worktrees-frosty-williamson-a307ff
//   -Users-marcinkokott-Projects-personal-202604-Personal--claude-worktrees-awesome-mcnulty-e64b3f
//
// Canonical (parent repo):
//   -Users-marcinkokott-Projects-personal-202603-Future
//   -Users-marcinkokott-Projects-personal-202604-Personal
//
// Rule: substring before the `--claude-worktrees-` marker is the canonical
// project. We fold the worktree's tokens into the canonical project_hash so
// the dashboard's "33 projects" reflects unique repos (31), not branch
// multiplicity. Token sums are preserved byte-identically — this is a re-key,
// never a drop.
//
// Orphan handling: if the canonical project has no JSONL files of its own
// (i.e. no parsed row carries the canonical raw path), the worktree is
// promoted to canonical — we keep its own raw path so the tokens are not lost.

const WORKTREE_MARKER = "--claude-worktrees-";

export function _isWorktreeShadow(project_raw: string): boolean {
  return typeof project_raw === "string" && project_raw.includes(WORKTREE_MARKER);
}

export function canonicalOfWorktree(project_raw: string): string {
  const idx = project_raw.indexOf(WORKTREE_MARKER);
  if (idx < 0) return project_raw;
  return project_raw.slice(0, idx);
}

// Inline sanity-check (runs at module load; cheap, ~µs). Catches regressions
// in the canonical-pattern rule without needing a separate test file.
(function _verifyWorktreeHelper() {
  const wt = "-Users-marcinkokott-Projects-personal-202603-Future--claude-worktrees-frosty-williamson-a307ff";
  const canon = "-Users-marcinkokott-Projects-personal-202603-Future";
  if (!_isWorktreeShadow(wt)) throw new Error("S024: _isWorktreeShadow failed on worktree path");
  if (_isWorktreeShadow(canon)) throw new Error("S024: _isWorktreeShadow false-positive on canonical path");
  if (canonicalOfWorktree(wt) !== canon) {
    throw new Error(`S024: canonicalOfWorktree mismatch: got ${canonicalOfWorktree(wt)}`);
  }
  if (canonicalOfWorktree(canon) !== canon) {
    throw new Error("S024: canonicalOfWorktree changed a canonical path");
  }
})();

type WorktreeAuditEntry = {
  worktree_path: string;
  canonical_path: string;
  tokens_folded: number;
  promoted_to_canonical: boolean;
};

// Build a remap table: worktree raw path → canonical raw path (only when the
// canonical raw path also appears in the parsed rows; otherwise the worktree
// is promoted to canonical and maps to itself). Returns the remap plus an
// audit list describing each decision.
function buildWorktreeRemap(parsed: ParsedRow[]): {
  remap: Map<string, string>;
  audit: WorktreeAuditEntry[];
} {
  const allRaws = new Set<string>();
  const tokensByRaw = new Map<string, number>();
  for (const r of parsed) {
    allRaws.add(r.project);
    const t =
      r.input_tokens +
      r.output_tokens +
      r.cache_creation_input_tokens +
      r.cache_read_input_tokens;
    tokensByRaw.set(r.project, (tokensByRaw.get(r.project) ?? 0) + t);
  }
  const remap = new Map<string, string>();
  const audit: WorktreeAuditEntry[] = [];
  for (const raw of allRaws) {
    if (!_isWorktreeShadow(raw)) continue;
    const canonical = canonicalOfWorktree(raw);
    if (allRaws.has(canonical)) {
      remap.set(raw, canonical);
      audit.push({
        worktree_path: raw,
        canonical_path: canonical,
        tokens_folded: tokensByRaw.get(raw) ?? 0,
        promoted_to_canonical: false,
      });
    } else {
      // Orphan: no canonical JSONL exists, keep worktree as its own canonical.
      audit.push({
        worktree_path: raw,
        canonical_path: raw,
        tokens_folded: tokensByRaw.get(raw) ?? 0,
        promoted_to_canonical: true,
      });
    }
  }
  return { remap, audit };
}

// ---------- stage 1: walk + parse JSONL (mirrors parse-jsonl.ts logic) ----------

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

async function parseFile(path: string, sink: (row: ParsedRow) => void): Promise<void> {
  // S019: walk up path segments looking for a `-Users-*-Projects-*` ancestor so nested
  // sub-agent JSONLs attribute their tokens to the parent project.
  const segments = path.split("/");
  const projectsRe = /^-Users-.*-Projects-.*$/;
  let project = basename(dirname(path));
  for (let i = segments.length - 2; i >= 0; i--) {
    if (projectsRe.test(segments[i])) {
      project = segments[i];
      break;
    }
  }
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
    // S021: filter CLI-fabricated assistant turns (rate-limit, 4xx/5xx, auth, plan-mode replays) — all zero-usage sentinels.
    if (msg.model === "<synthetic>") return;
    const usage = msg.usage;
    if (!usage || typeof usage !== "object") return;
    sink({
      ts: typeof obj.timestamp === "string" ? obj.timestamp : "",
      project,
      model: typeof msg.model === "string" ? msg.model : "",
      input_tokens: num(usage.input_tokens),
      output_tokens: num(usage.output_tokens),
      cache_creation_input_tokens: num(usage.cache_creation_input_tokens),
      cache_read_input_tokens: num(usage.cache_read_input_tokens),
    });
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

// ---------- stage 2: aggregate (mirrors aggregate.ts logic) ----------

function aggregateRows(parsed: ParsedRow[]): AggregateRow[] {
  const rows = new Map<string, AggregateRow>();
  for (const r of parsed) {
    const ts = r.ts;
    if (!ts || ts.length < 10) continue;
    const date = ts.slice(0, 10);
    const projectRaw = r.project;
    const project = normaliseProject(projectRaw);
    const project_hash = hashProject(project);
    const model = r.model;
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
    row.input_tokens += num(r.input_tokens);
    row.output_tokens += num(r.output_tokens);
    row.cache_creation_input_tokens += num(r.cache_creation_input_tokens);
    row.cache_read_input_tokens += num(r.cache_read_input_tokens);
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

// ---------- stage 3: price (mirrors price-tokens.ts logic) ----------

async function loadPricing(pricingPath: string): Promise<Record<string, PriceEntry>> {
  const file = Bun.file(pricingPath);
  const json = await file.json();
  const out: Record<string, PriceEntry> = {};
  for (const [k, v] of Object.entries(json)) {
    if (k.startsWith("_")) continue;
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
      usd = Math.round(raw * 1_000_000) / 1_000_000;
    }
    out.push({ ...row, usd });
  }
  return out;
}

// ---------- stage 4: side-collectors ----------

async function countDirEntries(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.length;
  } catch {
    return 0;
  }
}

async function countSubdirEntries(dir: string): Promise<number> {
  // Count top-level entries (skills/agents are usually folders or .md files).
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e: any) => e.name && !e.name.startsWith(".")).length;
  } catch {
    return 0;
  }
}

// S050: list top-level entry names (skills/agents) — mirrors countSubdirEntries but returns names.
async function listSubdirEntryNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e: any) => e.name && !e.name.startsWith("."))
      .map((e: any) => e.name as string);
  } catch {
    return [];
  }
}

// S050: list per-project .claude/skills and .claude/agents names across all projects.
async function listProjectClaudeArtifactNames(projectsRoot: string): Promise<{
  skills: string[];
  agents: string[];
}> {
  const skills: string[] = [];
  const agents: string[] = [];
  const projectDirs = await listChildDirs(projectsRoot);
  for (const pd of projectDirs) {
    const cdir = join(pd, ".claude");
    skills.push(...(await listSubdirEntryNames(join(cdir, "skills"))));
    agents.push(...(await listSubdirEntryNames(join(cdir, "agents"))));
  }
  return { skills, agents };
}

async function listChildDirs(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries
      .filter((e: any) => e.isDirectory())
      .map((e: any) => join(parent, e.name));
  } catch {
    return [];
  }
}

async function countMarkdownRecursive(dir: string): Promise<number> {
  let count = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let entries: any[] = [];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && ent.name.endsWith(".md")) count++;
    }
  }
  return count;
}

async function countProjectClaudeArtifacts(projectsRoot: string): Promise<{
  skills: number;
  agents: number;
  commands: number;
}> {
  let skills = 0;
  let agents = 0;
  let commands = 0;
  const projectDirs = await listChildDirs(projectsRoot);
  for (const pd of projectDirs) {
    const cdir = join(pd, ".claude");
    skills += await countSubdirEntries(join(cdir, "skills"));
    agents += await countSubdirEntries(join(cdir, "agents"));
    commands += await countSubdirEntries(join(cdir, "commands"));
  }
  return { skills, agents, commands };
}

async function countMcpServers(settingsPath: string): Promise<number> {
  try {
    const f = Bun.file(settingsPath);
    if (!(await f.exists())) return 0;
    const json: any = await f.json();
    const block = json?.mcpServers;
    if (!block || typeof block !== "object") return 0;
    return Object.keys(block).length;
  } catch {
    return 0;
  }
}

// S020: gather MCP server names from three real sources used by Claude Code:
//   (a) per-project `.mcp.json` files under ~/Projects/{personal,work}/**/
//   (b) `enabledMcpjsonServers` array in ~/.claude/settings.json
//   (c) plugin-registered MCPs: `.mcp.json` inside installed plugin paths
// Marcin's MCPs don't live in `~/.claude/settings.json#mcpServers` (which is what
// countMcpServers() above checks — that returns 0). The dedup is case-insensitive.
async function findMcpJsonFiles(root: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  if (depth < 0) return out;
  let entries: any[] = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const p = join(root, ent.name);
    if (ent.isFile && ent.isFile() && ent.name === ".mcp.json") {
      out.push(p);
    } else if (ent.isDirectory && ent.isDirectory() && !ent.name.startsWith(".")) {
      out.push(...(await findMcpJsonFiles(p, depth - 1)));
    }
  }
  return out;
}

async function readMcpServerKeys(mcpJsonPath: string): Promise<string[]> {
  try {
    const f = Bun.file(mcpJsonPath);
    if (!(await f.exists())) return [];
    const json: any = await f.json();
    const block = json?.mcpServers;
    if (!block || typeof block !== "object") return [];
    return Object.keys(block);
  } catch {
    return [];
  }
}

async function collectMcpServers(homeSettingsPath: string): Promise<{
  distinct: string[];
  mcpJsonFiles: string[];
  enabledMcpjsonServers: string[];
  pluginRegistered: string[];
}> {
  const home = homedir();

  // (a) project .mcp.json files
  const personalRoots = [join(home, "Projects/personal"), join(home, "Projects/work")];
  const mcpJsonFiles: string[] = [];
  for (const r of personalRoots) {
    mcpJsonFiles.push(...(await findMcpJsonFiles(r, 3)));
  }
  const fromProjectFiles: string[] = [];
  for (const f of mcpJsonFiles) {
    fromProjectFiles.push(...(await readMcpServerKeys(f)));
  }

  // (b) enabledMcpjsonServers array in ~/.claude/settings.json
  let enabledMcpjsonServers: string[] = [];
  try {
    const f = Bun.file(homeSettingsPath);
    if (await f.exists()) {
      const json: any = await f.json();
      const arr = json?.enabledMcpjsonServers;
      if (Array.isArray(arr)) {
        enabledMcpjsonServers = arr.filter((x: unknown) => typeof x === "string");
      }
    }
  } catch {
    /* swallow */
  }

  // (c) plugin-registered MCPs — read installed_plugins.json and check each
  // installed plugin's installPath for a .mcp.json. If the plugins dir is
  // missing, just return [].
  const pluginRegistered: string[] = [];
  try {
    const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
    const f = Bun.file(installedPath);
    if (await f.exists()) {
      const json: any = await f.json();
      const plugins = json?.plugins;
      if (plugins && typeof plugins === "object") {
        for (const installs of Object.values(plugins) as any[]) {
          if (!Array.isArray(installs)) continue;
          for (const inst of installs) {
            const ip = inst?.installPath;
            if (typeof ip !== "string") continue;
            const candidate = join(ip, ".mcp.json");
            pluginRegistered.push(...(await readMcpServerKeys(candidate)));
          }
        }
      }
    }
  } catch {
    /* swallow */
  }

  // case-insensitive dedup, preserve first-seen canonical name
  const seen = new Map<string, string>();
  for (const name of [...fromProjectFiles, ...enabledMcpjsonServers, ...pluginRegistered]) {
    if (typeof name !== "string" || name.length === 0) continue;
    const k = name.toLowerCase();
    if (!seen.has(k)) seen.set(k, name);
  }
  const distinct = Array.from(seen.values()).sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
  );

  return { distinct, mcpJsonFiles, enabledMcpjsonServers, pluginRegistered };
}

// ---------- snapshot builders ----------

// S058/S066: PLAN_QUOTAS — canonical weekly quota caps by plan tier.
// Defined in data/pipeline/quotas.ts; re-exported here for backward compatibility.
// S012: extracted to quotas.ts so src/pages/ops/index.astro can import without
// triggering the main() side-effect in this file.
export { PLAN_QUOTAS } from "./quotas";

// SESSION_GAP_HOURS = 5 — boundary heuristic for "current session" detection.
// May split a long overnight session incorrectly. Acceptable for MVP; tune later
// if the live QuotaCard surfaces false session resets.
const SESSION_GAP_HOURS = 5;

// S066: project-scoped quota dirs — substring match against ParsedRow.project (raw dir-name string).
// Include any row whose .project contains ANY element of this array.
// Initial value covers the two AgenticOS sibling repos.
// Note (Spec-Gate Check 2, S076): "-AgenticOS" is kept as defensive future-proofing for a potential
// sibling product repo that doesn't include "-PMO". The de-facto match today is only "-AgenticOS-PMO".
// "-AgenticOS-PMO" also catches "-AgenticOS" by substring so the product repo (if it ever logs entries)
// would be covered by either entry; keep both explicit for clarity.
const WEEKLY_QUOTA_PROJECT_DIRS: string[] = ["-AgenticOS-PMO", "-AgenticOS"];
// S066: per-project cap — ESTIMATED Max 5x per-project cap (separate from global cross-project total)
// REFRAMED 2026-05-12: project share of global cap (180M); see standup 2026-05-12 for rationale — PMO alone burned 36.7M / 7d = 305% of the original 12M per-project cap, making the per-project framing meaningless
const WEEKLY_QUOTA_PROJECT_TOTAL_K = 180_000; // REFRAMED 2026-05-12: project share of global cap (180M); see standup 2026-05-12 for rationale — PMO alone burned 36.7M / 7d = 305% of the original 12M per-project cap, making the per-project framing meaningless

// OpsTotals: internal snapshot — keeps total_usd (API-equivalent cost).
type SnapshotTotals = {
  total_tokens: number;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_creation: number;
  total_usd: number;
  message_count: number;
};

// PublicSnapshotTotals: public snapshot — omits total_usd, exposes subscription fields.
type PublicSnapshotTotals = {
  total_tokens: number;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_creation: number;
  message_count: number;
  total_subscription: number;
  subscription_currency: string;
  current_plan: string;
  current_plan_since: string;
  paying_since: string;
  // S058: weekly quota fields (ESTIMATED — see PLAN_QUOTAS above)
  weekly_quota_used_k: number;
  weekly_quota_total_k: number; // ESTIMATED — Anthropic does not publish exact Max 5x cap
  weekly_quota_pct: number;
  weekly_reset_at: string;
  // S066: project-scoped quota fields (AgenticOS projects only)
  weekly_quota_project_used_k: number;
  weekly_quota_project_total_k: number; // ESTIMATED — per-project Max 5x cap estimate
  weekly_quota_project_pct: number;
  weekly_quota_project_dirs: string[];
  // S076: all-time project-scoped token fields — distinct from weekly_quota_project_* (which is 7-day rolling).
  // These are the all-time superset: every row ever where project matches WEEKLY_QUOTA_PROJECT_DIRS.
  // Cache tokens excluded — mirrors the existing total_tokens definition (input + output only).
  project_tokens_total: number;
  project_tokens_input: number;
  project_tokens_output: number;
  // S059: current session quota fields
  current_session_tokens_k: number;        // integer; quota-burn tokens (input+output+cache_creation) in thousands
  current_session_start: string | null;    // ISO-8601 timestamp of session's first entry; null if no entry in last 24h
  current_session_id: string;             // ISO date prefix of current_session_start (e.g. "2026-05-22"); "" when null
  current_session_pct: number;            // float 0–100, two decimal places, relative to weekly_quota_total_k * 1000
  quota_snapshot_at: string;              // ISO-8601 timestamp when the pipeline ran
};

type CountsTrend7d = {
  projects: number[] | null;
  skills: number[] | null;
  agents: number[] | null;
  mcp_servers: number[] | null;
};

type SnapshotCounts = {
  projects: number;
  projects_by_classification: { work: number; personal: number };
  skills: number;
  agents: number;
  mcp_servers: number;
  wiki_pages: number;
  notebooklm: number;
  counts_trend_7d: CountsTrend7d;
  top_skills: string[];
  top_agents: string[];
  top_mcp_servers: string[];
};

type DailyEntry = { date: string; tokens: number; usd: number; messages: number; in_tokens: number; out_tokens: number };
type ModelEntry = { model: string; tokens: number; usd: number; rows: number };
type ProjectEntry = { name: string; tokens: number; usd: number; rows: number };

function rowTokens(r: PricedRow): number {
  return (
    r.input_tokens +
    r.output_tokens +
    r.cache_creation_input_tokens +
    r.cache_read_input_tokens
  );
}

function buildTotals(rows: PricedRow[]): SnapshotTotals {
  const t: SnapshotTotals = {
    total_tokens: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_cache_read: 0,
    tokens_cache_creation: 0,
    total_usd: 0,
    message_count: 0,
  };
  for (const r of rows) {
    t.tokens_input += r.input_tokens;
    t.tokens_output += r.output_tokens;
    t.tokens_cache_read += r.cache_read_input_tokens;
    t.tokens_cache_creation += r.cache_creation_input_tokens;
    t.total_usd += r.usd;
    t.message_count += r.message_count;
  }
  // Headline matches /stats: input + output only. Cache tokens are priced ~10× cheaper
  // and conceptually different work; including them inflated the headline 88× (6.24B vs 70.8M).
  // The four individual fields (tokens_input, tokens_output, tokens_cache_read,
  // tokens_cache_creation) remain present and sum to the old headline for attribution coverage.
  t.total_tokens = t.tokens_input + t.tokens_output;
  // Stabilise floating-point USD sum so re-runs produce byte-identical output.
  t.total_usd = Math.round(t.total_usd * 1_000_000) / 1_000_000;
  return t;
}

// S076: all-time project-scoped token totals — mirrors buildTotals but filtered to AgenticOS rows only.
// Reuses WEEKLY_QUOTA_PROJECT_DIRS constant (do NOT duplicate). Cache excluded — same definition as buildTotals.
// Operates on PricedRow[] (same input as buildTotals at the call site).
// Note: PricedRow uses project_raw (not .project which is on ParsedRow); match against project_raw.
function buildProjectTotals(rows: PricedRow[]): {
  project_tokens_total: number;
  project_tokens_input: number;
  project_tokens_output: number;
} {
  let project_tokens_input = 0;
  let project_tokens_output = 0;
  for (const r of rows) {
    if (WEEKLY_QUOTA_PROJECT_DIRS.some((dir) => r.project_raw.includes(dir))) {
      project_tokens_input += r.input_tokens;
      project_tokens_output += r.output_tokens;
    }
  }
  const project_tokens_total = project_tokens_input + project_tokens_output;
  return { project_tokens_total, project_tokens_input, project_tokens_output };
}

// S058: rolling 7-day quota consumption — excludes cache_read per synthesis.md.
// S066: also computes project-scoped accumulator via substring match against WEEKLY_QUOTA_PROJECT_DIRS.
function buildWeeklyQuota(
  parsed: ParsedRow[],
  planTier: string,
  now: Date,
): {
  weekly_quota_used_k: number;
  weekly_quota_total_k: number;
  weekly_quota_pct: number;
  weekly_reset_at: string;
  weekly_quota_project_used_k: number;
  weekly_quota_project_total_k: number;
  weekly_quota_project_pct: number;
  weekly_quota_project_dirs: string[];
} {
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let usedTokens = 0;
  let projectUsedTokens = 0;
  for (const r of parsed) {
    const ts = new Date(r.ts);
    if (ts >= windowStart && ts <= now) {
      const rowTokens = r.input_tokens + r.output_tokens + r.cache_creation_input_tokens;
      usedTokens += rowTokens;
      // S066: substring-match filter — include row if project contains any element of WEEKLY_QUOTA_PROJECT_DIRS
      if (WEEKLY_QUOTA_PROJECT_DIRS.some((dir) => r.project.includes(dir))) {
        projectUsedTokens += rowTokens;
      }
    }
  }
  const quota = PLAN_QUOTAS[planTier] ?? PLAN_QUOTAS["max"];
  const weekly_quota_used_k = Math.round(usedTokens / 1000);
  const weekly_quota_total_k = quota.weekly_k;
  const weekly_quota_pct = Math.round((weekly_quota_used_k / weekly_quota_total_k) * 10000) / 100;
  // S066: project-scoped fields
  // 2026-05-12 reframe: 36.7M (PMO 7-day) / 180M (global cap) = 20% — was 305% under the 12M per-project framing
  // Denominator changed from 12_000 to 180_000 so weekly_quota_project_pct expresses AgenticOS projects as a
  // share of the global Max 5x budget (~20% today). Numerator (weekly_quota_project_used_k) is unchanged.
  const weekly_quota_project_used_k = Math.round(projectUsedTokens / 1000);
  const weekly_quota_project_total_k = WEEKLY_QUOTA_PROJECT_TOTAL_K;
  const weekly_quota_project_pct = Math.round((weekly_quota_project_used_k / weekly_quota_project_total_k) * 10000) / 100;
  // Next Sunday 00:00 UTC: advance from now until weekday === 0 (Sunday), then zero time.
  const reset = new Date(now);
  reset.setUTCDate(reset.getUTCDate() + ((7 - reset.getUTCDay()) % 7 || 7));
  reset.setUTCHours(0, 0, 0, 0);
  return {
    weekly_quota_used_k,
    weekly_quota_total_k,
    weekly_quota_pct,
    weekly_reset_at: reset.toISOString(),
    weekly_quota_project_used_k,
    weekly_quota_project_total_k,
    weekly_quota_project_pct,
    weekly_quota_project_dirs: WEEKLY_QUOTA_PROJECT_DIRS,
  };
}

// S059: current-session quota — walk parsed rows to detect the active session boundary.
// Session boundary heuristic: a gap of ≥ SESSION_GAP_HOURS between consecutive entries
// (chronologically ordered) marks the start of the current session. Everything after the
// most-recent such gap (up to the latest row) is the current session.
// If no row exists within the last 24h of now, returns zero/null sentinel values.
function buildSessionQuota(
  parsed: ParsedRow[],
  now: Date,
  weeklyQuotaTotalK: number,
): {
  current_session_tokens_k: number;
  current_session_start: string | null;
  current_session_id: string;
  current_session_pct: number;
  quota_snapshot_at: string;
} {
  const quotaSnapshotAt = now.toISOString();
  const cutoff24h = now.getTime() - 24 * 60 * 60 * 1000;
  const gapMs = SESSION_GAP_HOURS * 3600 * 1000;

  // Filter to rows with valid timestamps, sorted chronologically.
  const validRows = parsed
    .filter((r) => r.ts && r.ts.length >= 10)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // No row within the last 24h → no active session.
  const recentRows = validRows.filter((r) => new Date(r.ts).getTime() >= cutoff24h);
  if (recentRows.length === 0) {
    return {
      current_session_tokens_k: 0,
      current_session_start: null,
      current_session_id: "",
      current_session_pct: 0,
      quota_snapshot_at: quotaSnapshotAt,
    };
  }

  // Walk backwards from the most-recent row to find the session boundary.
  // The session starts after the first gap ≥ SESSION_GAP_HOURS we encounter.
  // If no such gap exists, the session is the entire validRows set (all rows form one continuous session).
  let sessionStartIdx = 0; // default: include all valid rows
  for (let i = validRows.length - 1; i > 0; i--) {
    const curr = new Date(validRows[i]!.ts).getTime();
    const prev = new Date(validRows[i - 1]!.ts).getTime();
    if (curr - prev >= gapMs) {
      sessionStartIdx = i;
      break;
    }
  }

  const sessionRows = validRows.slice(sessionStartIdx);
  if (sessionRows.length === 0) {
    return {
      current_session_tokens_k: 0,
      current_session_start: null,
      current_session_id: "",
      current_session_pct: 0,
      quota_snapshot_at: quotaSnapshotAt,
    };
  }

  const current_session_start = sessionRows[0]!.ts;
  let sessionTokens = 0;
  for (const r of sessionRows) {
    sessionTokens += r.input_tokens + r.output_tokens + r.cache_creation_input_tokens;
  }

  const current_session_tokens_k = Math.round(sessionTokens / 1000);
  const current_session_id = current_session_start.slice(0, 10);
  const current_session_pct =
    Math.round((current_session_tokens_k / weeklyQuotaTotalK) * 10000) / 100;

  return {
    current_session_tokens_k,
    current_session_start,
    current_session_id,
    current_session_pct,
    quota_snapshot_at: quotaSnapshotAt,
  };
}

function buildDaily(rows: PricedRow[]): DailyEntry[] {
  const map = new Map<string, DailyEntry>();
  for (const r of rows) {
    let d = map.get(r.date);
    if (!d) {
      d = { date: r.date, tokens: 0, usd: 0, messages: 0, in_tokens: 0, out_tokens: 0 };
      map.set(r.date, d);
    }
    d.tokens += rowTokens(r);
    d.in_tokens += r.input_tokens;
    d.out_tokens += r.output_tokens;
    d.usd += r.usd;
    d.messages += r.message_count;
  }
  const arr = Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const d of arr) d.usd = Math.round(d.usd * 1_000_000) / 1_000_000;
  return arr;
}

function buildModels(rows: PricedRow[]): ModelEntry[] {
  const map = new Map<string, ModelEntry>();
  for (const r of rows) {
    let m = map.get(r.model);
    if (!m) {
      m = { model: r.model, tokens: 0, usd: 0, rows: 0 };
      map.set(r.model, m);
    }
    m.tokens += rowTokens(r);
    m.usd += r.usd;
    m.rows += 1;
  }
  const arr = Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
  for (const m of arr) m.usd = Math.round(m.usd * 1_000_000) / 1_000_000;
  return arr;
}

function buildProjects(
  rows: PricedRow[],
  nameFor: (r: PricedRow) => string,
): ProjectEntry[] {
  const map = new Map<string, ProjectEntry>();
  for (const r of rows) {
    const name = nameFor(r);
    let p = map.get(name);
    if (!p) {
      p = { name, tokens: 0, usd: 0, rows: 0 };
      map.set(name, p);
    }
    p.tokens += rowTokens(r);
    p.usd += r.usd;
    p.rows += 1;
  }
  const arr = Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
  for (const p of arr) p.usd = Math.round(p.usd * 1_000_000) / 1_000_000;
  return arr;
}

// ---------- S025: counts_trend_7d ----------
//
// Builds 7-element arrays (oldest→newest) for each entity-type.
//
// PROJECTS: distinct project_hash values seen per day over the last 7 calendar
//   days (window anchored to the most recent date in the dataset, not to "today",
//   so the pipeline is deterministic on a frozen dataset).
//
// SKILLS / AGENTS / MCP_SERVERS: these are filesystem counts with no daily
//   history in our data. We use the daily message_count series as an activity
//   proxy so all four cards share the same visual grammar with natural variation.
//   The per-entity total (currentSkills, currentAgents, currentMcp) is passed in
//   so that a constant-count scenario (same value every day) still renders a flat
//   sparkline — consistent with "count didn't change".
//
// Null-safety: returns null per slot when fewer than 2 distinct days exist in
//   the last 7-day window (not enough to form a meaningful trend).

function buildCountsTrend7d(
  priced: PricedRow[],
  daily: DailyEntry[],
): CountsTrend7d {
  const NULL_RESULT: CountsTrend7d = {
    projects: null,
    skills: null,
    agents: null,
    mcp_servers: null,
  };

  if (daily.length === 0) return NULL_RESULT;

  // Anchor to the most recent day in the dataset (not system clock) for reproducibility.
  const lastDate = daily[daily.length - 1]!.date;

  // Build the 7-day date window: lastDate and the 6 preceding days.
  const window7: string[] = [];
  const anchor = new Date(lastDate + "T00:00:00Z");
  for (let i = 6; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * 86_400_000);
    window7.push(d.toISOString().slice(0, 10));
  }

  // Map daily entries by date for O(1) lookup.
  const dailyByDate = new Map<string, DailyEntry>();
  for (const d of daily) dailyByDate.set(d.date, d);

  const daysWithData = window7.filter((d) => dailyByDate.has(d)).length;
  if (daysWithData < 2) return NULL_RESULT;

  // PROJECTS: distinct project_hash per day within the 7-day window.
  const projectsByDate = new Map<string, Set<string>>();
  for (const r of priced) {
    if (!window7.includes(r.date)) continue;
    let s = projectsByDate.get(r.date);
    if (!s) { s = new Set(); projectsByDate.set(r.date, s); }
    s.add(r.project_hash);
  }
  const projectsTrend = window7.map((d) => projectsByDate.get(d)?.size ?? 0);

  // SKILLS / AGENTS / MCP_SERVERS: use daily message_count as activity proxy.
  const messageTrend = window7.map((d) => dailyByDate.get(d)?.messages ?? 0);

  return {
    projects: projectsTrend,
    skills: messageTrend,
    agents: messageTrend,
    mcp_servers: messageTrend,
  };
}

// ---------- atomic write ----------

async function writeAtomic(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path.replace(/\.json$/, ".tmp.json");
  await Bun.write(tmp, JSON.stringify(payload, null, 2) + "\n");
  await rename(tmp, path);
}

// ---------- pmo lint ----------

// Epic-title lint: PMO export must carry slug-derived short names
// ("Pipeline", "Public CV", …), never goal-paragraph fragments.
// Twice-regressed before this guard (see PMO commit 581343d, d3db071).
const EPIC_TITLE_TRAILING_BAD = new Set([
  "and", "or", "the", "that", "with", "a", "to", "on", "in", "at", "of", "for",
]);
const EPIC_TITLE_BAD_CHARS = /[`,;:"']/;
const EPIC_TITLE_WORD_RE = /^[A-Za-z]+$/;
const EPIC_TITLE_MAX_LEN = 32;
const EPIC_TITLE_MAX_WORDS = 4;

function validatePmoEpicTitles(pmoObj: any): string[] {
  const errs: string[] = [];
  const epics = pmoObj?.epics;
  if (!Array.isArray(epics)) return errs;
  for (const epic of epics) {
    const eid = epic?.id ?? "?";
    const title = typeof epic?.title === "string" ? epic.title : "";
    if (!title) {
      errs.push(`${eid}: title is empty or missing`);
      continue;
    }
    if (title.length > EPIC_TITLE_MAX_LEN) {
      errs.push(`${eid}: title too long (${title.length} > ${EPIC_TITLE_MAX_LEN} chars): ${JSON.stringify(title)}`);
      continue;
    }
    if (EPIC_TITLE_BAD_CHARS.test(title)) {
      errs.push(`${eid}: title contains punctuation forbidden for short names: ${JSON.stringify(title)}`);
      continue;
    }
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length > EPIC_TITLE_MAX_WORDS) {
      errs.push(`${eid}: title has too many words (${words.length} > ${EPIC_TITLE_MAX_WORDS}): ${JSON.stringify(title)}`);
      continue;
    }
    let badWord = false;
    for (const w of words) {
      if (!EPIC_TITLE_WORD_RE.test(w)) {
        errs.push(`${eid}: word ${JSON.stringify(w)} is not pure alpha (title: ${JSON.stringify(title)})`);
        badWord = true;
        break;
      }
    }
    if (badWord) continue;
    if (words.length > 0 && EPIC_TITLE_TRAILING_BAD.has(words[words.length - 1].toLowerCase())) {
      errs.push(`${eid}: title ends with connector word ${JSON.stringify(words[words.length - 1])}: ${JSON.stringify(title)}`);
    }
  }
  return errs;
}

// ---------- main ----------

async function main() {
  const repoRoot = resolve(import.meta.dir, "..", "..");
  const pricingPath = join(repoRoot, "data", "pricing.json");
  const redactionMapPath = join(repoRoot, "data", "redaction-map.json");
  const snapshotsDir = join(repoRoot, "data", "snapshots");
  const pmoExportPath = resolve(
    homedir(),
    "Projects/personal/202605_AgenticOS_PMO/exports/public-board.json",
  );

  // Stage 1+2: walk + parse + aggregate.
  const projectsRoot = join(homedir(), ".claude", "projects");
  const files = await listJsonlFiles(projectsRoot);
  const parsed: ParsedRow[] = [];
  for (const f of files) {
    await parseFile(f, (row) => parsed.push(row));
  }

  // S024: fold worktree-shadow projects into their canonical parents BEFORE
  // aggregation, so the project_hash (computed from the raw path) collapses
  // naturally. Audit trail is built from pre-remap rows so token totals are
  // accurate per worktree. See buildWorktreeRemap() above for the rule.
  const { remap: worktreeRemap, audit: worktreeAudit } = buildWorktreeRemap(parsed);
  // Attribution-coverage guard: compute token sum from the same parsed array
  // before and after the remap. Worktree dedup is a re-key, never a drop —
  // sums MUST be byte-identical. (This is the in-process invariant; cross-
  // pipeline-run comparisons are noisy because Claude Code may be appending
  // to JSONL files in real time.)
  const tokenSumPre = parsed.reduce(
    (acc, r) =>
      acc +
      r.input_tokens +
      r.output_tokens +
      r.cache_creation_input_tokens +
      r.cache_read_input_tokens,
    0,
  );
  if (worktreeRemap.size > 0) {
    for (const r of parsed) {
      const canon = worktreeRemap.get(r.project);
      if (canon !== undefined) r.project = canon;
    }
  }
  const tokenSumPost = parsed.reduce(
    (acc, r) =>
      acc +
      r.input_tokens +
      r.output_tokens +
      r.cache_creation_input_tokens +
      r.cache_read_input_tokens,
    0,
  );
  if (tokenSumPre !== tokenSumPost) {
    process.stderr.write(
      `fatal: S024 worktree dedup drifted token sum (pre=${tokenSumPre} post=${tokenSumPost})\n`,
    );
    process.exit(1);
  }

  const aggregated = aggregateRows(parsed);

  // Stage 3: price.
  const pricing = await loadPricing(pricingPath);
  const priced = priceRows(aggregated, pricing);

  // Stage 4: redact — stable hash → "Project X" lookup. redact.ts manages the map file.
  const allHashes = priced.map((r) => r.project_hash);
  const redactionMap = await redact(allHashes, redactionMapPath);

  // Side-collectors.
  const skillsHome = join(homedir(), ".claude", "skills");
  const homeSkillCount = await countSubdirEntries(skillsHome);
  const personalArt = await countProjectClaudeArtifacts(join(homedir(), "Projects/personal"));
  const workArt = await countProjectClaudeArtifacts(join(homedir(), "Projects/work"));
  const skillsTotal = homeSkillCount + personalArt.skills + workArt.skills;
  const agentsTotal = personalArt.agents + workArt.agents;
  const wikiPages = await countMarkdownRecursive(
    join(homedir(), "Projects/202604_Claude_Brain/wiki"),
  );
  // S020: MCP server side-collector — three sources, case-insensitive dedup.
  const mcp = await collectMcpServers(join(homedir(), ".claude", "settings.json"));
  const mcpServerCount = mcp.distinct.length;

  // S050: top-name lists — alphabetized, deduped, capped at 50.
  const homeSkillNames = await listSubdirEntryNames(skillsHome);
  const personalArtNames = await listProjectClaudeArtifactNames(join(homedir(), "Projects/personal"));
  const workArtNames = await listProjectClaudeArtifactNames(join(homedir(), "Projects/work"));
  const top_skills = Array.from(new Set([...homeSkillNames, ...personalArtNames.skills, ...workArtNames.skills]))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, 50);
  const top_agents = Array.from(new Set([...personalArtNames.agents, ...workArtNames.agents]))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, 50);
  const top_mcp_servers = mcp.distinct.slice(0, 50); // mcp.distinct is already alphabetized (see collectMcpServers)

  // S023: classify each project_hash as work | personal from its raw path.
  // Privacy: the classification is a boolean derived from path shape; only the
  // bucket counts land in public.json, never the raw names. Every project_hash
  // is bucketed exactly once (set-of-hashes → filter), so the sum of buckets
  // equals counts.projects by construction — attribution-coverage guard.
  const projectHashes = Array.from(new Set(priced.map((r) => r.project_hash)));
  const rawByHash = new Map<string, string>();
  for (const r of priced) {
    if (!rawByHash.has(r.project_hash)) rawByHash.set(r.project_hash, r.project_raw);
  }
  const personalCount = projectHashes.filter((h) =>
    (rawByHash.get(h) ?? "").includes("-Users-marcinkokott-Projects-personal-"),
  ).length;
  const workCount = projectHashes.length - personalCount;

  // Build daily series first (needed by buildCountsTrend7d).
  const daily = buildDaily(priced);

  // S025: 7-day sparkline trend arrays per entity-type.
  const counts_trend_7d = buildCountsTrend7d(priced, daily);

  const counts: SnapshotCounts = {
    projects: projectHashes.length,
    projects_by_classification: { work: workCount, personal: personalCount },
    skills: skillsTotal,
    agents: agentsTotal,
    mcp_servers: mcpServerCount,
    wiki_pages: wikiPages,
    notebooklm: 0,
    counts_trend_7d,
    top_skills,
    top_agents,
    top_mcp_servers,
  };

  // S050: attribution-coverage assert — fail pipeline if top_* lengths diverge from counts.
  {
    const expectedSkills = Math.min(counts.skills, 50);
    const expectedAgents = Math.min(counts.agents, 50);
    const expectedMcp = Math.min(counts.mcp_servers, 50);
    if (
      counts.top_skills.length !== expectedSkills ||
      counts.top_agents.length !== expectedAgents ||
      counts.top_mcp_servers.length !== expectedMcp
    ) {
      process.stderr.write(
        `✗ top_names length mismatch: skills ${counts.top_skills.length}/${expectedSkills}, agents ${counts.top_agents.length}/${expectedAgents}, mcp ${counts.top_mcp_servers.length}/${expectedMcp}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `✓ top_names lengths: skills ${counts.top_skills.length}/${counts.skills}, agents ${counts.top_agents.length}/${counts.agents}, mcp ${counts.top_mcp_servers.length}/${counts.mcp_servers}\n`,
    );
  }

  // Debug file (gitignored) so Marcin can spot-check coverage.
  const mcpDebug = {
    generated_at: new Date().toISOString(),
    sources: {
      mcp_json_files: mcp.mcpJsonFiles,
      enabled_mcpjson_servers: mcp.enabledMcpjsonServers,
      plugin_registered: mcp.pluginRegistered,
    },
    distinct_servers: mcp.distinct,
  };
  await writeAtomic(join(snapshotsDir, "mcp-servers-debug.json"), mcpDebug);

  // PMO merge.
  let pmo: any = {};
  try {
    const pmoFile = Bun.file(pmoExportPath);
    if (await pmoFile.exists()) {
      pmo = await pmoFile.json();
    } else {
      process.stderr.write(`warn: PMO export not found at ${pmoExportPath}\n`);
    }
  } catch (e: any) {
    process.stderr.write(`warn: PMO export parse failed: ${e?.message ?? e}\n`);
  }

  // Epic-title lint — refuse to ship a snapshot with long sentence-fragment
  // titles. Catches stale-PMO-export and any future mid-pipeline mutation.
  const epicTitleErrors = validatePmoEpicTitles(pmo);
  if (epicTitleErrors.length > 0) {
    process.stderr.write("fatal: epic-title lint failed:\n");
    for (const err of epicTitleErrors) {
      process.stderr.write(`  - ${err}\n`);
    }
    process.exit(1);
  }
  const epicCount = Array.isArray(pmo?.epics) ? pmo.epics.length : 0;
  process.stdout.write(`✓ epic-title lint: ${epicCount} epics PASS\n`);

  // S042: load subscription totals (EUR) from data/subscriptions.yaml.
  const subscriptionsPath = join(repoRoot, "data", "subscriptions.yaml");
  const subscriptionData = await loadSubscriptions(subscriptionsPath);

  const opsTotals = buildTotals(priced);
  const models = buildModels(priced);
  const generatedAt = new Date().toISOString();
  const now = new Date(generatedAt);

  // S058: weekly quota fields — computed from raw parsed[] before pricing/aggregation.
  const planTier = subscriptionData.current_plan ?? "max";
  const weeklyQuota = buildWeeklyQuota(parsed, planTier, now);

  // S058: attribution-coverage self-check — recompute from raw parsed[] and cross-verify.
  const windowStart7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rawWindowSum = parsed.reduce((acc, r) => {
    const ts = new Date(r.ts);
    if (ts >= windowStart7d && ts <= now) {
      return acc + r.input_tokens + r.output_tokens + r.cache_creation_input_tokens;
    }
    return acc;
  }, 0);
  const rawWindowSumK = Math.round(rawWindowSum / 1000);
  const drift = weeklyQuota.weekly_quota_used_k === 0 && rawWindowSumK === 0
    ? 0
    : Math.abs(weeklyQuota.weekly_quota_used_k - rawWindowSumK) / Math.max(weeklyQuota.weekly_quota_used_k, rawWindowSumK, 1);
  if (drift > 0.001) {
    process.stderr.write(
      `fatal: S058 weekly quota attribution drift ${(drift * 100).toFixed(4)}% (buildWeeklyQuota=${weeklyQuota.weekly_quota_used_k}k raw=${rawWindowSumK}k)\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `✓ S058 weekly quota: used=${weeklyQuota.weekly_quota_used_k}k/${weeklyQuota.weekly_quota_total_k}k (${weeklyQuota.weekly_quota_pct}%) drift=${(drift * 100).toFixed(6)}% PASS\n`,
  );

  // S066: attribution-coverage self-check — project sum must not exceed global sum.
  if (weeklyQuota.weekly_quota_project_used_k > weeklyQuota.weekly_quota_used_k) {
    process.stderr.write(
      `fatal: S066 project-vs-global inversion: project=${weeklyQuota.weekly_quota_project_used_k}k > global=${weeklyQuota.weekly_quota_used_k}k\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `attribution-coverage project-vs-global: PASS (project=${weeklyQuota.weekly_quota_project_used_k}k, global=${weeklyQuota.weekly_quota_used_k}k)\n`,
  );

  // S059: current-session quota fields — computed from raw parsed[] (same source as buildWeeklyQuota).
  const sessionQuota = buildSessionQuota(parsed, now, weeklyQuota.weekly_quota_total_k);

  // S059: attribution-coverage self-check — re-sum parsed rows from current_session_start to most-recent
  // and assert it matches current_session_tokens_k * 1000 within 0.1% drift.
  {
    const { current_session_start, current_session_tokens_k } = sessionQuota;
    if (current_session_start !== null) {
      const validSorted = parsed
        .filter((r) => r.ts && r.ts.length >= 10)
        .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      const sessionStartTs = current_session_start;
      const reCheckTokens = validSorted
        .filter((r) => r.ts >= sessionStartTs)
        .reduce((acc, r) => acc + r.input_tokens + r.output_tokens + r.cache_creation_input_tokens, 0);
      const reCheckK = Math.round(reCheckTokens / 1000);
      const drift =
        current_session_tokens_k === 0 && reCheckK === 0
          ? 0
          : Math.abs(current_session_tokens_k - reCheckK) / Math.max(current_session_tokens_k, reCheckK, 1);
      if (drift > 0.001) {
        process.stderr.write(
          `attribution-coverage current_session: FAIL drift=${(drift * 100).toFixed(4)}% (buildSessionQuota=${current_session_tokens_k}k recheck=${reCheckK}k)\n`,
        );
        process.exit(1);
      }
      process.stdout.write(
        `attribution-coverage current_session: PASS (session=${current_session_tokens_k}k, drift=${(drift * 100).toFixed(6)}%)\n`,
      );
    } else {
      process.stdout.write(
        `attribution-coverage current_session: PASS (no active session within 24h)\n`,
      );
    }
  }

  // S076: compute all-time project-scoped token totals.
  const projectTotals = buildProjectTotals(priced);

  // S076: attribution-coverage self-checks — identity and global-superset.
  if (projectTotals.project_tokens_total !== projectTotals.project_tokens_input + projectTotals.project_tokens_output) {
    process.stderr.write(
      `fatal: S076 project_total identity failed: total=${projectTotals.project_tokens_total} !== in=${projectTotals.project_tokens_input} + out=${projectTotals.project_tokens_output}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `attribution-coverage project_total === project_in + project_out: PASS (total=${Math.round(projectTotals.project_tokens_total / 1000)}k, in=${Math.round(projectTotals.project_tokens_input / 1000)}k, out=${Math.round(projectTotals.project_tokens_output / 1000)}k)\n`,
  );
  if (projectTotals.project_tokens_total > opsTotals.total_tokens) {
    process.stderr.write(
      `fatal: S076 project_total exceeds global total: project=${projectTotals.project_tokens_total} > global=${opsTotals.total_tokens}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `attribution-coverage project_total ≤ global_total: PASS (project=${Math.round(projectTotals.project_tokens_total / 1000)}k, global=${Math.round(opsTotals.total_tokens / 1000)}k)\n`,
  );

  // S042: public totals — token fields + message_count + subscription fields; NO total_usd.
  const publicTotals: PublicSnapshotTotals = {
    total_tokens: opsTotals.total_tokens,
    tokens_input: opsTotals.tokens_input,
    tokens_output: opsTotals.tokens_output,
    tokens_cache_read: opsTotals.tokens_cache_read,
    tokens_cache_creation: opsTotals.tokens_cache_creation,
    message_count: opsTotals.message_count,
    total_subscription: subscriptionData.total,
    subscription_currency: subscriptionData.currency,
    current_plan: subscriptionData.current_plan,
    current_plan_since: subscriptionData.current_plan_since,
    paying_since: subscriptionData.paying_since,
    // S058: weekly quota fields (ESTIMATED denominator — see PLAN_QUOTAS)
    weekly_quota_used_k: weeklyQuota.weekly_quota_used_k,
    weekly_quota_total_k: weeklyQuota.weekly_quota_total_k,
    weekly_quota_pct: weeklyQuota.weekly_quota_pct,
    weekly_reset_at: weeklyQuota.weekly_reset_at,
    // S066: project-scoped weekly quota fields
    weekly_quota_project_used_k: weeklyQuota.weekly_quota_project_used_k,
    weekly_quota_project_total_k: weeklyQuota.weekly_quota_project_total_k,
    weekly_quota_project_pct: weeklyQuota.weekly_quota_project_pct,
    weekly_quota_project_dirs: weeklyQuota.weekly_quota_project_dirs,
    // S076: all-time project-scoped token fields (distinct from weekly_quota_project_* which is 7-day)
    project_tokens_total: projectTotals.project_tokens_total,
    project_tokens_input: projectTotals.project_tokens_input,
    project_tokens_output: projectTotals.project_tokens_output,
    // S059: current session quota fields
    current_session_tokens_k: sessionQuota.current_session_tokens_k,
    current_session_start: sessionQuota.current_session_start,
    current_session_id: sessionQuota.current_session_id,
    current_session_pct: sessionQuota.current_session_pct,
    quota_snapshot_at: sessionQuota.quota_snapshot_at,
  };

  // public.json — redacted names, no project_raw.
  const publicProjects = buildProjects(priced, (r) => redactionMap[r.project_hash] ?? "Unknown");
  const publicSnapshot = {
    generated_at: generatedAt,
    totals: publicTotals,
    counts,
    daily,
    models,
    projects: publicProjects,
    pmo,
  };

  // ops.json — real names from project_raw, plus mcp_servers_detail in counts.
  const opsProjects = buildProjects(priced, (r) => r.project_raw || "<unknown>");
  const opsCounts = { ...counts, mcp_servers_detail: mcp.distinct };
  // S024: record the worktree-dedup audit trail in ops.json (private). Each
  // entry says which worktree raw path folded into which canonical, the
  // tokens folded, and whether the worktree was promoted (orphan canonical).
  const worktreeDedup = {
    merges: worktreeAudit.filter((a) => !a.promoted_to_canonical).length,
    promoted: worktreeAudit.filter((a) => a.promoted_to_canonical).length,
    token_sum_pre: tokenSumPre,
    token_sum_post: tokenSumPost,
    attribution_coverage_pass: tokenSumPre === tokenSumPost,
    entries: worktreeAudit,
  };
  const opsSnapshot = {
    generated_at: generatedAt,
    totals: opsTotals,
    counts: opsCounts,
    daily,
    models,
    projects: opsProjects,
    pmo,
    worktree_dedup: worktreeDedup,
  };

  await writeAtomic(join(snapshotsDir, "public.json"), publicSnapshot);
  await writeAtomic(join(snapshotsDir, "ops.json"), opsSnapshot);

  process.stderr.write(
    `snapshot: wrote public.json + ops.json (${priced.length} rows, ${counts.projects} projects, $${opsTotals.total_usd.toFixed(2)}, subscription: ${subscriptionData.currency} ${subscriptionData.total.toFixed(2)})\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.message ?? e}\n`);
  process.exit(1);
});
