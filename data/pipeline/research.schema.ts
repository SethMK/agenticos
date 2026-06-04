import { z } from "zod";

const SprintAnchorSchema = z.string().regex(/^(SPR-\d+|E\d+)$/, "must match SPR-NNN or E-NNN format");
const StoryAnchorSchema = z.string().regex(/^S\d+$/, "must match S-NNN format");

const GroupSchema = z.object({
  id: z.string().regex(/^[A-F]$/, "group id must be A–F"),
  title: z.string().min(1),
  blurb: z.string().min(1),
});

const EvidenceSchema = z.object({
  n: z.number().int().nonnegative(),
  sprints: z.array(SprintAnchorSchema),
  stories: z.array(StoryAnchorSchema),
});

const ValidatedSchema = z.object({
  id: z.string().min(1),
  group: z.string().regex(/^[A-F]$/, "group ref must be A–F"),
  title: z.string().min(1),
  claim: z.string().min(1),
  practice: z.string().min(1),
  evidence: EvidenceSchema,
  severity: z.enum(["critical", "high", "medium", "low"]),
  requires: z.array(z.string()).default([]),
});

const WatchingSchema = z.object({
  id: z.string().min(1),
  group: z.string().regex(/^[A-F]$/, "group ref must be A–F"),
  title: z.string().min(1),
  claim: z.string().min(1),
  n: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
  sprints: z.array(SprintAnchorSchema),
  note: z.string().min(1),
  requires: z.array(z.string()).default([]),
});

const BacklogSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  score: z.number().int().nonnegative(),
  claim: z.string().min(1),
  artifact: z.string().min(1),
  group: z.string().regex(/^[A-F]$/).optional(),
  requires: z.array(z.string()).default([]),
});

export const ResearchSchema = z.object({
  generated_at: z.string().datetime(),
  groups: z.array(GroupSchema).min(1),
  validated: z.array(ValidatedSchema).min(1),
  watching: z.array(WatchingSchema),
  backlog: z.array(BacklogSchema),
});

export type Research = z.infer<typeof ResearchSchema>;
