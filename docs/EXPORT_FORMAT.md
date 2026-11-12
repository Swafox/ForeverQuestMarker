# Export format (version 2)

`/fqm export` produces this JSON document. The Cloudflare Worker in `worker/` accepts it
and `tools/merge-submissions.ts` consumes what the Worker aggregates. Any change to the
shape bumps `version`; the Worker must keep accepting every version the addon ever shipped.

The export deliberately carries no character name, realm, GUID, or account data. `clientId`
is a random identifier generated once per WoW account installation of the addon so that the
pipeline can count independent reporters; it cannot be traced back to a player.

## Document

```json
{
  "format": "ForeverQuestMarker",
  "version": 2,
  "addonVersion": "2.0.0",
  "clientId": "3f9c2a7be4d1409a",
  "build": "1.60.1.69977",
  "interface": 16001,
  "locale": "enUS",
  "exportedAt": 1758620000,
  "count": 2,
  "quests": [ ... ]
}
```

| Field          | Type    | Notes                                                                |
| -------------- | ------- | -------------------------------------------------------------------- |
| `format`       | string  | Always `"ForeverQuestMarker"`.                                       |
| `version`      | integer | `2` for this document. The Worker also accepts `1` (see below).      |
| `addonVersion` | string  | Addon version, `"dev"` when running from a git checkout.             |
| `clientId`     | string  | 16 lowercase hex characters, random, stable per installation.        |
| `build`        | string  | Client build from `GetBuildInfo()`, `major.minor.patch.build`.       |
| `interface`    | integer | TOC interface number from `GetBuildInfo()`.                          |
| `locale`       | string  | `GetLocale()`, for example `enUS`. Titles are in this locale.        |
| `exportedAt`   | integer | Unix seconds (`time()`).                                             |
| `count`        | integer | Must equal `quests.length`; guards against truncated copy and paste. |
| `quests`       | array   | Observation records, one per quest ID.                               |

## Quest record

```json
{
  "id": 92401,
  "title": "Into the Ruins",
  "state": "confirmed",
  "level": 17,
  "giver": { "type": "npc", "id": 12345, "name": "Guard Name" },
  "finisher": { "type": "npc", "id": 12346, "name": "Captain Name" },
  "objectivesHash": "42300a10",
  "items": [2589, 4306],
  "map": 1436,
  "x": 0.452,
  "y": 0.612,
  "faction": "Alliance",
  "contexts": ["detail", "gossip", "log"],
  "firstSeen": 1758620000,
  "lastSeen": 1758620300,
  "seenCount": 3,
  "accepted": true,
  "turnedIn": false
}
```

| Field                   | Type             | Required | Notes                                                                                                                                                                        |
| ----------------------- | ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | integer          | yes      | Quest ID, `1..1000000`.                                                                                                                                                      |
| `title`                 | string           | yes      | Quest title as shown in game, escape sequences stripped, at most 200 characters.                                                                                             |
| `state`                 | string           | yes      | The addon's classification when last seen: `classic`, `confirmed`, `inferred`, `changed`, `sod`, `era`.                                                                      |
| `level`                 | integer          | no       | Quest level as the client shows it (the quest log's difficulty level), `1..100`.                                                                                             |
| `giver`                 | object           | no       | Who offered the quest. `type` is `npc`, `object`, `item`, or `unknown`; `id` is the creature, game object, or item ID; `name` is the in-game name.                           |
| `finisher`              | object           | no       | Who showed the quest's progress or reward page (the turn-in), same shape as `giver`. Version 2.                                                                              |
| `objectivesHash`        | string           | no       | 8 lowercase hex digits: hash of the objective text on the offer page, see below. Version 2.                                                                                  |
| `items`                 | array of integer | no       | Item IDs the progress page asks the player to hand in, 1 to 20, distinct and ascending, each `1..10000000`. Version 2.                                                       |
| `map`                   | integer          | no       | `C_Map.GetBestMapForUnit("player")` the first time an NPC showed the quest (offer, progress, reward, gossip or greeting page). Absent for quests only seen in the quest log. |
| `x`, `y`                | number           | no       | Player map position `0..1`, three decimals, taken with `map`. Absent inside instances and just past a map's edge.                                                            |
| `faction`               | string           | no       | `Alliance`, `Horde`, or `Neutral` for the observing character.                                                                                                               |
| `contexts`              | array of string  | yes      | Where the quest was seen: `detail`, `progress`, `complete`, `gossip`, `greeting`, `log`, `tracker`, `accepted`, `turnedIn`.                                                  |
| `firstSeen`, `lastSeen` | integer          | yes      | Unix seconds.                                                                                                                                                                |
| `seenCount`             | integer          | yes      | Times an NPC showed the quest, counting once per minute; at least 1. Quest log scans do not count.                                                                           |
| `accepted`              | boolean          | no       | The character accepted the quest.                                                                                                                                            |
| `turnedIn`              | boolean          | no       | The character completed the quest.                                                                                                                                           |

Records with `state` `classic` or `changed` are only exported when the player enabled
"Record Classic quests for change detection"; they let the pipeline compare observed titles,
levels, quest givers, turn-ins, objective text and hand-in items with the original Classic data.

## Objectives hash

The objective text is never exported, only a fingerprint that the pipeline can compare with
QuestieDB's text. The addon lowercases `GetObjectiveText()`, removes the character's own name,
class and race (QuestieDB writes these as `$N`, `$C` and `$R`), and keeps only the characters
`a-z` and `0-9`. If nothing is left there is no hash. The hash of that ASCII string is

```
h = 0
for each byte b: h = (h * 257 + b) mod 4294967291
```

written as 8 lowercase hex digits (`"kill10koboldvermin"` hashes to `42300a10`). Every
intermediate value stays below 2^53, so Lua 5.1 and JavaScript numbers compute it exactly. The
pipeline's side is `tools/lib/objectivesHash.ts`, which removes QuestieDB's placeholders the same
way and skips text with a gendered `$g` placeholder, whose in-game form depends on the character.

## Version 1

Version 1 documents have the same fields without `finisher`, `objectivesHash` and `items`. The
Worker accepts them unchanged and ignores those fields in a version 1 document, like any unknown
field.

## CSV variant

`/fqm export csv` produces the same records for spreadsheets. The first line is a header:

```
id,title,state,level,giverType,giverId,giverName,map,x,y,faction,contexts,firstSeen,lastSeen,seenCount,accepted,turnedIn,finisherType,finisherId,finisherName,objectivesHash,items
```

Fields containing a comma, quote, or line break are wrapped in double quotes with embedded
quotes doubled. `contexts` and `items` are joined with `;`. The CSV variant is for people, not for the
Worker, which only accepts the JSON document.
