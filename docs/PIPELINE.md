# Community pipeline

How player reports become addon data. The client datamine (`Data/ForeverQuests.lua`, set
`datamined`) already knows every quest the Forever client ships in its QuestV2 table; community
reports catch new quests the datamine cannot see and record original Classic quests that changed.

## Data flow

```
 player        /fqm export  ->  JSON document (docs/EXPORT_FORMAT.md)
   |           copy with Ctrl+A, Ctrl+C
   v
 Worker        GET /  paste page  ->  POST /api/submit
 (worker/)       size, rate limit, strict validation   (reject the whole document on any error)
   |             classify each quest ID                 (classic / known / sod / era / candidate)
   |             upsert one observation per installation and quest, update vote counters
   v
 D1            promotion: pending -> confirmed | flagged; audit_log records every change
   |           GET /api/confirmed (public), /api/admin/* (review, Classic observations)
   v
 weekly CI     tools/merge-submissions.ts   (.github/workflows/merge-submissions.yml)
   |             new confirmed IDs -> dataset/community/confirmed.json (source "pipeline")
   |             Classic observations vs QuestieDB -> .cache/change-candidates.md (not applied)
   |             bun tools/generate-data.ts -> Data/*.lua, test fixtures, worker questData
   v
 pull request  human review and merge  ->  release tag  ->  players get the new data
```

After data changes are merged, redeploy the Worker (`worker.yml`, manual run) so its copy of the ID
sets (`worker/src/generated/questData.ts`) matches; the merge script warns when the deployed Worker
reports a different Forever build than the checkout.

## What is stored

| Table            | Contents                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submissions`    | One row per accepted export: receipt ID, time, client ID, IP hash, addon version, build, locale, counts. Not the body.                                                                        |
| `observations`   | One row per (client ID, quest ID) with the latest title, state, level, giver, map, position, faction, contexts and timestamps. A resubmission updates the row; it never adds a second report. |
| `quest_votes`    | Counters derived from observations: titles, levels and givers per locale, maps. Maintained incrementally, so ingest cost does not grow with the number of reporters.                          |
| `quest_networks` | Reporting installations per quest and network hash.                                                                                                                                           |
| `quests`         | Per-quest aggregate: category, candidate status, reporter and network counts, summary.                                                                                                        |
| `audit_log`      | Append-only history of every candidate status change: who (`auto` or `admin:<name>`), from, to, why, and the submission that caused it. The Worker never updates or deletes these rows.       |
| `rate_limits`    | Hourly attempt counters per network and per installation; old windows are deleted.                                                                                                            |

Privacy: the export has no character, realm, account or GUID data, and the Worker stores nothing
beyond the fields above. The client ID is random per installation. Raw IP addresses are never stored:
the Worker keeps `HMAC-SHA-256(IP_HASH_SALT, network)` truncated to 128 bits, where the network is the
IPv4 address or the IPv6 /64 prefix. The hash is used only for rate limiting and for counting
independent networks. The public endpoints expose aggregates only (titles, counts, most common giver
and map), never client IDs or hashes.

## Validation and anti-poisoning

A submission is rejected as a whole, with a list of `{ path, message }` errors, when any rule fails:

- Body at most 2 MiB (5000 records with every optional field are about 1.7 MB), content type
  `application/json` or `text/plain`, valid UTF-8 and JSON.
- `format` is `ForeverQuestMarker`, `version` is a supported version (1), `clientId` matches
  `^[0-9a-f]{16}$`, `build` matches `^\d+\.\d+\.\d+\.\d+$`, `locale` is a WoW locale, `count` equals
  the number of records (catches truncated copies), 1 to 5000 records, no duplicate quest IDs.
- Every record field has the documented type and range: ID 1 to 1000000, level 1 to 100, map
  positive, `x`/`y` in 0..1 and given together, known state, faction, giver type and contexts.
- Titles and giver names are non-empty after trimming, at most 200 characters, with no control
  characters, no invisible formatting or bidirectional override characters, no invalid Unicode and no
  `|` (WoW escape sequences must already be stripped by the addon).
- Timestamps are not before 2026-01-01 and not more than a day in the future; `firstSeen` is not after
  `lastSeen`.

Unknown extra fields are ignored and never stored. Beyond validation:

- Classification uses the Worker's own ID sets, never the `state` the addon reports. An original
  Classic ID can never become a candidate, however many reports claim it is new; it only feeds change
  detection. SoD and Era IDs are aggregated but never promoted.
- One installation counts once per quest: resubmissions replace its observation, and the network of
  its first report stays attached to it, so moving between networks does not add networks.
- Promotion needs both several installations and several networks, and a two-thirds title majority in
  every locale. Out-of-range IDs and disputed titles go to manual review instead.
- Rate limits: 20 attempts per network and 20 submissions per installation per sliding hour (both
  configurable). Invalid attempts count against the network limit.
- Nothing reaches the addon without a reviewed pull request, and the merge script re-checks every ID
  against the checkout's own Classic, datamined, SoD and Era sets.

## Promotion

Each quest ID not in any local set is a candidate and starts `pending`. After every report that
changes it, automatic evaluation runs:

1. While fewer than `PROMOTION_MIN_CLIENTS` (default 3) distinct client IDs or fewer than
   `PROMOTION_MIN_IPS` (default 2) distinct networks reported it, it stays `pending`.
2. Once both thresholds are met, it becomes `flagged` if its ID is at or below 10000 (cut or unused
   vanilla range) or above 200000, or if any locale's most common title (compared case- and
   whitespace-insensitively) has less than two thirds of that locale's reports. Otherwise it becomes
   `confirmed`.
3. An automatically confirmed quest whose title agreement later drops below two thirds is `flagged`
   again. Quests confirmed by a reviewer, flagged quests and rejected quests only change by review.
4. If a data update moves a candidate into the datamined or community list, `/api/confirmed` lists it
   under `known` as soon as the Worker is redeployed with the new data, and its stored status is
   cleared (with an audit entry) on its next report.

Titles are compared per locale because each locale reports its own translation. The merge script
uses the enUS title, or the title of the locale with the most reports when nobody reported enUS.

## Review workflow

The reviewer holds `ADMIN_TOKEN`. With `W` the Worker URL and `T` the token:

```sh
# What needs a decision
curl -H "Authorization: Bearer $T" "$W/api/admin/candidates?status=flagged"
curl -H "Authorization: Bearer $T" "$W/api/admin/candidates?status=pending"

# Decide (note is required; reviewer is optional and recorded in the audit log)
curl -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"id": 120001, "status": "confirmed", "note": "Seen in Elwynn, new quest chain", "reviewer": "maintainer"}' \
  "$W/api/admin/review"

# History of one quest
curl -H "Authorization: Bearer $T" "$W/api/admin/audit?quest=120001"
```

- `confirmed`: accepted as new; it is added to `confirmed.json` by the next merge.
- `rejected`: never merged, whatever later reports say.
- `pending`: back to automatic evaluation, which runs immediately (a still-disputed quest returns to
  `flagged`).

Removing a quest that was already merged is a manual edit of `dataset/community/confirmed.json`; the
merge script never deletes entries or modifies existing ones.

## Change detection

When players enable "Record Classic quests for change detection", their exports include original
Classic quests. The Worker aggregates the observed title and level per locale
(`GET /api/admin/classic-observations`). With an admin token, the merge script compares them with
QuestieDB's Classic data at the pinned revision and writes `.cache/change-candidates.md`: quests whose
enUS title or level differs, once at least two reports (`--min-reports`) and two thirds of them agree.
The report is attached to the weekly workflow run as the `change-candidates` artifact. Candidates are
never applied automatically; after checking one in game, add it to `dataset/community/changed.json`
with a note and run `bun tools/generate-data.ts`.

## Merge script

```sh
bun tools/merge-submissions.ts --worker "$W" --dry-run          # show what would change
bun tools/merge-submissions.ts --worker "$W" --admin-token "$T" # merge, report, regenerate
```

It adds newly confirmed IDs that are not already in `confirmed.json` or in the local Classic,
datamined, SoD or Era sets, sorted by ID with `source: "pipeline"` and a note such as
`3 independent reports, first 2026-09-20`. When nothing is new it rewrites nothing. It then runs
`bun tools/generate-data.ts`. `--pr` commits to a new branch and opens a pull request with `gh`; it is
meant for CI or deliberate manual use. The weekly workflow instead uses
`peter-evans/create-pull-request` on the branch `chore/community-data`.

## Setup

1. Deploy the Worker: [worker/README.md](../worker/README.md#deployment) (D1 database, secrets,
   migrations, deploy, GitHub secrets).
2. Add repository secrets `FQM_WORKER_URL` and `FQM_ADMIN_TOKEN` and allow GitHub Actions to create
   pull requests; the weekly merge then runs on Mondays (or manually).
3. Point players to the Worker URL (the paste page) in the addon's README and export window.

## Limits and follow-ups

- Workers Free allows 10 ms of CPU per request: fine for exports of a few hundred quests, not for a
  first export of several thousand (use Workers Paid). A maximum-size export uses about 25 of the 50
  D1 queries a Free request may make.
- Thresholds are low on purpose while few people report. Client IDs are free to invent, so the real
  cost of faking a confirmation is several networks; raise `PROMOTION_MIN_CLIENTS` and
  `PROMOTION_MIN_IPS` as participation grows. Review of the weekly pull request remains the last gate.
- Not built yet: purging or blocking one installation's reports, and a bulk re-evaluation after data
  updates (statuses currently refresh on each quest's next report).
