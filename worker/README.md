# Community submission Worker

Cloudflare Worker + D1 database that receives `/fqm export` documents, validates them, aggregates
independent reports and promotes quests that several players confirm as new in WoW Forever. The
design, rules and review workflow are in [docs/PIPELINE.md](../docs/PIPELINE.md); this file covers
running, deploying and calling it.

## Layout

| Path                                         | Contents                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                               | Workers entry point.                                                                                                                                   |
| `src/app.ts`, `src/router.ts`, `src/http.ts` | Routes, CORS, auth, rate limiting, responses.                                                                                                          |
| `src/validate.ts`                            | Strict validation of the export ([docs/EXPORT_FORMAT.md](../docs/EXPORT_FORMAT.md)).                                                                   |
| `src/classify.ts`                            | Classic / known / SoD / Era / candidate classification from `src/generated/questData.ts`.                                                              |
| `src/consensus.ts`, `src/summary.ts`         | Title normalization, two-thirds agreement, per-quest summaries.                                                                                        |
| `src/promotion.ts`, `src/review.ts`          | Automatic status decisions and manual review.                                                                                                          |
| `src/ingest.ts`                              | Pure planning of a submission: observation diff, vote deltas, status changes.                                                                          |
| `src/repository.ts`, `src/db.ts`             | The only D1 access; `db.ts` is the D1 subset it relies on.                                                                                             |
| `src/service.ts`                             | Read, plan, commit loops with retry on write conflicts.                                                                                                |
| `src/rateLimit.ts`, `src/crypto.ts`          | Sliding-window limits; keyed IP hashing; constant-time token check.                                                                                    |
| `src/page.ts`, `src/views.ts`                | The paste page and the JSON shapes of the read endpoints.                                                                                              |
| `migrations/`                                | D1 schema, applied with `wrangler d1 migrations apply`.                                                                                                |
| `test/`                                      | `bun test` suites. `sqlite.ts` runs the repository on bun:sqlite with the real migration; `d1-local.test.ts` runs the app against wrangler's local D1. |

Everything except `index.ts`, `db.ts` and `repository.ts` is plain TypeScript without Cloudflare
types. `src/generated/questData.ts` is written by `bun tools/generate-data.ts`; never edit it.

## Local development

Requires Bun. Nothing here needs a Cloudflare account.

```sh
cd worker
bun install
cp .dev.vars.example .dev.vars     # local ADMIN_TOKEN and IP_HASH_SALT
bun run migrate:local              # wrangler d1 migrations apply forever-quest-marker --local
bun run dev                        # wrangler dev on http://localhost:8787
```

Open http://localhost:8787 for the paste page, or submit from the shell:

```sh
curl -X POST http://localhost:8787/api/submit -H 'Content-Type: application/json' --data-binary @export.json
curl -H "Authorization: Bearer $(grep ADMIN_TOKEN .dev.vars | cut -d= -f2)" \
  'http://localhost:8787/api/admin/candidates?status=pending'
```

Local D1 state lives in `worker/.wrangler/` (gitignored); delete it to start over.

Checks (CI runs the same in `.github/workflows/worker.yml`):

```sh
bun run typecheck   # src against @cloudflare/workers-types, tests against bun types
bun test            # unit tests, bun:sqlite repository tests, local D1 end-to-end test
```

## Configuration

| Name                         | Kind       | Default | Meaning                                                                                       |
| ---------------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------- |
| `DB`                         | D1 binding |         | Database `forever-quest-marker`.                                                              |
| `PROMOTION_MIN_CLIENTS`      | var        | `3`     | Distinct installations (client IDs) before a candidate is decided.                            |
| `PROMOTION_MIN_IPS`          | var        | `2`     | Distinct networks (hashed IPv4 address or IPv6 /64) before a candidate is decided.            |
| `RATE_LIMIT_IP_PER_HOUR`     | var        | `20`    | Submission attempts per network per sliding hour, invalid ones included.                      |
| `RATE_LIMIT_CLIENT_PER_HOUR` | var        | `20`    | Valid submissions per installation per sliding hour.                                          |
| `ADMIN_TOKEN`                | secret     |         | Bearer token for `/api/admin/*`. Admin endpoints answer 503 until it is set (16+ characters). |
| `IP_HASH_SALT`               | secret     |         | Key for hashing client networks. Submissions answer 503 until it is set (16+ characters).     |

Vars live in `wrangler.toml`; an invalid value makes every request fail with 500 rather than
silently falling back. Generate secrets with `openssl rand -hex 32`. Do not rotate `IP_HASH_SALT`
casually: reports made after a rotation hash to different network IDs, so one network could count
twice for quests it already reported.

## Deployment

Done once by the maintainer; later deployments go through the workflow.

1. `bunx wrangler login` (or export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).
2. `bunx wrangler d1 create forever-quest-marker` and put the printed `database_id` into
   `wrangler.toml` in place of the all-zero placeholder. Commit it; the ID is not a secret.
3. Set the secrets: `bunx wrangler secret put ADMIN_TOKEN`, then `bunx wrangler secret put IP_HASH_SALT`.
4. `bun run migrate:remote`, then `bun run deploy`. Wrangler prints the `*.workers.dev` URL; a custom
   domain can be added in the dashboard.
5. GitHub, for the workflows:
   - Repository secrets `CLOUDFLARE_API_TOKEN` (API token with Workers Scripts: Edit and D1: Edit on
     the account) and `CLOUDFLARE_ACCOUNT_ID`, used by the `production` environment of
     `worker.yml`. Run the workflow manually to test, migrate and deploy.
   - Repository secrets `FQM_WORKER_URL` (the Worker URL) and `FQM_ADMIN_TOKEN` (same value as
     `ADMIN_TOKEN`) for `merge-submissions.yml`.
   - Settings, Actions, General: allow GitHub Actions to create pull requests.

Plan limits: an export of a few hundred quests costs about 3 ms of CPU and about 20 D1 queries, which
fits Workers Free (10 ms CPU, 50 D1 queries per request). A first export of several thousand quests
takes around 45 ms of CPU and needs Workers Paid. D1 Free (5 million rows read and 100,000 rows written
per day) is enough to start; resubmissions that change nothing write only the submission row.

## API

All responses are JSON unless noted. Errors look like
`{ "ok": false, "error": "<code>", "message": "<text>" }`, plus extra fields where listed.

### `GET /`

The paste page (HTML, script at `/app.js`). No external assets; strict Content-Security-Policy.

### `POST /api/submit`

Body: the export document as `application/json` or `text/plain`, at most 2 MiB. CORS open to any
origin, without credentials.

| Status | Meaning                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Stored. `{ ok, submissionId, received, inserted, updated, unchanged, categories: { candidate, known, classic, sod, era }, confirmed: [ids], flagged: [ids] }` |
| 400    | `invalid_submission` with `errors: [{ path, message }]` (at most 100, `truncated` when more) or `invalid_encoding`. Nothing is stored.                        |
| 413    | Body over 2 MiB.                                                                                                                                              |
| 415    | Other content type.                                                                                                                                           |
| 429    | `rate_limited` with `retryAfter` seconds and a `Retry-After` header.                                                                                          |
| 503    | `not_configured` (no `IP_HASH_SALT`) or `busy` (retry shortly).                                                                                               |

### `GET /api/confirmed`

Public, cached for 5 minutes.

```json
{
  "generatedAt": "2026-09-23T12:00:00.000Z",
  "meta": {
    "questieDB": "Questie/QuestieDB@3a1dc8886f85",
    "foreverBuild": "1.60.1.69977",
    "eraBuild": "1.15.9.69722"
  },
  "thresholds": { "minClients": 3, "minIps": 2 },
  "confirmed": [
    {
      "id": 120001,
      "titles": { "enUS": { "title": "Into the Ruins", "reports": 3 } },
      "reporters": 3,
      "firstReported": "2026-09-20T10:00:00.000Z",
      "lastReported": "2026-09-22T18:30:00.000Z",
      "level": 17,
      "giver": { "type": "npc", "id": 12345, "name": "Guard Name" },
      "map": 1436,
      "confirmedBy": "auto"
    }
  ],
  "known": []
}
```

`confirmed` holds candidates confirmed by reports (`confirmedBy` is `auto` or `admin`). `known` holds
datamined or community-listed quests that players have reported, with the same fields plus
`"source": "datamined" | "community"` instead of `confirmedBy`.
`lastReported` is the last time a report added or changed information about the quest.

### `GET /api/stats`

Public, cached for 5 minutes: `{ generatedAt, meta, thresholds, candidates: { pending, confirmed,
flagged, rejected }, observedQuests: { candidate, known, classic, sod, era }, submissions, reporters,
lastSubmissionAt }`.

### Admin endpoints

Require `Authorization: Bearer <ADMIN_TOKEN>`; no CORS. 401 for a missing or wrong token.

- `GET /api/admin/candidates?status=pending|flagged|confirmed|rejected&limit=1000`: candidates with
  `status`, `statusSource`, `statusReason`, `reporters`, `networks` and the full per-locale `summary`,
  most reported first.
- `POST /api/admin/review` with `{ "id": 120001, "status": "confirmed" | "rejected" | "pending",
"note": "why", "reviewer": "optional-name" }`. Returns the updated candidate and the audit entries
  written. `pending` hands the quest back to automatic evaluation, which runs immediately. 404 when
  nobody reported the quest, 409 when it is not a candidate (for example an original Classic quest).
- `GET /api/admin/classic-observations`: per original Classic quest, the observed title and level per
  locale with report counts, for change detection.
- `GET /api/admin/audit?quest=<id>&limit=200`: newest audit entries first, for one quest or all.
