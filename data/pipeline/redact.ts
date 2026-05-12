#!/usr/bin/env bun
// S004: Stable redaction map. Maps each project_hash → "Project A", "Project B", ...
// First-run: hash-sorted assignment. Subsequent runs: append-only at the next free label.
// Map persists to data/redaction-map.json (gitignored). Pure `redact()` is testable
// in isolation; CLI mode reads aggregated JSON from stdin and emits the same rows
// with a `redacted_name` field added.

const MAP_PATH = "data/redaction-map.json";

/**
 * Convert a 0-based index to a spreadsheet-style alphabetic label.
 *   0 → A, 25 → Z, 26 → AA, 27 → AB, ..., 701 → ZZ, 702 → AAA.
 */
export function indexToLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`indexToLabel: index must be a non-negative integer, got ${index}`);
  }
  let n = index;
  let out = "";
  while (true) {
    const rem = n % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return out;
}

/**
 * Inverse of indexToLabel — used to find the next free index when the map
 * was created or extended in some previous run.
 *   A → 0, Z → 25, AA → 26, AB → 27.
 */
function labelToIndex(label: string): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i) - 64; // A=1
    if (c < 1 || c > 26) {
      throw new Error(`labelToIndex: invalid char in label "${label}"`);
    }
    n = n * 26 + c;
  }
  return n - 1;
}

async function loadMap(path: string): Promise<Record<string, string>> {
  const f = Bun.file(path);
  if (!(await f.exists())) return {};
  try {
    const data = (await f.json()) as Record<string, string>;
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
    return {};
  } catch {
    return {};
  }
}

async function saveMap(path: string, map: Record<string, string>): Promise<void> {
  // Stable key order = hash-sorted for deterministic diffs.
  const ordered: Record<string, string> = {};
  for (const k of Object.keys(map).sort()) ordered[k] = map[k];
  await Bun.write(path, JSON.stringify(ordered, null, 2) + "\n");
}

/**
 * Public API. Ensures every input hash has a stable label in the persisted map.
 * Returns the FULL map (not just the inputs) so callers can use it as a lookup.
 */
export async function redact(
  hashes: string[],
  mapPath: string = MAP_PATH,
): Promise<Record<string, string>> {
  const map = await loadMap(mapPath);

  // Compute next free index from existing labels.
  let nextIndex = 0;
  for (const lbl of Object.values(map)) {
    const m = /^Project ([A-Z]+)$/.exec(lbl);
    if (!m) continue;
    const idx = labelToIndex(m[1]);
    if (idx + 1 > nextIndex) nextIndex = idx + 1;
  }

  // Unique, unseen hashes, sorted so first-run is deterministic and
  // subsequent appends are also deterministic w.r.t. their batch.
  const seen = new Set(Object.keys(map));
  const newHashes = Array.from(new Set(hashes))
    .filter((h) => typeof h === "string" && h.length > 0 && !seen.has(h))
    .sort();

  if (newHashes.length === 0) return map;

  for (const h of newHashes) {
    map[h] = `Project ${indexToLabel(nextIndex)}`;
    nextIndex++;
  }
  await saveMap(mapPath, map);
  return map;
}

// ---------- CLI mode ----------

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

async function main() {
  const raw = await readAllStdin();
  if (!raw.trim()) {
    process.stderr.write("redact: empty stdin\n");
    process.exit(1);
  }
  let rows: any;
  try {
    rows = JSON.parse(raw);
  } catch (e: any) {
    process.stderr.write(`redact: invalid JSON on stdin: ${e?.message ?? e}\n`);
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    process.stderr.write("redact: expected JSON array on stdin\n");
    process.exit(1);
  }
  const hashes: string[] = [];
  for (const r of rows) {
    if (r && typeof r === "object" && typeof r.project_hash === "string") {
      hashes.push(r.project_hash);
    }
  }
  const map = await redact(hashes);
  // The redaction CLI is the gate before "public" output. Strip any field
  // that could leak the real project name (aggregate.ts emits `project_raw`
  // for ops-side reconciliation; it must not survive into a public file).
  const out = rows.map((r: any) => {
    if (r && typeof r === "object" && typeof r.project_hash === "string") {
      const { project_raw, ...rest } = r;
      return { ...rest, redacted_name: map[r.project_hash] ?? null };
    }
    return r;
  });
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

// Only run main() when invoked directly, not when imported.
if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`fatal: ${e?.message ?? e}\n`);
    process.exit(1);
  });
}
