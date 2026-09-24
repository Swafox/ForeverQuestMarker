import { generatedClassifier, type Classifier } from "./classify";
import { hashNetwork, timingSafeEqual } from "./crypto";
import { configuredSecret, readConfig, type Config, type Env } from "./env";
import {
  json,
  mediaType,
  NO_STORE,
  problem,
  PUBLIC_CACHE,
  readBody,
  text,
  withHeaders,
} from "./http";
import { PAGE_CSP, PAGE_HTML, PAGE_SCRIPT } from "./page";
import { CANDIDATE_STATUSES, type CandidateStatus } from "./promotion";
import { decideRateLimit, windowStart } from "./rateLimit";
import { Repository } from "./repository";
import { parseReviewRequest } from "./review";
import { Router } from "./router";
import {
  BusyError,
  ingestSubmission,
  ReviewError,
  reviewQuest,
  type ServiceContext,
} from "./service";
import { parseExport } from "./validate";
import {
  auditView,
  candidateView,
  classicObservationsPayload,
  confirmedPayload,
  isoTime,
  statsPayload,
} from "./views";

export interface AppOptions {
  classifier?: Classifier;
  /** Unix seconds. */
  now?: () => number;
  newId?: () => string;
}

export interface WorkerApp {
  fetch(request: Request, env: Env): Promise<Response>;
}

interface Context extends ServiceContext {
  env: Env;
  url: URL;
}

/** Endpoints any origin may call; admin endpoints get no CORS headers at all. */
const CORS_PATHS = new Set(["/api/submit", "/api/confirmed", "/api/stats"]);
const PUBLIC_MEMO_SECONDS = 60;
const MAX_REVIEW_BYTES = 16 * 1024;

/** Per-isolate cache of public payloads; cleared by every write in this isolate. */
class Memo {
  private readonly entries = new Map<
    string,
    { expires: number; value: unknown }
  >();

  constructor(private readonly now: () => number) {}

  async get<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expires > this.now()) return entry.value as T;
    const value = await produce();
    this.entries.set(key, { expires: this.now() + PUBLIC_MEMO_SECONDS, value });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function intParam(
  url: URL,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

async function rateLimited(
  context: Context,
  bucket: string,
  limit: number,
): Promise<Response | null> {
  const { windowSeconds } = context.config.rateLimit;
  const now = context.now();
  const counts = await context.repo.countAttempt(
    bucket,
    windowStart(now, windowSeconds),
    windowSeconds,
  );
  const decision = decideRateLimit({ ...counts, now, windowSeconds, limit });
  if (decision.allowed) return null;
  const minutes = Math.max(1, Math.ceil(decision.retryAfter / 60));
  return problem(
    429,
    "rate_limited",
    `Too many submissions. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    { retryAfter: decision.retryAfter },
    { "Retry-After": String(decision.retryAfter) },
  );
}

async function unauthorized(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const token = configuredSecret(env.ADMIN_TOKEN);
  if (!token)
    return problem(
      503,
      "admin_disabled",
      "Admin endpoints are disabled: ADMIN_TOKEN is not set.",
    );
  const match = /^Bearer\s+(\S+)\s*$/i.exec(
    request.headers.get("Authorization") ?? "",
  );
  if (match && (await timingSafeEqual(match[1]!, token))) return null;
  return problem(
    401,
    "unauthorized",
    "A valid admin bearer token is required.",
    {},
    {
      "WWW-Authenticate": 'Bearer realm="admin"',
    },
  );
}

function admin(
  handler: (request: Request, context: Context) => Promise<Response>,
) {
  return async (request: Request, context: Context): Promise<Response> =>
    (await unauthorized(request, context.env)) ?? handler(request, context);
}

export function createApp(options: AppOptions = {}): WorkerApp {
  const classifier = options.classifier ?? generatedClassifier();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const newId = options.newId ?? (() => crypto.randomUUID());
  const memo = new Memo(now);
  const router = new Router<Context>();

  router.get("/", () =>
    text(PAGE_HTML, "text/html; charset=utf-8", {
      ...PUBLIC_CACHE,
      "Content-Security-Policy": PAGE_CSP,
      "X-Frame-Options": "DENY",
    }),
  );

  router.get("/app.js", () =>
    text(PAGE_SCRIPT, "text/javascript; charset=utf-8", PUBLIC_CACHE),
  );

  router.post("/api/submit", async (request, context) => {
    const salt = configuredSecret(context.env.IP_HASH_SALT);
    if (!salt)
      return problem(
        503,
        "not_configured",
        "Submissions are disabled: IP_HASH_SALT is not set.",
      );
    const type = mediaType(request);
    if (type !== "application/json" && type !== "text/plain") {
      return problem(
        415,
        "unsupported_media_type",
        "Send the export as application/json or text/plain.",
      );
    }

    const ipHash = await hashNetwork(clientIp(request), salt);
    const limitedByIp = await rateLimited(
      context,
      `ip:${ipHash}`,
      context.config.rateLimit.ipPerWindow,
    );
    if (limitedByIp) return limitedByIp;

    const body = await readBody(request, context.config.maxBodyBytes);
    if (!body.ok) {
      return body.reason === "too_large"
        ? problem(
            413,
            "too_large",
            `The export must be at most ${context.config.maxBodyBytes} bytes.`,
          )
        : problem(400, "invalid_encoding", "The export must be UTF-8 text.");
    }

    const parsed = parseExport(body.text, context.now());
    if (!parsed.ok) {
      return problem(
        400,
        "invalid_submission",
        "The export is not valid; nothing was saved.",
        {
          errors: parsed.errors,
          truncated: parsed.truncated,
        },
      );
    }

    const { document } = parsed;
    const limitedByClient = await rateLimited(
      context,
      `client:${document.clientId}`,
      context.config.rateLimit.clientPerWindow,
    );
    if (limitedByClient) return limitedByClient;

    const result = await ingestSubmission(
      context,
      document,
      ipHash,
      body.bytes,
    );
    memo.clear();
    return json({ ok: true, ...result }, 200, NO_STORE);
  });

  router.get("/api/confirmed", async (_request, context) => {
    const payload = await memo.get("confirmed", async () => {
      const [confirmed, known] = await Promise.all([
        context.repo.questsByStatus("confirmed", 100_000),
        context.repo.questsByIds(context.classifier.knownIds),
      ]);
      return confirmedPayload(
        confirmed,
        known,
        context.classifier,
        context.config.promotion,
        context.now(),
      );
    });
    return json(payload, 200, PUBLIC_CACHE);
  });

  router.get("/api/stats", async (_request, context) => {
    const payload = await memo.get("stats", async () =>
      statsPayload(
        await context.repo.stats(),
        context.config.promotion,
        context.now(),
      ),
    );
    return json(payload, 200, PUBLIC_CACHE);
  });

  router.get(
    "/api/admin/candidates",
    admin(async (_request, context) => {
      const status = context.url.searchParams.get("status") ?? "pending";
      if (!(CANDIDATE_STATUSES as readonly string[]).includes(status)) {
        return problem(
          400,
          "invalid_status",
          `status must be one of ${CANDIDATE_STATUSES.join(", ")}.`,
        );
      }
      const limit = intParam(context.url, "limit", 1000, 1, 10_000);
      if (limit === null)
        return problem(
          400,
          "invalid_limit",
          "limit must be an integer from 1 to 10000.",
        );
      const rows = await context.repo.questsByStatus(
        status as CandidateStatus,
        limit,
      );
      const candidates = rows.map((row) =>
        candidateView(row, context.classifier),
      );
      return json(
        { status, count: candidates.length, candidates },
        200,
        NO_STORE,
      );
    }),
  );

  router.post(
    "/api/admin/review",
    admin(async (request, context) => {
      const body = await readBody(request, MAX_REVIEW_BYTES);
      let value: unknown = null;
      try {
        value = body.ok ? JSON.parse(body.text) : null;
      } catch {
        // Reported as a validation error below.
      }
      const parsed = parseReviewRequest(value);
      if (!parsed.ok) {
        return problem(
          400,
          "invalid_review",
          "The review request is not valid.",
          { errors: parsed.errors },
        );
      }
      try {
        const { quest, audit } = await reviewQuest(context, parsed.request);
        memo.clear();
        return json(
          {
            ok: true,
            quest: candidateView(quest, context.classifier),
            audit: audit.map((entry) => ({ ...entry, at: isoTime(entry.at) })),
          },
          200,
          NO_STORE,
        );
      } catch (error) {
        if (error instanceof ReviewError)
          return problem(error.status, "review_failed", error.message);
        throw error;
      }
    }),
  );

  router.get(
    "/api/admin/classic-observations",
    admin(async (_request, context) => {
      const rows = await context.repo.questsByIds(
        context.classifier.classicIds,
      );
      return json(
        classicObservationsPayload(rows, context.classifier, context.now()),
        200,
        NO_STORE,
      );
    }),
  );

  router.get(
    "/api/admin/audit",
    admin(async (_request, context) => {
      const quest = intParam(context.url, "quest", 0, 1, 1_000_000);
      const limit = intParam(context.url, "limit", 200, 1, 5000);
      if (quest === null || limit === null) {
        return problem(
          400,
          "invalid_query",
          "quest must be a quest ID and limit an integer from 1 to 5000.",
        );
      }
      const entries = await context.repo.auditLog(
        quest === 0 ? null : quest,
        limit,
      );
      return json(
        { count: entries.length, entries: entries.map(auditView) },
        200,
        NO_STORE,
      );
    }),
  );

  async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = CORS_PATHS.has(url.pathname);
    if (request.method === "OPTIONS" && cors) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": [
            ...router.methods(url.pathname),
            "OPTIONS",
          ].join(", "),
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    let config: Config;
    try {
      config = readConfig(env);
    } catch (error) {
      console.error("invalid configuration", error);
      return problem(500, "misconfigured", "The server is misconfigured.");
    }
    const context: Context = {
      env,
      url,
      config,
      classifier,
      now,
      newId,
      repo: new Repository(env.DB),
    };
    const response = await router.handle(request, context);
    return cors
      ? withHeaders(response, { "Access-Control-Allow-Origin": "*" })
      : response;
  }

  return {
    async fetch(request, env) {
      try {
        return await route(request, env);
      } catch (error) {
        if (error instanceof BusyError) {
          return problem(
            503,
            "busy",
            "The server is busy. Try again in a few seconds.",
            {},
            { "Retry-After": "5" },
          );
        }
        console.error("unhandled error", error);
        return problem(
          500,
          "internal_error",
          "Something went wrong on the server.",
        );
      }
    },
  };
}
