# Testing

## Offline (any machine)

```sh
busted                                  # 222 specs: data, classifier, recorder, export, rules, and every
                                        # integration inside the client emulation
luacheck .
bun test tools && bun run typecheck     # includes the addon-export versus Worker-validator contract
(cd worker && bun test && bun run typecheck)
bun tools/generate-data.ts --check      # generated data matches the pins
bun tools/verify-ui-source.ts --clone   # every UI assumption still holds in the current Forever FrameXML
```

The emulation only accepts widget methods from the client's own documentation and reproduces the
Blizzard code paths the addon hooks, so these catch typos, missing methods, wrong callback
signatures and broken hook targets. They cannot show what the markers look like or prove how the
real client behaves; that is what the in-game pass below is for.

## In game

### Setup

1. Install [BugGrabber and BugSack](https://www.curseforge.com/wow/addons/bugsack) if available for
   Forever, and run `/console scriptErrors 1` once so Lua errors are visible.
2. Run `/console taintLog 1` once; the client then writes `Logs/taint.log` in the Forever folder.
3. Install the addon: `scripts/install-dev.sh --link "<Forever>/Interface/AddOns"` (macOS/Linux) or
   `scripts\install-dev.ps1 "<Forever>\Interface\AddOns"` (Windows). The Forever folder is the one
   next to `_retail_` that holds the Forever client.
4. At character select, open AddOns: "ForeverQuest Marker" should be listed with its gold star icon
   and must not say "Out of date". If it does, run `/dump select(4, GetBuildInfo())` in game and put
   that number in `## Interface:` in the TOC.

Record every problem with the output of `/fqm status`, `/fqm errors` and a screenshot. `/fqm debug`
turns on extra chat output.

### Checklist

Each step lists what to do and what should happen. `/fqm check <questID>` explains any quest's
classification; `/fqm probe` lists what the addon sees in the windows that are open.

| #   | Do                                                                                                                                            | Expect                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Log in, then `/fqm status`                                                                                                                    | No Lua errors. Data line shows QuestieDB and builds 1.60.1.69977 / 1.15.9.69722; a note appears if your client build differs. Integrations: `questFrame`, `gossip`, `greeting`, `questLog`, `tracker`, `questLinks`, `mapPins` all `installed`.                                   |
| 2   | Talk to a quest giver in an original Classic zone (for example Marshal Dughan in Goldshire) and open a Classic quest                          | No marker. `/fqm probe` shows the quest as `classic`.                                                                                                                                                                                                                             |
| 3   | Open a quest that is new in Forever (new race starting areas, Hall of Thanes, Ruins of Lordaeron; any quest that `/fqm check` reports as new) | A gold star before the title on the offer page. Hovering the star shows "New in WoW Forever".                                                                                                                                                                                     |
| 4   | Accept it; open the quest log (world map side panel)                                                                                          | A small gold star on the lower right corner of the quest's map marker button, left of `[level]`, drawn above the button. Hovering the row adds "New in WoW Forever" to Blizzard's tooltip. With map markers off (`/console questPOI 0`), the star sits left of the title instead. |
| 5   | Look at the objective tracker                                                                                                                 | A small star on the corner of the quest's map marker button, never over the quest name (also check a long name that wraps). Hover the name: a tooltip with the title and state (outside groups).                                                                                  |
| 6   | Click the quest in the log to open its details                                                                                                | Star before the title in the details view.                                                                                                                                                                                                                                        |
| 7   | Turn the quest in (progress page, then reward page)                                                                                           | Star before the title on both pages.                                                                                                                                                                                                                                              |
| 8   | Talk to an NPC with gossip and several quests (innkeepers, town NPCs)                                                                         | Pip on the bottom right of the "!" or "?" icon for non-Classic quests only; none on Classic quests or dialog options. Hovering a marked row shows the state.                                                                                                                      |
| 9   | Scroll or reopen that gossip several times, and visit NPCs with a mix of quests                                                               | Pips never appear on the wrong row.                                                                                                                                                                                                                                               |
| 10  | Find an NPC that shows the older quest list page ("Current Quests" / "Available Quests", no dialog text options)                              | Pips on non-Classic quests, as in step 8.                                                                                                                                                                                                                                         |
| 11  | Shift-click a new quest from the log into chat and hover the link                                                                             | The tooltip includes "New in WoW Forever".                                                                                                                                                                                                                                        |
| 12  | Hover a quest pin on the world map                                                                                                            | The tooltip includes the state line for new quests.                                                                                                                                                                                                                               |
| 13  | Open the settings (`/fqm`) and toggle each option while the relevant window is open                                                           | Markers disappear and reappear immediately. "Show state as text" adds "New" after the star in quest window titles. Settings survive `/reload` and relog.                                                                                                                          |
| 14  | Enter combat with the quest log and map open, accept and abandon a quest, use a quest item from the tracker                                   | No "action blocked" or "interface action failed because of an AddOn" messages. After the session, search `Logs/taint.log` for `ForeverQuestMarker`; there should be no entries blaming it.                                                                                        |
| 14b | Use an item that starts a quest, or walk into an area that offers one automatically                                                           | Blizzard's "new quest" pop-up appears in the tracker. `/fqm export` afterwards lists the quest with the item as its giver.                                                                                                                                                        |
| 15  | `/fqm export`, then `/fqm export csv`                                                                                                         | A window with JSON (one quest per line) or CSV, already selected; Ctrl+A, Ctrl+C copies it. Paste it into a file and keep it for the pipeline test.                                                                                                                               |
| 16  | Install Questie (Forever flavor) and your usual quest addons, `/reload`                                                                       | Both work; no errors. Note any overlap with Questie's own title decorations.                                                                                                                                                                                                      |
| 17  | If you use Immersion or another quest window replacement, talk to a new quest giver                                                           | A chat line such as "Into the Ruins: New in WoW Forever" (setting "Chat notice when the quest window is replaced").                                                                                                                                                               |
| 18  | `/fqm errors` at the end of the session                                                                                                       | "No errors recorded."                                                                                                                                                                                                                                                             |

### Tuning marker placement

Default sizes and offsets are educated guesses from the FrameXML anchors. Adjust them live and write
the final numbers into `Badge.DEFAULT_LAYOUT` in `UI/Badge.lua`:

```
/fqm tune gossip size 14        pip size on gossip rows
/fqm tune gossip x -2           move right (+) or left (-)
/fqm tune gossip y 2            move up (+) or down (-)
/fqm tune title size 18         inline star in quest window titles (x is unused, y shifts the icon)
/fqm tune questLog x -3
/fqm tune tracker size 11
/fqm tune reset
```

Contexts: `title`, `gossip`, `greeting`, `questLog`, `tracker`. Current overrides are stored under
`layout` in `WTF/Account/<account>/SavedVariables/ForeverQuestMarker.lua`.

### When an integration is unavailable or misplaced

- `/fstack` and hover the element to see its frame names; compare with `tools/ui-contract.ts`.
- `/etrace` to confirm `QUEST_DETAIL`, `GOSSIP_SHOW` and `QUEST_GREETING` fire.
- Useful probes:
  - `/dump GetQuestID(), GetTitleText()` on a quest page
  - `/dump C_GossipInfo.GetAvailableQuests()` in a gossip window
  - `/run for b in QuestScrollFrame.titleFramePool:EnumerateActive() do print(b.questID, b.Text:GetText()) end`
  - `/run QuestObjectiveTracker:EnumerateActiveBlocks(function(b) print(b.id, b.HeaderText and b.HeaderText:GetText()) end)`
- The full error stacks are in the saved variables file after `/reload`, under `errors`.
