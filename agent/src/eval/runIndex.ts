import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { z } from "zod";
import { EVAL_SCHEMA_VERSION, type RunIndexEntry } from "./types.js";

/**
 * Default location of the committed run index, relative to `agent/`.
 * The full per-run result files live under `eval/results/` and are
 * gitignored; this file is small enough — and free of chunk text — to
 * keep under version control so trends survive across machines.
 */
export const INDEX_RELATIVE_PATH = "eval/index.jsonl";

export function newRunId(): string {
  return randomUUID();
}

/**
 * sha256 of the dataset file's raw bytes, truncated to 16 hex chars.
 * Truncation keeps `eval:list` rows narrow; full collision resistance is
 * not needed — the runId is the unique key.
 */
export async function hashDatasetFile(path: string): Promise<string> {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export interface GitInfo {
  sha: string | null;
  dirty: boolean;
}

/**
 * Best-effort git metadata. Returns `{ sha: null, dirty: false }` if not
 * in a git checkout or git is unavailable — we never fail the eval over
 * missing provenance.
 */
export function readGitInfo(): GitInfo {
  const sha = tryGit(["rev-parse", "HEAD"]);
  if (sha === null) return { sha: null, dirty: false };
  const status = tryGit(["status", "--porcelain"]);
  const dirty = status !== null && status.trim().length > 0;
  return { sha, dirty };
}

function tryGit(args: ReadonlyArray<string>): string | null {
  try {
    const out = execFileSync("git", [...args], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return out.trim();
  } catch {
    return null;
  }
}

const RunIndexEntrySchema = z.object({
  schemaVersion: z.literal(EVAL_SCHEMA_VERSION),
  runId: z.string().min(1),
  finishedAt: z.string().min(1),
  gitSha: z.string().nullable(),
  gitDirty: z.boolean(),
  datasetPath: z.string().min(1),
  datasetHash: z.string().min(1),
  caseCount: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  resultsFile: z.string().min(1),
  baseline: z.object({
    correctnessPct: z.number(),
    groundednessPct: z.number(),
    totalCostUsd: z.number(),
  }),
  agent: z.object({
    correctnessPct: z.number(),
    groundednessPct: z.number(),
    totalCostUsd: z.number(),
  }),
});

export async function appendIndexEntry(
  indexPath: string,
  entry: RunIndexEntry,
): Promise<void> {
  await mkdir(dirname(indexPath), { recursive: true });
  await appendFile(indexPath, JSON.stringify(entry) + "\n", "utf8");
}

/**
 * Read the index file, tolerating absent file, blank lines, and lines
 * with the wrong schemaVersion (warned to stderr, then skipped). Bad
 * JSON on a single line never poisons the whole index.
 */
export async function readIndex(indexPath: string): Promise<RunIndexEntry[]> {
  let raw: string;
  try {
    raw = await readFile(indexPath, "utf8");
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const out: RunIndexEntry[] = [];
  let lineNo = 0;
  for (const line of raw.split(/\r?\n/)) {
    lineNo += 1;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      console.error(`[eval-index] ${indexPath}:${lineNo}: skipping malformed JSON`);
      continue;
    }
    const result = RunIndexEntrySchema.safeParse(parsed);
    if (!result.success) {
      console.error(
        `[eval-index] ${indexPath}:${lineNo}: skipping entry (schema mismatch)`,
      );
      continue;
    }
    out.push(result.data);
  }
  return out;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
