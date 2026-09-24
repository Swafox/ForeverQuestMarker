import type { SqlDatabase } from "./db";
import type { PromotionConfig } from "./promotion";

export interface Env {
  DB: SqlDatabase;
  ADMIN_TOKEN?: string;
  IP_HASH_SALT?: string;
  PROMOTION_MIN_CLIENTS?: string | number;
  PROMOTION_MIN_IPS?: string | number;
  RATE_LIMIT_IP_PER_HOUR?: string | number;
  RATE_LIMIT_CLIENT_PER_HOUR?: string | number;
}

export interface RateLimitConfig {
  windowSeconds: number;
  ipPerWindow: number;
  clientPerWindow: number;
}

export interface Config {
  promotion: PromotionConfig;
  rateLimit: RateLimitConfig;
  maxBodyBytes: number;
}

/** 5000 records with every optional field are about 1.7 MB. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Secrets shorter than this are treated as not configured. */
export const MIN_SECRET_LENGTH = 16;

function positiveInteger(
  name: string,
  value: string | number | undefined,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

export function readConfig(env: Env): Config {
  return {
    promotion: {
      minClients: positiveInteger(
        "PROMOTION_MIN_CLIENTS",
        env.PROMOTION_MIN_CLIENTS,
        3,
      ),
      minNetworks: positiveInteger(
        "PROMOTION_MIN_IPS",
        env.PROMOTION_MIN_IPS,
        2,
      ),
    },
    rateLimit: {
      windowSeconds: 3600,
      ipPerWindow: positiveInteger(
        "RATE_LIMIT_IP_PER_HOUR",
        env.RATE_LIMIT_IP_PER_HOUR,
        20,
      ),
      clientPerWindow: positiveInteger(
        "RATE_LIMIT_CLIENT_PER_HOUR",
        env.RATE_LIMIT_CLIENT_PER_HOUR,
        20,
      ),
    },
    maxBodyBytes: MAX_BODY_BYTES,
  };
}

export function configuredSecret(value: string | undefined): string | null {
  return value !== undefined && value.length >= MIN_SECRET_LENGTH
    ? value
    : null;
}
