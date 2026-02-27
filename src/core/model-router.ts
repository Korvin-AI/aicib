/**
 * Central model catalog and name resolution.
 *
 * Maps short names ("opus") to full model IDs ("claude-opus-4-6"),
 * provides pricing tiers, and validates model names from user config.
 */

export interface ModelEntry {
  /** Short name used in config and the SDK (e.g. "opus"). */
  shortName: string;
  /** Full Anthropic model ID (e.g. "claude-opus-4-6"). */
  fullModelId: string;
  /** Pricing tier — used for cost grouping and fallback pricing. */
  tier: "opus" | "sonnet" | "haiku";
  /** Fallback pricing per million tokens (used when SDK doesn't report costUSD). */
  fallbackPricing: { input: number; output: number };
}

/**
 * Known model catalog. Add new models here when Anthropic releases them.
 */
const MODEL_CATALOG: ModelEntry[] = [
  {
    shortName: "opus",
    fullModelId: "claude-opus-4-6",
    tier: "opus",
    fallbackPricing: { input: 5.0, output: 25.0 },
  },
  {
    shortName: "sonnet",
    fullModelId: "claude-sonnet-4-6",
    tier: "sonnet",
    fallbackPricing: { input: 3.0, output: 15.0 },
  },
  {
    shortName: "haiku",
    fullModelId: "claude-haiku-4-5-20251001",
    tier: "haiku",
    fallbackPricing: { input: 1.0, output: 5.0 },
  },
];

// Lookup maps built once at import time
const byShortName = new Map<string, ModelEntry>(
  MODEL_CATALOG.map((m) => [m.shortName, m])
);
const byFullId = new Map<string, ModelEntry>(
  MODEL_CATALOG.map((m) => [m.fullModelId, m])
);

/**
 * Resolve any accepted model name to a full model ID.
 *
 * - "opus"            → "claude-opus-4-6"
 * - "claude-opus-4-6" → "claude-opus-4-6" (pass-through)
 * - "claude-custom-x" → "claude-custom-x" (unknown but valid prefix)
 */
export function resolveModelId(name: string): string {
  // Short name lookup
  const entry = byShortName.get(name);
  if (entry) return entry.fullModelId;

  // Already a full ID (known or unknown)
  return name;
}

/**
 * Convert a full model ID back to the SDK's short name.
 * Required because SDK sub-agent definitions only accept 'opus'|'sonnet'|'haiku'|'inherit'.
 *
 * Returns the short name if found, otherwise "sonnet" as a safe fallback.
 */
export function toSDKShortName(
  modelIdOrShortName: string
): "opus" | "sonnet" | "haiku" {
  // Already a short name
  if (byShortName.has(modelIdOrShortName)) {
    return modelIdOrShortName as "opus" | "sonnet" | "haiku";
  }

  // Full ID → short name
  const entry = byFullId.get(modelIdOrShortName);
  if (entry) return entry.shortName as "opus" | "sonnet" | "haiku";

  // Heuristic for unknown full IDs (e.g. "claude-opus-4-7").
  // Uses prefix matching to avoid false positives on hypothetical compound names.
  if (modelIdOrShortName.startsWith("claude-opus")) return "opus";
  if (modelIdOrShortName.startsWith("claude-haiku")) return "haiku";

  // Default fallback — unknown model maps to sonnet tier
  console.warn(`Unknown model "${modelIdOrShortName}" — falling back to sonnet tier`);
  return "sonnet";
}

/**
 * Get the pricing tier for a model ID.
 * Used by cost tracking to group/label costs.
 */
export function getModelTier(
  modelIdOrShortName: string
): "opus" | "sonnet" | "haiku" {
  const entry =
    byShortName.get(modelIdOrShortName) ||
    byFullId.get(modelIdOrShortName);
  if (entry) return entry.tier;

  // Heuristic fallback — prefix matching avoids false positives
  if (modelIdOrShortName.startsWith("claude-opus")) return "opus";
  if (modelIdOrShortName.startsWith("claude-haiku")) return "haiku";
  return "sonnet";
}

/**
 * Get fallback pricing for a model (per million tokens).
 * Used when SDK's costUSD is 0 or unavailable.
 */
export function getFallbackPricing(
  modelIdOrShortName: string
): { input: number; output: number } {
  const entry =
    byShortName.get(modelIdOrShortName) ||
    byFullId.get(modelIdOrShortName);
  if (entry) return entry.fallbackPricing;

  // Tier-based fallback for unknown models
  const tier = getModelTier(modelIdOrShortName);
  const tierEntry = MODEL_CATALOG.find((m) => m.tier === tier);
  return tierEntry?.fallbackPricing ?? { input: 3.0, output: 15.0 };
}

/**
 * Check if a model name is valid for use in AICIB config.
 *
 * Accepts:
 * - Known short names: "opus", "sonnet", "haiku"
 * - Known full IDs: "claude-opus-4-6", etc.
 * - Any string starting with "claude-" (future-proof)
 */
export function isValidModelName(name: string): boolean {
  if (byShortName.has(name)) return true;
  if (byFullId.has(name)) return true;
  if (name.startsWith("claude-")) return true;
  return false;
}

/**
 * List all known short names.
 */
export function supportedShortNames(): string[] {
  return MODEL_CATALOG.map((m) => m.shortName);
}
