import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { INDEX_RELATIVE_PATH, readIndex } from "./runIndex.js";
import type {
  EvalRunResult,
  Judgement,
  RunIndexEntry,
  SystemName,
} from "./types.js";

const CONFIG_RELATIVE_PATH = "eval/regression-config.json";

const RegressionConfigSchema = z.object({
  maxCorrectnessDropPct: z.number().min(0),
  maxGroundednessDropPct: z.number().min(0),
  /** Ratio: head total cost / base total cost. 1.5 = up to 50% more is fine. */
  maxCostIncreaseRatio: z.number().min(1),
  /** If true: any case that was correct in base and incorrect in head fails. */
  failOnNewPassToFail: z.boolean(),
  /** Which systems to gate. Empty array gates nothing (useful for dry-run). */
  checkedSystems: z.array(z.enum(["baseline", "agent"])),
  /**
   * Adversarial pass-rate drop tolerance, in percentage points. Skipped when
   * either base or head has no adversarial cases. Defaults to 0 (any drop
   * fails) to stay conservative on the security-shaped metric.
   */
  maxAdversarialDropPct: z.number().min(0).default(0),
  /**
   * Multi-hop pass-rate drop tolerance, in percentage points. Skipped when
   * either base or head has no multi-hop cases. Defaults to 5pp — multi-hop
   * is small-sample and noisy at the case level; a real regression should
   * still trip but a single jittered grade should not.
   */
  maxMultihopDropPct: z.number().min(0).default(5),
});

type RegressionConfig = z.infer<typeof RegressionConfigSchema>;

interface Violation {
  system: SystemName;
  kind:
    | "correctness-drop"
    | "groundedness-drop"
    | "adversarial-drop"
    | "multihop-drop"
    | "cost-increase"
    | "case-regression";
  message: string;
}

interface PickedPair {
  base: RunIndexEntry;
  head: RunIndexEntry;
}

function usage(): never {
  console.error(
    "usage: npm run eval:check [-- <baseRunId> <headRunId>]\n" +
      "  no args  : check newest run against the previous on the same datasetHash\n" +
      "  two args : check explicit pair (8-char prefix OK). Older = base, newer = head.",
  );
  process.exit(2);
}

function findByPrefix(entries: ReadonlyArray<RunIndexEntry>, prefix: string): RunIndexEntry {
  const matches = entries.filter((e) => e.runId.startsWith(prefix));
  if (matches.length === 0) throw new Error(`no run matching "${prefix}"`);
  if (matches.length > 1) {
    const ids = matches.map((m) => m.runId).join(", ");
    throw new Error(`prefix "${prefix}" is ambiguous (${matches.length} matches: ${ids})`);
  }
  const hit = matches[0];
  if (hit === undefined) throw new Error("unreachable");
  return hit;
}

function pickPair(entries: ReadonlyArray<RunIndexEntry>, args: ReadonlyArray<string>): PickedPair {
  const sorted = [...entries].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  if (args.length === 0) {
    const latest = sorted[0];
    if (latest === undefined) throw new Error("no runs in index");
    const prev = sorted.slice(1).find((e) => e.datasetHash === latest.datasetHash);
    if (prev === undefined) {
      throw new Error(
        `no prior run with datasetHash=${latest.datasetHash}; pass explicit runIds to override`,
      );
    }
    return { base: prev, head: latest };
  }

  if (args.length !== 2) usage();
  const a = findByPrefix(sorted, args[0] ?? "");
  const b = findByPrefix(sorted, args[1] ?? "");
  if (a.runId === b.runId) throw new Error("both runIds resolve to the same run");
  return a.finishedAt < b.finishedAt ? { base: a, head: b } : { base: b, head: a };
}

async function loadResult(resultsFileRel: string): Promise<EvalRunResult> {
  const fullPath = resolve(process.cwd(), resultsFileRel);
  const raw = await readFile(fullPath, "utf8");
  return JSON.parse(raw) as EvalRunResult;
}

async function loadConfig(path: string): Promise<RegressionConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(
      `cannot read regression config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = RegressionConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`${path} failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

function judgementsByCase(
  judgements: ReadonlyArray<Judgement>,
  system: SystemName,
): Map<string, Judgement> {
  const out = new Map<string, Judgement>();
  for (const j of judgements) {
    if (j.system === system) out.set(j.caseId, j);
  }
  return out;
}

function checkSystem(
  system: SystemName,
  base: EvalRunResult,
  head: EvalRunResult,
  config: RegressionConfig,
): Violation[] {
  const violations: Violation[] = [];
  const baseAgg = base.aggregate[system];
  const headAgg = head.aggregate[system];

  const corrDrop = baseAgg.correctnessPct - headAgg.correctnessPct;
  if (corrDrop > config.maxCorrectnessDropPct) {
    violations.push({
      system,
      kind: "correctness-drop",
      message:
        `correctness dropped ${corrDrop.toFixed(1)}pp ` +
        `(${baseAgg.correctnessPct.toFixed(1)}% → ${headAgg.correctnessPct.toFixed(1)}%, ` +
        `threshold: ${config.maxCorrectnessDropPct.toFixed(1)}pp)`,
    });
  }

  const groundDrop = baseAgg.groundednessPct - headAgg.groundednessPct;
  if (groundDrop > config.maxGroundednessDropPct) {
    violations.push({
      system,
      kind: "groundedness-drop",
      message:
        `groundedness dropped ${groundDrop.toFixed(1)}pp ` +
        `(${baseAgg.groundednessPct.toFixed(1)}% → ${headAgg.groundednessPct.toFixed(1)}%, ` +
        `threshold: ${config.maxGroundednessDropPct.toFixed(1)}pp)`,
    });
  }

  if (baseAgg.adversarialPct !== undefined && headAgg.adversarialPct !== undefined) {
    const advDrop = baseAgg.adversarialPct - headAgg.adversarialPct;
    if (advDrop > config.maxAdversarialDropPct) {
      violations.push({
        system,
        kind: "adversarial-drop",
        message:
          `adversarial pass-rate dropped ${advDrop.toFixed(1)}pp ` +
          `(${baseAgg.adversarialPct.toFixed(1)}% → ${headAgg.adversarialPct.toFixed(1)}%, ` +
          `threshold: ${config.maxAdversarialDropPct.toFixed(1)}pp)`,
      });
    }
  }

  if (baseAgg.multihopPct !== undefined && headAgg.multihopPct !== undefined) {
    const mhDrop = baseAgg.multihopPct - headAgg.multihopPct;
    if (mhDrop > config.maxMultihopDropPct) {
      violations.push({
        system,
        kind: "multihop-drop",
        message:
          `multi-hop pass-rate dropped ${mhDrop.toFixed(1)}pp ` +
          `(${baseAgg.multihopPct.toFixed(1)}% → ${headAgg.multihopPct.toFixed(1)}%, ` +
          `threshold: ${config.maxMultihopDropPct.toFixed(1)}pp)`,
      });
    }
  }

  if (baseAgg.totalCostUsd > 0) {
    const ratio = headAgg.totalCostUsd / baseAgg.totalCostUsd;
    if (ratio > config.maxCostIncreaseRatio) {
      violations.push({
        system,
        kind: "cost-increase",
        message:
          `total cost ratio ${ratio.toFixed(2)}× ` +
          `($${baseAgg.totalCostUsd.toFixed(4)} → $${headAgg.totalCostUsd.toFixed(4)}, ` +
          `threshold: ${config.maxCostIncreaseRatio.toFixed(2)}×)`,
      });
    }
  }

  if (config.failOnNewPassToFail) {
    const baseIdx = judgementsByCase(base.judgements, system);
    const headIdx = judgementsByCase(head.judgements, system);
    for (const caseId of [...baseIdx.keys()].sort()) {
      const b = baseIdx.get(caseId);
      const h = headIdx.get(caseId);
      if (b === undefined || h === undefined) continue;
      if (b.correct && !h.correct) {
        violations.push({
          system,
          kind: "case-regression",
          message: `case ${caseId}: correct pass→fail`,
        });
      }
    }
  }

  return violations;
}

function shortDate(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

function shortId(uuid: string): string {
  return uuid.split("-")[0] ?? uuid.slice(0, 8);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const indexPath = resolve(process.cwd(), INDEX_RELATIVE_PATH);
  const configPath = resolve(process.cwd(), CONFIG_RELATIVE_PATH);

  const entries = await readIndex(indexPath);
  if (entries.length < 2) {
    console.error(`[eval:check] need at least 2 runs in ${indexPath}; have ${entries.length}.`);
    process.exit(1);
  }
  const config = await loadConfig(configPath);
  const { base, head } = pickPair(entries, args);

  if (base.datasetHash !== head.datasetHash) {
    console.error(
      `[eval:check] base and head ran on different datasets (${base.datasetHash} vs ${head.datasetHash}).`,
    );
    console.error(
      `[eval:check] regression check requires matching datasets — refusing to compare apples to oranges.`,
    );
    process.exit(1);
  }

  const baseResult = await loadResult(base.resultsFile);
  const headResult = await loadResult(head.resultsFile);

  console.log("Regression check");
  console.log(
    `  base: runId=${shortId(base.runId)} finished=${shortDate(base.finishedAt)} dataset=${base.datasetPath}#${base.datasetHash}`,
  );
  console.log(
    `  head: runId=${shortId(head.runId)} finished=${shortDate(head.finishedAt)} dataset=${head.datasetPath}#${head.datasetHash}`,
  );
  console.log(
    `  config: ${configPath}`,
  );
  console.log(
    `  thresholds: maxCorrectnessDropPct=${config.maxCorrectnessDropPct}, ` +
      `maxGroundednessDropPct=${config.maxGroundednessDropPct}, ` +
      `maxAdversarialDropPct=${config.maxAdversarialDropPct}, ` +
      `maxMultihopDropPct=${config.maxMultihopDropPct}, ` +
      `maxCostIncreaseRatio=${config.maxCostIncreaseRatio}, ` +
      `failOnNewPassToFail=${config.failOnNewPassToFail}`,
  );
  console.log(`  checkedSystems: [${config.checkedSystems.join(", ")}]`);

  if (config.checkedSystems.length === 0) {
    console.log("\nNo systems configured to gate. Treating as OK.");
    process.exit(0);
  }

  const allViolations: Violation[] = [];
  for (const system of config.checkedSystems) {
    allViolations.push(...checkSystem(system, baseResult, headResult, config));
  }

  if (allViolations.length === 0) {
    console.log("\nSummary: OK (no violations)");
    process.exit(0);
  }

  console.log(`\nViolations (${allViolations.length}):`);
  for (const v of allViolations) {
    console.log(`  [${v.system}] ${v.kind}: ${v.message}`);
  }
  console.log(`\nSummary: FAIL (${allViolations.length} violation${allViolations.length === 1 ? "" : "s"})`);
  process.exit(1);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`eval:check failed: ${message}`);
  process.exit(1);
});
