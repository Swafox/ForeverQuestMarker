# Quest data

## Sources

| Set         | Source                                                                                                                                                                                                  | Count |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `classic`   | QuestieDB `data/Classic/classicQuestDB.lua` (4,244 IDs, 2 to 9,665) plus 13 Classic Era-only quests added in `src/corrections/Era/classicQuestFixes.lua` (for example 65593 Hearts of the Lovers)       | 4,257 |
| `sod`       | QuestieDB `src/corrections/Sod/sodBaseQuests.lua` (76,156 to 90,627)                                                                                                                                    | 928   |
| `datamined` | IDs in the Forever client's `QuestV2` table (build 1.60.1.69977, 6,600 rows) that are absent from the Classic Era client's (build 1.15.9.69722, 4,807 rows) and from the two sets above, via wago.tools | 1,792 |
| `era`       | IDs in the Classic Era client's `QuestV2` table that are neither Classic nor SoD: cut, unused and event quests                                                                                          | 495   |
| `community` | `dataset/community/confirmed.json`, fed by the submission pipeline                                                                                                                                      | 0     |
| `changed`   | `dataset/community/changed.json`, human reviewed                                                                                                                                                        | 0     |

Pins for every upstream revision are in `dataset/sources.json`; downloads are cached in `.cache/`.

Findings worth knowing:

- QuestieDB's own Forever flavor (`data/Forever/foreverQuestDB.lua`) currently has exactly the same
  quest IDs as its Classic data (only coordinates differ), so it does not identify new quests yet.
- `QuestV2` only lists quests that own a completion bit, so it is not a full quest list: 709
  Questie Classic quests are absent from the Forever client's table. Absence proves nothing; presence
  in Forever together with absence from Classic Era is strong evidence of a new quest record.
- New Forever quest IDs cluster from about 86,000 to 99,234, interleaved with retail quest IDs of the
  same period, because Blizzard allocates quest IDs from one global sequence. A numeric cutoff would
  be wrong; set membership is used instead.
- Three Classic quests (3382, 8193, 8249) gained a `QuestV2` row in Forever. They stay classified as
  Classic; they are candidates for the "changed" list once players confirm what changed.
- Questie keeps fake quest IDs (90,000 to 91,001 in `sodQuestFixes.lua`) for Season of Discovery
  runes. They are deliberately excluded, since they are close to the real Forever range.

## Precedence

`Core/Classifier.lua` checks, in order: `changed`, `classic`, `community`, `datamined`, `sod`,
`era`. The first set containing the ID wins; an ID in none of them is `inferred` (likely new).
The generator keeps Classic IDs out of `community` and `datamined`, and only accepts Classic IDs in
`changed`, warning about anything else.

## Refreshing

```sh
bun tools/generate-data.ts --update   # newest QuestieDB commit, Forever build from wow-ui-source, newest Era build
```

The weekly `Data refresh` workflow does the same and opens a pull request, so each new Forever build
arrives as a diff of `Data/ForeverQuests.lua`. At launch (November 4, 2026) rerun it against the
release build to make "confirmed" cover almost every new quest.

## Licensing

QuestieDB and Questie carry no license file on GitHub (an open Questie pull request from 2023 aims to
clarify licensing), while Questie's CurseForge listing states GPL v3. This addon only uses quest ID
numbers, which are facts rather than creative content, credits the project, and is itself
GPL-3.0-or-later, so it is compatible either way. Client `QuestV2` data is Blizzard's; only IDs are
used, and wago.tools is credited as the mirror. Wowhead data is proprietary and is not used.
