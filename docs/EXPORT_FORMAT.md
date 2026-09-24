# Export format (version 1)

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
  "version": 1,
  "addonVersion": "0.1.0",
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
| `version`      | integer | `1` for this document.                                               |
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

| Field                   | Type            | Required | Notes                                                                                                                                                                        |
| ----------------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | integer         | yes      | Quest ID, `1..1000000`.                                                                                                                                                      |
| `title`                 | string          | yes      | Quest title as shown in game, escape sequences stripped, at most 200 characters.                                                                                             |
| `state`                 | string          | yes      | The addon's classification when last seen: `classic`, `confirmed`, `inferred`, `changed`, `sod`, `era`.                                                                      |
| `level`                 | integer         | no       | Quest level as the client shows it (the quest log's difficulty level), `1..100`.                                                                                             |
| `giver`                 | object          | no       | Where the quest was offered or turned in. `type` is `npc`, `object`, `item`, or `unknown`; `id` is the creature, game object, or item ID; `name` is the in-game name.        |
| `map`                   | integer         | no       | `C_Map.GetBestMapForUnit("player")` the first time an NPC showed the quest (offer, progress, reward, gossip or greeting page). Absent for quests only seen in the quest log. |
| `x`, `y`                | number          | no       | Player map position `0..1`, three decimals, taken with `map`. Absent inside instances and just past a map's edge.                                                            |
| `faction`               | string          | no       | `Alliance`, `Horde`, or `Neutral` for the observing character.                                                                                                               |
| `contexts`              | array of string | yes      | Where the quest was seen: `detail`, `progress`, `complete`, `gossip`, `greeting`, `log`, `tracker`, `accepted`, `turnedIn`.                                                  |
| `firstSeen`, `lastSeen` | integer         | yes      | Unix seconds.                                                                                                                                                                |
| `seenCount`             | integer         | yes      | Times an NPC showed the quest, counting once per minute; at least 1. Quest log scans do not count.                                                                           |
| `accepted`              | boolean         | no       | The character accepted the quest.                                                                                                                                            |
| `turnedIn`              | boolean         | no       | The character completed the quest.                                                                                                                                           |

Records with `state` `classic` or `changed` are only exported when the player enabled
"Record Classic quests for change detection"; they let the pipeline compare observed titles
and levels with the original Classic data.

## CSV variant

`/fqm export csv` produces the same records for spreadsheets. The first line is a header:

```
id,title,state,level,giverType,giverId,giverName,map,x,y,faction,contexts,firstSeen,lastSeen,seenCount,accepted,turnedIn
```

Fields containing a comma, quote, or line break are wrapped in double quotes with embedded
quotes doubled. `contexts` is joined with `;`. The CSV variant is for people, not for the
Worker, which only accepts the JSON document.
