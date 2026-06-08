// Phase 6 — pricing constants for cost accounting.
//
// IMPORTANT: VERIFY THESE NUMBERS BEFORE QUOTING THEM IN AN INTERVIEW OR
// REPORT. Anthropic adjusts prices periodically — the values below are a
// reasonable snapshot but go stale fast. The source of truth is
// https://www.anthropic.com/pricing.
//
// All prices are USD per 1,000,000 tokens.
//
// Caching assumptions (also documented at the link above):
//   - `cache_read_input_tokens` are billed at ~10% of regular input price.
//   - `cache_creation_input_tokens` are billed at ~125% of regular input
//     price (a 25% markup over the base input rate).
// These ratios are encoded as constants so updating them is one-line.

export interface ModelPricing {
  /** Price per 1M regular input tokens (USD). */
  inputPerMTokens: number;
  /** Price per 1M output tokens (USD). */
  outputPerMTokens: number;
}

const PER_M = 1_000_000;

// Cache cost multipliers, expressed relative to base input price.
// See note at top of file — verify against current Anthropic docs.
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_CREATION_MULTIPLIER = 1.25;

// Pricing snapshot — replace with current numbers as needed.
// Opus tier and Haiku tier are the two models the Phase 6 pipeline uses.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": { inputPerMTokens: 15, outputPerMTokens: 75 },
  "claude-haiku-4-5-20251001": { inputPerMTokens: 1, outputPerMTokens: 5 },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPerMTokens: 15,
  outputPerMTokens: 75,
};

export function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/**
 * Compute USD cost from token counts. Cache token costs are derived from
 * `inputPerMTokens` using the multipliers defined above.
 */
export function costFor(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
): number {
  const p = pricingFor(model);
  const inputRate = p.inputPerMTokens / PER_M;
  const outputRate = p.outputPerMTokens / PER_M;
  const cacheReadRate = inputRate * CACHE_READ_MULTIPLIER;
  const cacheCreateRate = inputRate * CACHE_CREATION_MULTIPLIER;

  return (
    inputTokens * inputRate +
    outputTokens * outputRate +
    cacheReadTokens * cacheReadRate +
    cacheCreationTokens * cacheCreateRate
  );
}
