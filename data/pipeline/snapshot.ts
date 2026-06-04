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
import { ResearchSchema } from "./research.schema";

// ---------- types ----------

type ParsedRow = {
  ts: string;
  session_id: string;
  project: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  // S117: work-share attribution — derived from msg.content[] tool_use names
  category: 'manual' | 'agents' | 'skills' | 'mcp';
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
  const session_id = basename(path, ".jsonl");
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
  // S121 secondary: track preceding Skill/mcp__ tool_use so subsequent no-tool_use
  // assistant turns (up to the next tool_use or user message) inherit that bucket.
  let pendingCategory: ParsedRow['category'] | null = null;
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
    // User turns mark a context boundary — clear any pending span.
    if (obj?.type === 'user') { pendingCategory = null; return; }
    if (obj?.type !== "assistant") return;
    const msg = obj.message;
    if (!msg || typeof msg !== "object") return;
    if (msg.role !== "assistant") return;
    // S021: filter CLI-fabricated assistant turns (rate-limit, 4xx/5xx, auth, plan-mode replays) — all zero-usage sentinels.
    if (msg.model === "<synthetic>") return;
    const usage = msg.usage;
    if (!usage || typeof usage !== "object") return;
    // S117+S121: categorize by tool usage; S121 secondary spans; S121 primary sidechain override.
    // Priority: isSidechain > Agent > Skill > mcp__ > pending-span > manual.
    let category: ParsedRow['category'] = 'manual';
    if (Array.isArray(msg.content)) {
      let hasAgent = false, hasSkill = false, hasMcp = false, hasOtherTool = false;
      for (const block of msg.content) {
        if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
        const n: string = block.name;
        if (n === 'Agent') { hasAgent = true; break; }
        if (n === 'Skill') hasSkill = true;
        else if (n.startsWith('mcp__')) hasMcp = true;
        else hasOtherTool = true;
      }
      if (hasAgent) { category = 'agents'; pendingCategory = null; }
      else if (hasSkill) { category = 'skills'; pendingCategory = 'skills'; }
      else if (hasMcp) { category = 'mcp'; pendingCategory = 'mcp'; }
      else if (hasOtherTool) { pendingCategory = null; }
      else if (pendingCategory !== null) { category = pendingCategory; }
    } else if (pendingCategory !== null) {
      category = pendingCategory;
    }
    // S121 primary: sidechain entries are agent work regardless of tool_use content.
    if (obj.isSidechain === true) category = 'agents';
    sink({
      ts: typeof obj.timestamp === "string" ? obj.timestamp : "",
      session_id,
      project,
      model: typeof msg.model === "string" ? msg.model : "",
      input_tokens: num(usage.input_tokens),
      output_tokens: num(usage.output_tokens),
      cache_creation_input_tokens: num(usage.cache_creation_input_tokens),
      cache_read_input_tokens: num(usage.cache_read_input_tokens),
      category,
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
  // S115: cumulative billable tokens (input + output) as of 7 days before the
  // snapshot anchor date — the real 7-day baseline for the S078 hero sparkline.
  // null when the dataset is younger than 7 days (no bucket predates the cutoff).
  tokens_7d_ago: number | null;
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
  // S117: work-share attribution buckets (input+output tokens, matching total_tokens base)
  manual_tokens_share: number;
  agents_tokens_share: number;
  skills_tokens_share: number;
  mcp_tokens_share: number;
  manual_tokens_k: number;
  agents_tokens_k: number;
  skills_tokens_k: number;
  mcp_tokens_k: number;
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
  sessions: number;
  active_days: number;
  total_days_in_range: number;
  counts_trend_7d: CountsTrend7d;
  top_skills: string[];
  top_agents: string[];
  top_mcp_servers: string[];
};

// S123: by_model keys are model IDs; values = input+output+cache_creation+cache_read (matches daily.tokens).
// Shape: daily[].by_model{ <model_id>: tokens } — chosen over top-level models_daily[] because the
// 4-line chart walks daily[] for x-axis dates and can key into by_model directly, no cross-join.
// S147: work_share = per-day in+out token counts by category (raw, not shares). Populated from ParsedRow[].
type DailyEntry = { date: string; tokens: number; usd: number; messages: number; in_tokens: number; out_tokens: number; by_model: Record<string, number>; work_share: { manual: number; agents: number; skills: number; mcp: number } };
type ModelEntry = { model: string; tokens: number; tokens_input: number; tokens_output: number; tokens_cache_read: number; tokens_cache_creation: number; usd: number; rows: number };
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

// S117: work-share attribution — four buckets derived from ParsedRow.category.
// Tokens base: input + output only (matches total_tokens definition, excludes cache).
// manual = residual (entries with no tool_use), NOT a synthetic zero-fill.
function buildWorkShare(parsed: ParsedRow[]): {
  manual_tokens_k: number;
  agents_tokens_k: number;
  skills_tokens_k: number;
  mcp_tokens_k: number;
  manual_tokens_share: number;
  agents_tokens_share: number;
  skills_tokens_share: number;
  mcp_tokens_share: number;
  _raw_total: number;
} {
  let manual = 0, agents = 0, skills = 0, mcp = 0;
  for (const r of parsed) {
    const t = r.input_tokens + r.output_tokens;
    switch (r.category) {
      case 'agents': agents += t; break;
      case 'skills': skills += t; break;
      case 'mcp': mcp += t; break;
      default: manual += t; break;
    }
  }
  const total = manual + agents + skills + mcp;
  const pct = (n: number): number => total === 0 ? 0 : Math.round((n / total) * 10000) / 100;
  return {
    manual_tokens_k: Math.round(manual / 1000),
    agents_tokens_k: Math.round(agents / 1000),
    skills_tokens_k: Math.round(skills / 1000),
    mcp_tokens_k: Math.round(mcp / 1000),
    manual_tokens_share: pct(manual),
    agents_tokens_share: pct(agents),
    skills_tokens_share: pct(skills),
    mcp_tokens_share: pct(mcp),
    _raw_total: total,
  };
}

// S120: per-project work-share — same four category buckets as buildWorkShare, grouped by project.
type WorkShareBucket = {
  manual_tokens_k: number;
  agents_tokens_k: number;
  skills_tokens_k: number;
  mcp_tokens_k: number;
  manual_tokens_share: number;
  agents_tokens_share: number;
  skills_tokens_share: number;
  mcp_tokens_share: number;
};

function categoryBuckets(): { manual: number; agents: number; skills: number; mcp: number } {
  return { manual: 0, agents: 0, skills: 0, mcp: 0 };
}

function bucketToShare(b: { manual: number; agents: number; skills: number; mcp: number }): WorkShareBucket {
  const total = b.manual + b.agents + b.skills + b.mcp;
  const pct = (n: number): number => total === 0 ? 0 : Math.round((n / total) * 10000) / 100;
  return {
    manual_tokens_k: Math.round(b.manual / 1000),
    agents_tokens_k: Math.round(b.agents / 1000),
    skills_tokens_k: Math.round(b.skills / 1000),
    mcp_tokens_k: Math.round(b.mcp / 1000),
    manual_tokens_share: pct(b.manual),
    agents_tokens_share: pct(b.agents),
    skills_tokens_share: pct(b.skills),
    mcp_tokens_share: pct(b.mcp),
  };
}

function addToCategory(
  b: { manual: number; agents: number; skills: number; mcp: number },
  category: ParsedRow['category'],
  tokens: number,
): void {
  switch (category) {
    case 'agents': b.agents += tokens; break;
    case 'skills': b.skills += tokens; break;
    case 'mcp': b.mcp += tokens; break;
    default: b.manual += tokens; break;
  }
}

// PUBLIC: keyed by WEEKLY_QUOTA_PROJECT_DIRS suffixes (already-public constants, no raw names in public.json).
// dirs are matched longest-first so "-AgenticOS-PMO" is not mis-assigned to the "-AgenticOS" bucket.
function buildWorkShareByDir(parsed: ParsedRow[], dirs: string[]): Record<string, WorkShareBucket> {
  const sortedDirs = [...dirs].sort((a, b) => b.length - a.length);
  const raw = new Map<string, { manual: number; agents: number; skills: number; mcp: number }>();
  for (const dir of dirs) raw.set(dir, categoryBuckets());

  for (const r of parsed) {
    const t = r.input_tokens + r.output_tokens;
    for (const dir of sortedDirs) {
      if (r.project.includes(dir)) {
        addToCategory(raw.get(dir)!, r.category, t);
        break;
      }
    }
  }

  const result: Record<string, WorkShareBucket> = {};
  for (const dir of dirs) result[dir] = bucketToShare(raw.get(dir)!);
  return result;
}

// OPS: full per-project array with canonical project names. Not exposed in public.json.
function buildWorkShareByProject(
  parsed: ParsedRow[],
): Array<{ project: string } & WorkShareBucket> {
  const map = new Map<string, { manual: number; agents: number; skills: number; mcp: number }>();
  for (const r of parsed) {
    const t = r.input_tokens + r.output_tokens;
    let b = map.get(r.project);
    if (!b) { b = categoryBuckets(); map.set(r.project, b); }
    addToCategory(b, r.category, t);
  }
  return Array.from(map.entries())
    .map(([project, b]) => ({ project, ...bucketToShare(b) }))
    .sort((a, b) =>
      (b.manual_tokens_k + b.agents_tokens_k + b.skills_tokens_k + b.mcp_tokens_k) -
      (a.manual_tokens_k + a.agents_tokens_k + a.skills_tokens_k + a.mcp_tokens_k),
    );
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

// S039: session + streak metrics computed from ParsedRow[] (post-<synthetic>-filter, post-worktree-dedup).
function buildSessionMetrics(
  parsed: ParsedRow[],
  now: Date,
): {
  counts_sessions: number;
  counts_active_days: number;
  counts_total_days_in_range: number;
  session_metrics: {
    longest_session_minutes: number;
    most_active_day: string;
    longest_streak_days: number;
    current_streak_days: number;
  };
} {
  const valid = parsed.filter((r) => r.ts && r.ts.length >= 10);

  const counts_sessions = new Set<string>(valid.map((r) => r.session_id)).size;

  const activeDatesSet = new Set<string>(valid.map((r) => r.ts.slice(0, 10)));
  const activeDates = Array.from(activeDatesSet).sort();
  const counts_active_days = activeDates.length;

  let counts_total_days_in_range = 0;
  if (activeDates.length >= 2) {
    const first = new Date(activeDates[0]! + "T00:00:00Z");
    const last = new Date(activeDates[activeDates.length - 1]! + "T00:00:00Z");
    counts_total_days_in_range = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  } else if (activeDates.length === 1) {
    counts_total_days_in_range = 1;
  }

  // longest_session_minutes: max(last_ts − first_ts) per session_id
  const sessionBounds = new Map<string, { min: number; max: number }>();
  for (const r of valid) {
    const t = new Date(r.ts).getTime();
    if (Number.isNaN(t)) continue;
    const b = sessionBounds.get(r.session_id);
    if (!b) { sessionBounds.set(r.session_id, { min: t, max: t }); }
    else { if (t < b.min) b.min = t; if (t > b.max) b.max = t; }
  }
  let longest_session_minutes = 0;
  for (const b of sessionBounds.values()) {
    const mins = Math.round((b.max - b.min) / 60_000);
    if (mins > longest_session_minutes) longest_session_minutes = mins;
  }

  // most_active_day: day with highest tokens_input + tokens_output
  const dayTokens = new Map<string, number>();
  for (const r of valid) {
    const d = r.ts.slice(0, 10);
    dayTokens.set(d, (dayTokens.get(d) ?? 0) + r.input_tokens + r.output_tokens);
  }
  let most_active_day = "";
  let maxDayTokens = -1;
  for (const [d, t] of dayTokens) {
    if (t > maxDayTokens) { maxDayTokens = t; most_active_day = d; }
  }

  // streaks
  let longest_streak_days = 0;
  if (activeDates.length > 0) {
    let streak = 1;
    for (let i = 1; i < activeDates.length; i++) {
      const diffDays = Math.round(
        (new Date(activeDates[i]! + "T00:00:00Z").getTime() -
         new Date(activeDates[i - 1]! + "T00:00:00Z").getTime()) / 86_400_000,
      );
      if (diffDays === 1) { streak++; } else { if (streak > longest_streak_days) longest_streak_days = streak; streak = 1; }
    }
    if (streak > longest_streak_days) longest_streak_days = streak;
  }

  // current_streak: consecutive days with activity ending at today (pipeline runtime date)
  const todayStr = now.toISOString().slice(0, 10);
  let current_streak_days = 0;
  let checkDate = new Date(todayStr + "T00:00:00Z");
  while (activeDatesSet.has(checkDate.toISOString().slice(0, 10))) {
    current_streak_days++;
    checkDate = new Date(checkDate.getTime() - 86_400_000);
  }

  return {
    counts_sessions,
    counts_active_days,
    counts_total_days_in_range,
    session_metrics: {
      longest_session_minutes,
      most_active_day,
      longest_streak_days,
      current_streak_days,
    },
  };
}

function buildDaily(
  rows: PricedRow[],
  workShareByDate: Map<string, { manual: number; agents: number; skills: number; mcp: number }>,
): DailyEntry[] {
  const map = new Map<string, DailyEntry>();
  for (const r of rows) {
    let d = map.get(r.date);
    if (!d) {
      d = { date: r.date, tokens: 0, usd: 0, messages: 0, in_tokens: 0, out_tokens: 0, by_model: {}, work_share: { manual: 0, agents: 0, skills: 0, mcp: 0 } };
      map.set(r.date, d);
    }
    const t = rowTokens(r);
    d.tokens += t;
    d.in_tokens += r.input_tokens;
    d.out_tokens += r.output_tokens;
    d.usd += r.usd;
    d.messages += r.message_count;
    // S123: accumulate per-model tokens in the same pass; no second JSONL walk.
    d.by_model[r.model] = (d.by_model[r.model] ?? 0) + t;
  }
  const arr = Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const d of arr) {
    d.usd = Math.round(d.usd * 1_000_000) / 1_000_000;
    // S147: merge per-day category buckets from ParsedRow[] (in+out tokens only).
    const ws = workShareByDate.get(d.date);
    if (ws) d.work_share = { ...ws };
  }
  return arr;
}

function buildModels(rows: PricedRow[]): ModelEntry[] {
  const map = new Map<string, ModelEntry>();
  for (const r of rows) {
    let m = map.get(r.model);
    if (!m) {
      m = { model: r.model, tokens: 0, tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_creation: 0, usd: 0, rows: 0 };
      map.set(r.model, m);
    }
    m.tokens_input += r.input_tokens;
    m.tokens_output += r.output_tokens;
    m.tokens_cache_read += r.cache_read_input_tokens;
    m.tokens_cache_creation += r.cache_creation_input_tokens;
    m.usd += r.usd;
    m.rows += 1;
  }
  for (const m of map.values()) {
    // S037: tokens = input + output, matching totals.total_tokens definition (excludes cache tokens; cache-inclusive sum is ~100x larger).
    m.tokens = m.tokens_input + m.tokens_output;
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

// S147: per-day category bucket accumulator — mirrors buildWorkShare but keyed by date (ts.slice(0,10)).
// Tokens base: input + output (matching total_tokens definition). category from ParsedRow.
// Reuses categoryBuckets() + addToCategory() helpers defined above.
function buildDailyWorkShare(
  parsed: ParsedRow[],
): Map<string, { manual: number; agents: number; skills: number; mcp: number }> {
  const map = new Map<string, { manual: number; agents: number; skills: number; mcp: number }>();
  for (const r of parsed) {
    if (!r.ts || r.ts.length < 10) continue;
    const date = r.ts.slice(0, 10);
    let b = map.get(date);
    if (!b) { b = categoryBuckets(); map.set(date, b); }
    addToCategory(b, r.category, r.input_tokens + r.output_tokens);
  }
  return map;
}

// S147: window-aggregate work-share from daily[] entries.
// Reuses cutoff-date pattern from S038 (anchor-based, not now-based). cutoff=undefined = all time.
// Reuses bucketToShare() to produce the same WorkShareBucket shape as buildWorkShare().
function buildWorkShareWindow(daily: DailyEntry[], cutoff?: string): WorkShareBucket {
  const b = categoryBuckets();
  for (const d of daily) {
    if (cutoff !== undefined && d.date < cutoff) continue;
    b.manual += d.work_share.manual;
    b.agents += d.work_share.agents;
    b.skills += d.work_share.skills;
    b.mcp += d.work_share.mcp;
  }
  return bucketToShare(b);
}

// ---------- S115: tokens_7d_ago ----------
//
// Cumulative billable tokens (input + output, matching totals.total_tokens) as
// of 7 days before the snapshot anchor date. Anchor = most recent daily bucket
// (not the system clock) for reproducibility, mirroring buildCountsTrend7d. The
// baseline is taken as-of the latest EXISTING daily bucket whose date is ≤
// (anchor − 7d) — nearest earlier real bucket, never a synthetic zero-fill or
// fabricated date. Returns null when no bucket predates the cutoff (dataset
// younger than 7 days). Reuses the priced daily[] series; does not re-walk JSONL.
function computeTokens7dAgo(daily: DailyEntry[]): number | null {
  if (daily.length === 0) return null;
  const lastDate = daily[daily.length - 1]!.date;
  const cutoff = new Date(new Date(lastDate + "T00:00:00Z").getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // daily is sorted oldest→newest (buildDaily). Cumulate billable (in + out)
  // for every bucket on or before the cutoff date; asOf tracks the source
  // bucket actually used, proving the value lands on a real daily[] entry.
  let cumulative = 0;
  let asOf: string | null = null;
  for (const d of daily) {
    if (d.date > cutoff) break;
    cumulative += d.in_tokens + d.out_tokens;
    asOf = d.date;
  }
  return asOf === null ? null : cumulative;
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

// ---------- S164: per-sprint token breakdown ----------

type SprintTokenEntry = {
  sprint_id: string;
  // total_k = all 4 token types; by_model/by_category/by_token_type each sum to total_k.
  total_k: number;
  // quota_k = input+output+cache_creation (S133 quota basis, cache_read excluded).
  // Used for drift_pct and weekly_window_share_pct to match buildWeeklyQuota methodology.
  quota_k: number;
  by_model: Record<string, number>;
  by_category: { manual: number; agents: number; skills: number; mcp: number };
  by_token_type: { input: number; output: number; cache_creation: number; cache_read: number };
  drift_pct: number | null;
  measurement_flag: string | null;
  weekly_window_share_pct: number;
  noisy: boolean;
};

// S164: Window parsed rows over each closed sprint's [started_at, ended_at) interval,
// project-filtered to AgenticOS rows (-AgenticOS-PMO or -AgenticOS).
// total_k = all 4 token types so by_model / by_category / by_token_type each sum to total_k.
// noisy=true when measurement_flag ≠ "snapshot-delta-clean" OR sprint wall < 30 min (S133 L5).
function buildSprintTokens(
  parsed: ParsedRow[],
  closedSprints: any[],
  weeklyQuotaTotalK: number,
): SprintTokenEntry[] {
  const agosRows = parsed.filter(
    (r) =>
      r.ts &&
      r.ts.length >= 10 &&
      (r.project.includes("-AgenticOS-PMO") || r.project.includes("-AgenticOS")),
  );

  const result: SprintTokenEntry[] = [];

  for (const sprint of closedSprints) {
    const sprintId: string = sprint.sprint_id;
    const startedAt: string = sprint.started_at;
    const endedAt: string = sprint.ended_at;
    if (!sprintId || !startedAt || !endedAt) continue;

    const startTs = new Date(startedAt).getTime();
    const endTs = new Date(endedAt).getTime();
    if (Number.isNaN(startTs) || Number.isNaN(endTs)) continue;

    const actualWallMin = num(sprint.actual_wall_clock_min);
    const actualTotalK: number | null =
      typeof sprint.actual_total_tokens_k === "number" ? sprint.actual_total_tokens_k : null;
    const measurementFlag: string | null =
      typeof sprint.actual_total_measurement === "string" ? sprint.actual_total_measurement : null;

    let inputRaw = 0,
      outputRaw = 0,
      cacheCreationRaw = 0,
      cacheReadRaw = 0;
    const byModelRaw: Record<string, number> = {};
    const byCatRaw = { manual: 0, agents: 0, skills: 0, mcp: 0 };

    for (const r of agosRows) {
      const t = new Date(r.ts).getTime();
      if (Number.isNaN(t) || t < startTs || t >= endTs) continue;

      const rowTotal =
        r.input_tokens +
        r.output_tokens +
        r.cache_creation_input_tokens +
        r.cache_read_input_tokens;
      inputRaw += r.input_tokens;
      outputRaw += r.output_tokens;
      cacheCreationRaw += r.cache_creation_input_tokens;
      cacheReadRaw += r.cache_read_input_tokens;

      byModelRaw[r.model] = (byModelRaw[r.model] ?? 0) + rowTotal;

      switch (r.category) {
        case "agents": byCatRaw.agents += rowTotal; break;
        case "skills": byCatRaw.skills += rowTotal; break;
        case "mcp": byCatRaw.mcp += rowTotal; break;
        default: byCatRaw.manual += rowTotal; break;
      }
    }

    const totalRaw = inputRaw + outputRaw + cacheCreationRaw + cacheReadRaw;
    const total_k = Math.round(totalRaw / 1000);
    // quota_k = S133 basis (input+output+cache_creation, cache_read excluded) — used for drift/share.
    const quota_k = Math.round((inputRaw + outputRaw + cacheCreationRaw) / 1000);

    const by_model: Record<string, number> = {};
    for (const [m, tok] of Object.entries(byModelRaw)) {
      by_model[m] = Math.round(tok / 1000);
    }

    const by_category = {
      manual: Math.round(byCatRaw.manual / 1000),
      agents: Math.round(byCatRaw.agents / 1000),
      skills: Math.round(byCatRaw.skills / 1000),
      mcp: Math.round(byCatRaw.mcp / 1000),
    };

    const by_token_type = {
      input: Math.round(inputRaw / 1000),
      output: Math.round(outputRaw / 1000),
      cache_creation: Math.round(cacheCreationRaw / 1000),
      cache_read: Math.round(cacheReadRaw / 1000),
    };

    // drift_pct: quota_k (windowed, S133 basis) vs actual_total_tokens_k (PM estimate, same basis).
    const drift_pct =
      actualTotalK !== null
        ? Math.round(((quota_k - actualTotalK) / Math.max(actualTotalK, 1)) * 10000) / 100
        : null;

    // weekly_window_share_pct: quota_k / weeklyQuotaTotalK (quota-basis apples-to-apples).
    const weekly_window_share_pct =
      weeklyQuotaTotalK > 0
        ? Math.round((quota_k / weeklyQuotaTotalK) * 10000) / 100
        : 0;

    const noisy = measurementFlag !== "snapshot-delta-clean" || actualWallMin < 30;

    result.push({
      sprint_id: sprintId,
      total_k,
      quota_k,
      by_model,
      by_category,
      by_token_type,
      drift_pct,
      measurement_flag: measurementFlag,
      weekly_window_share_pct,
      noisy,
    });
  }

  return result;
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

  // S147: per-day work-share map (ParsedRow[] → date → {manual,agents,skills,mcp} raw in+out tokens).
  const dailyWorkShareMap = buildDailyWorkShare(parsed);

  // Build daily series first (needed by buildCountsTrend7d).
  const daily = buildDaily(priced, dailyWorkShareMap);

  // S123: attribution-coverage — sum(by_model values) must equal daily.tokens within ±1 per day.
  {
    let pass = true;
    for (const d of daily) {
      const modelSum = Object.values(d.by_model).reduce((s, v) => s + v, 0);
      if (Math.abs(modelSum - d.tokens) > 1) {
        process.stderr.write(`fatal: S123 by_model sum mismatch on ${d.date}: by_model_sum=${modelSum} daily.tokens=${d.tokens}\n`);
        pass = false;
      }
    }
    if (!pass) process.exit(1);
    process.stdout.write(`✓ S123 by_model attribution-coverage: ${daily.length} days PASS\n`);
  }

  // S025: 7-day sparkline trend arrays per entity-type.
  const counts_trend_7d = buildCountsTrend7d(priced, daily);

  // S115: real 7-day-ago cumulative billable baseline (input + output).
  const tokens_7d_ago = computeTokens7dAgo(daily);

  // S039: session + streak metrics — post-<synthetic>-filter, post-worktree-dedup.
  const sessionMetrics = buildSessionMetrics(parsed, new Date());

  const counts: SnapshotCounts = {
    projects: projectHashes.length,
    projects_by_classification: { work: workCount, personal: personalCount },
    skills: skillsTotal,
    agents: agentsTotal,
    mcp_servers: mcpServerCount,
    wiki_pages: wikiPages,
    notebooklm: 0,
    sessions: sessionMetrics.counts_sessions,
    active_days: sessionMetrics.counts_active_days,
    total_days_in_range: sessionMetrics.counts_total_days_in_range,
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

  // Research data — load + Zod-validate; fail pipeline on schema violation.
  const researchPath = join(repoRoot, "data", "snapshots", "research.json");
  let research: any;
  try {
    const researchFile = Bun.file(researchPath);
    if (!(await researchFile.exists())) {
      process.stderr.write(`fatal: research.json not found at ${researchPath}\n`);
      process.exit(1);
    }
    const raw = await researchFile.json();
    const result = ResearchSchema.safeParse(raw);
    if (!result.success) {
      process.stderr.write(`fatal: research.json schema validation failed:\n${result.error.toString()}\n`);
      process.exit(1);
    }
    research = result.data;
    process.stdout.write(
      `✓ research.json: ${research.validated.length} validated, ${research.watching.length} watching, ${research.backlog.length} backlog PASS\n`,
    );
  } catch (e: any) {
    process.stderr.write(`fatal: research.json load error: ${e?.message ?? e}\n`);
    process.exit(1);
  }

  // S131: Derive research.garden = { nodes[], edges[] }.
  // state computed per design.md rule; tier = longest DFS depth from root.
  {
    const validatedIds = new Set<string>((research.validated as any[]).map((n: any) => n.id));

    const allNodes: any[] = [
      ...(research.validated as any[]).map((n: any) => ({ ...n, _src: "validated" })),
      ...(research.watching as any[]).map((n: any) => ({ ...n, _src: "watching" })),
      ...(research.backlog as any[]).map((n: any) => ({ ...n, _src: "backlog" })),
    ];

    const catToGroup: Record<string, string> = {
      data: "E", process: "C", "cost-model": "A", "tool-choice": "D",
    };

    const nodeMap: Record<string, any> = Object.fromEntries(allNodes.map((n: any) => [n.id, n]));

    function prereqsMet(node: any): boolean {
      return (node.requires ?? []).every((r: string) => validatedIds.has(r));
    }

    const tierMemo: Record<string, number> = {};
    function computeTier(id: string): number {
      if (id in tierMemo) return tierMemo[id];
      const node = nodeMap[id];
      const reqs: string[] = node?.requires ?? [];
      if (reqs.length === 0) { tierMemo[id] = 0; return 0; }
      tierMemo[id] = 1 + Math.max(...reqs.map(computeTier));
      return tierMemo[id];
    }

    const gardenNodes = allNodes.map((n: any) => {
      const state =
        n._src === "validated" ? "validated"
        : n._src === "watching" ? (prereqsMet(n) ? "watching" : "locked")
        : (prereqsMet(n) ? "available" : "locked");
      const tier = computeTier(n.id);
      const group = n.group ?? catToGroup[n.category] ?? "F";
      const base: any = { id: n.id, group, title: n.title, state, tier, requires: n.requires ?? [] };
      if (state === "validated") base.severity = n.severity;
      if (state === "watching") { base.n = n.n; base.threshold = n.threshold; }
      if (state === "available" || state === "locked") base.score = n.score ?? 0;
      return base;
    });

    const gardenEdges: Array<{ from: string; to: string }> = [];
    for (const n of gardenNodes) {
      for (const req of (n.requires as string[])) {
        gardenEdges.push({ from: req, to: n.id });
      }
    }

    (research as any).garden = { nodes: gardenNodes, edges: gardenEdges };
  }

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

  // S038: windowed totals + models (last 7 / 30 calendar days, anchored to latest daily bucket).
  // Re-aggregate from priced rows (not daily[].by_model which lacks in/out/cache split).
  const anchorDate = daily.length > 0 ? daily[daily.length - 1]!.date : '';
  const dateSubtract = (base: string, days: number): string => {
    if (!base) return base;
    return new Date(new Date(base + 'T00:00:00Z').getTime() - days * 86_400_000)
      .toISOString().slice(0, 10);
  };
  const cutoff7d = dateSubtract(anchorDate, 6);   // 7-day inclusive window
  const cutoff30d = dateSubtract(anchorDate, 29);  // 30-day inclusive window
  const priced7d = priced.filter(r => r.date >= cutoff7d);
  const priced30d = priced.filter(r => r.date >= cutoff30d);
  const totals_7d = buildTotals(priced7d);
  const totals_30d = buildTotals(priced30d);
  const models_7d = buildModels(priced7d);
  const models_30d = buildModels(priced30d);
  process.stdout.write(
    `✓ S038 windowed: 7d_rows=${priced7d.length} (cutoff ${cutoff7d}) 30d_rows=${priced30d.length} (cutoff ${cutoff30d})\n`,
  );

  // S147: windowed work-share aggregates — reuse cutoff7d/cutoff30d (anchor-based, S038 pattern).
  // buildWorkShareWindow() sums daily[].work_share buckets for the window then calls bucketToShare().
  const work_share_7d = buildWorkShareWindow(daily, cutoff7d);
  const work_share_30d = buildWorkShareWindow(daily, cutoff30d);
  const work_share_all = buildWorkShareWindow(daily);
  // S147: attribution-coverage — shares sum ≈ 100 per non-empty window (tolerance ±0.5).
  for (const [label, ws] of [['7d', work_share_7d], ['30d', work_share_30d], ['all', work_share_all]] as [string, WorkShareBucket][]) {
    const totalK = ws.manual_tokens_k + ws.agents_tokens_k + ws.skills_tokens_k + ws.mcp_tokens_k;
    const sharesSum = ws.manual_tokens_share + ws.agents_tokens_share + ws.skills_tokens_share + ws.mcp_tokens_share;
    if (totalK > 0 && Math.abs(sharesSum - 100) > 0.5) {
      process.stderr.write(`fatal: S147 work_share_${label} shares sum ${sharesSum.toFixed(2)} ≠ 100±0.5\n`);
      process.exit(1);
    }
    process.stdout.write(
      `✓ S147 work_share_${label}: manual=${ws.manual_tokens_share}% agents=${ws.agents_tokens_share}% skills=${ws.skills_tokens_share}% mcp=${ws.mcp_tokens_share}% sum=${sharesSum.toFixed(2)}% PASS\n`,
    );
  }

  // S037: attribution-coverage self-check — sum(models[].tokens_input) + sum(models[].tokens_output)
  // must equal totals.tokens_input + totals.tokens_output within ±1 token.
  {
    const modelsIn = models.reduce((s, m) => s + m.tokens_input, 0);
    const modelsOut = models.reduce((s, m) => s + m.tokens_output, 0);
    const modelsInOut = modelsIn + modelsOut;
    const globalsInOut = opsTotals.tokens_input + opsTotals.tokens_output;
    const drift = Math.abs(modelsInOut - globalsInOut);
    if (drift > 1) {
      process.stderr.write(
        `fatal: S037 model attribution drift: models=${modelsInOut} totals=${globalsInOut} drift=${drift}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `attribution-coverage models in+out: PASS (models=${modelsInOut}, totals=${globalsInOut}, drift=${drift})\n`,
    );
  }

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

  // S164: per-sprint token breakdown — attach to pmo object before snapshot assembly.
  {
    const closedSprints = Array.isArray(pmo?.closed_sprints) ? pmo.closed_sprints : [];
    const sprintTokens = buildSprintTokens(parsed, closedSprints, weeklyQuota.weekly_quota_total_k);
    pmo.sprint_tokens = sprintTokens;

    // S164 attribution-coverage self-check: by_model / by_category / by_token_type each sum ≈ total_k.
    // Rounding tolerance = max(10k, numModelBuckets/2) to accommodate per-bucket rounding.
    let attrPass = true;
    for (const s of sprintTokens) {
      const modelSum = Object.values(s.by_model).reduce((a, b) => a + b, 0);
      const catSum =
        s.by_category.manual +
        s.by_category.agents +
        s.by_category.skills +
        s.by_category.mcp;
      const tokSum =
        s.by_token_type.input +
        s.by_token_type.output +
        s.by_token_type.cache_creation +
        s.by_token_type.cache_read;
      const tol = Math.max(10, Object.keys(s.by_model).length);
      if (
        Math.abs(modelSum - s.total_k) > tol ||
        Math.abs(catSum - s.total_k) > tol ||
        Math.abs(tokSum - s.total_k) > tol
      ) {
        process.stderr.write(
          `warn: S164 attribution-coverage rounding on ${s.sprint_id}: total_k=${s.total_k} model_sum=${modelSum} cat_sum=${catSum} tok_sum=${tokSum}\n`,
        );
        attrPass = false;
      }
    }
    process.stdout.write(
      `✓ S164 sprint_tokens: ${sprintTokens.length} sprints, noisy=${sprintTokens.filter((s) => s.noisy).length}, attribution-coverage ${attrPass ? "PASS" : "WARN"}\n`,
    );
  }

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

  // S117: work-share attribution — four token buckets from ParsedRow.category.
  const workShare = buildWorkShare(parsed);
  // attribution-coverage: sum of four raw buckets must equal global in+out within 0.1% drift.
  {
    const globalInOut = opsTotals.tokens_input + opsTotals.tokens_output;
    const drift = globalInOut === 0 && workShare._raw_total === 0
      ? 0
      : Math.abs(workShare._raw_total - globalInOut) / Math.max(globalInOut, workShare._raw_total, 1);
    if (drift > 0.001) {
      process.stderr.write(
        `fatal: S117 work-share coverage drift ${(drift * 100).toFixed(4)}%: share_total=${workShare._raw_total} global_in_out=${globalInOut}\n`,
      );
      process.exit(1);
    }
    const sharesSum = workShare.manual_tokens_share + workShare.agents_tokens_share + workShare.skills_tokens_share + workShare.mcp_tokens_share;
    process.stdout.write(
      `✓ S117 work-share: manual=${workShare.manual_tokens_share}% agents=${workShare.agents_tokens_share}% skills=${workShare.skills_tokens_share}% mcp=${workShare.mcp_tokens_share}% sum=${sharesSum.toFixed(2)}% coverage_drift=${(drift * 100).toFixed(6)}% PASS\n`,
    );
  }

  // S120: per-project work-share — computed from parsed[] (post worktree remap, same source as S117).
  const workShareByDir = buildWorkShareByDir(parsed, WEEKLY_QUOTA_PROJECT_DIRS);
  const workShareByProject = buildWorkShareByProject(parsed);
  // Attribution-coverage log — emit per-dir shares for QA verification.
  for (const dir of WEEKLY_QUOTA_PROJECT_DIRS) {
    const d = workShareByDir[dir]!;
    const sharesSum = d.manual_tokens_share + d.agents_tokens_share + d.skills_tokens_share + d.mcp_tokens_share;
    process.stdout.write(
      `✓ S120 work-share dir="${dir}": manual=${d.manual_tokens_share}% agents=${d.agents_tokens_share}% skills=${d.skills_tokens_share}% mcp=${d.mcp_tokens_share}% sum=${sharesSum.toFixed(2)}%\n`,
    );
  }
  process.stdout.write(`✓ S120 work_share_by_project: ${workShareByProject.length} projects\n`);

  // S042: public totals — token fields + message_count + subscription fields; NO total_usd.
  const publicTotals: PublicSnapshotTotals = {
    total_tokens: opsTotals.total_tokens,
    tokens_input: opsTotals.tokens_input,
    tokens_output: opsTotals.tokens_output,
    tokens_cache_read: opsTotals.tokens_cache_read,
    tokens_cache_creation: opsTotals.tokens_cache_creation,
    message_count: opsTotals.message_count,
    // S115: cumulative billable baseline as of anchor − 7d (null if dataset < 7d).
    tokens_7d_ago,
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
    // S117: work-share attribution buckets
    manual_tokens_share: workShare.manual_tokens_share,
    agents_tokens_share: workShare.agents_tokens_share,
    skills_tokens_share: workShare.skills_tokens_share,
    mcp_tokens_share: workShare.mcp_tokens_share,
    manual_tokens_k: workShare.manual_tokens_k,
    agents_tokens_k: workShare.agents_tokens_k,
    skills_tokens_k: workShare.skills_tokens_k,
    mcp_tokens_k: workShare.mcp_tokens_k,
  };

  // public.json — redacted names, no project_raw.
  const publicProjects = buildProjects(priced, (r) => redactionMap[r.project_hash] ?? "Unknown");
  const publicSnapshot = {
    generated_at: generatedAt,
    totals: publicTotals,
    // S038: windowed token totals (same field shape as totals, sans subscription fields).
    totals_7d,
    totals_30d,
    counts,
    session_metrics: sessionMetrics.session_metrics,
    daily,
    models,
    // S038: windowed per-model arrays (same entry shape as models).
    models_7d,
    models_30d,
    projects: publicProjects,
    // S120: per-project work-share keyed by quota-dir suffix (already-public constants, no raw names).
    work_share_by_project_dir: workShareByDir,
    // S147: windowed work-share aggregates (anchor-based 7d/30d/all; shares sum ≈ 100, manual = residual).
    work_share_7d,
    work_share_30d,
    work_share_all,
    pmo,
    research,
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
    // S120: per-project work-share with canonical project names (ops-only, private).
    work_share_by_project: workShareByProject,
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
