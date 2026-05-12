// Canonical weekly quota caps by plan tier.
// S058: ESTIMATED weekly quota caps — Anthropic does not publish the exact Max 5x weekly cap.
// S066: global denominator retuned from 12_000 to 180_000 based on empirical 7-day burn.
// See notes/research-outputs/R2-weekly-quota.md and synthesis.md § "Resolved contradictions".
//
// This module is extracted so it can be imported by both data/pipeline/snapshot.ts
// and src/pages/ops/index.astro without triggering the pipeline's top-level main() call.
export const PLAN_QUOTAS: Record<string, { weekly_k: number }> = {
  pro:   { weekly_k: 2_400 },   // ESTIMATED — Pro is ~1/5 of Max 5x
  max:   { weekly_k: 180_000 }, // ESTIMATED global denominator — empirical 7-day cross-project burn 2026-05-11: 156M tokens across 13 projects; 180M adds ~15% headroom
  max20: { weekly_k: 48_000 },  // ESTIMATED — Max 20x (4× Max 5x)
};
