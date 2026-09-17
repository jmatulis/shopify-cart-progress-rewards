// Shared between the admin UI (browser) and the server.
// The same JSON shape is stored in the AppInstallation metafield and read by
// the theme app extension, so treat changes here as a data migration.

export const METAFIELD_NAMESPACE = "cart_rewards";
export const METAFIELD_KEY = "config";
export const MAX_TIERS = 5;

export interface RewardTier {
  id: string;
  /** Cart subtotal (in the shop's currency) needed to unlock this tier. */
  threshold: number;
  /** Short name of the reward, e.g. "Free shipping". */
  label: string;
}

export interface RewardsConfig {
  enabled: boolean;
  tiers: RewardTier[];
  messages: {
    /** Supports {amount} (money left) and {reward} (next tier label). */
    inProgress: string;
    complete: string;
    empty: string;
  };
  style: {
    barColor: string;
    trackColor: string;
    textColor: string;
  };
}

export const DEFAULT_CONFIG: RewardsConfig = {
  enabled: true,
  tiers: [
    { id: "tier-1", threshold: 50, label: "Free shipping" },
    { id: "tier-2", threshold: 100, label: "10% off" },
  ],
  messages: {
    inProgress: "You're {amount} away from {reward}!",
    complete: "You've unlocked every reward 🎉",
    empty: "Spend {amount} to unlock {reward}",
  },
  style: {
    barColor: "#2C6ECB",
    trackColor: "#E3E3E3",
    textColor: "#303030",
  },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type ValidationErrors = Record<string, string>;

/**
 * Normalizes untrusted input (a form post or a stored metafield) into a
 * RewardsConfig. Returns field-keyed errors so the UI can show them inline.
 */
export function validateConfig(input: unknown): {
  config: RewardsConfig;
  errors: ValidationErrors;
} {
  const errors: ValidationErrors = {};
  const raw = (input ?? {}) as Partial<RewardsConfig>;

  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : [])
    .slice(0, MAX_TIERS)
    .map((tier, index) => {
      const threshold = Number(tier?.threshold);
      const label = String(tier?.label ?? "").trim();
      if (!Number.isFinite(threshold) || threshold <= 0) {
        errors[`tiers.${index}.threshold`] = "Enter an amount greater than 0";
      }
      if (!label) {
        errors[`tiers.${index}.label`] = "Enter a reward name";
      }
      return {
        id: String(tier?.id || `tier-${index + 1}`),
        threshold: Math.round(threshold * 100) / 100,
        label: label.slice(0, 60),
      };
    });

  if (tiers.length === 0) {
    errors.tiers = "Add at least one reward tier";
  }
  const thresholds = tiers.map((tier) => tier.threshold);
  if (new Set(thresholds).size !== thresholds.length) {
    errors.tiers = "Each tier needs a different amount";
  }
  tiers.sort((a, b) => a.threshold - b.threshold);

  const text = (value: unknown, fallback: string) =>
    String(value ?? fallback).slice(0, 200);
  const messages = {
    inProgress: text(
      raw.messages?.inProgress,
      DEFAULT_CONFIG.messages.inProgress,
    ),
    complete: text(raw.messages?.complete, DEFAULT_CONFIG.messages.complete),
    empty: text(raw.messages?.empty, DEFAULT_CONFIG.messages.empty),
  };

  const color = (field: keyof RewardsConfig["style"]) => {
    const value = String(raw.style?.[field] ?? DEFAULT_CONFIG.style[field]);
    if (!HEX_COLOR.test(value)) {
      errors[`style.${field}`] = "Use a hex color like #2C6ECB";
    }
    return value;
  };
  const style = {
    barColor: color("barColor"),
    trackColor: color("trackColor"),
    textColor: color("textColor"),
  };

  return {
    config: { enabled: raw.enabled !== false, tiers, messages, style },
    errors,
  };
}
