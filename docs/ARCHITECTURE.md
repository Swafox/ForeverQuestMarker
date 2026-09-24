# Architecture

## Target client

WoW Forever runs the modern client (build 1.60.1, interface 16001) with the Mainline UI, game
type `camelot`. The UI source for that exact client is mirrored on the `forever` branch of
[Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source); every hook below was written
against it, and `tools/ui-contract.ts` lists each assumption so `bun tools/verify-ui-source.ts
--clone` can re-check them whenever Blizzard ships a new build. Relevant facts from that source:

- The quest window, gossip window and quest log are the Mainline ones (`Mainline/QuestFrame.lua`,
  `Mainline/QuestInfo.lua`, `Shared/GossipFrameShared.lua`, `Mainline/QuestMapFrame.lua`); the
  Classic `QuestLogFrame` is not loaded. `Camelot/QuestMapFrameOverrides.lua` prefixes quest log
  titles with the quest level.
- The objective tracker is the modern module system (`Blizzard_ObjectiveTracker`).
- `WOW_PROJECT_ID` reports retail, so the addon never branches on it.

## Load order and modules

The TOC loads, in order:

| File                                                                           | Role                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `Locales/Locales.lua`, `Locales/enUS.lua`                                      | `ns.L`; missing keys fall back to the key.                                                          |
| `Core/Init.lua`                                                                | Namespace, `ns.State`, event dispatch, internal messages, `ns.SafeCall` error containment.          |
| `Core/Bitset.lua`                                                              | Read-only quest ID sets decoded lazily from base64 segments (O(1) lookup, nothing decoded at load). |
| `Data/*.lua`                                                                   | Generated ID sets and their provenance (`ns.Data.Sets`, `ns.Data.meta`).                            |
| `Core/Classifier.lua`                                                          | Quest ID to state, with the precedence rules and a cache.                                           |
| `Core/Database.lua`                                                            | Saved variables, defaults, repair of bad values, the random `clientId`.                             |
| `Core/Display.lua`                                                             | The one place that decides which marker (if any) a quest gets, honoring settings.                   |
| `Core/Integrations.lua`                                                        | Registry of UI integrations: install once, report status, refresh on setting changes.               |
| `Core/Recorder.lua`                                                            | Event-driven quest observation for the community list.                                              |
| `Core/Export.lua`                                                              | JSON and CSV serialization (docs/EXPORT_FORMAT.md).                                                 |
| `UI/Badge.lua`                                                                 | Atlas coordinates, inline markup, marker textures on frames, per-context layout.                    |
| `UI/Tooltip.lua`                                                               | Tooltip lines; quest link tooltips.                                                                 |
| `UI/QuestFrame.lua`, `UI/GossipFrame.lua`, `UI/QuestLog.lua`, `UI/Tracker.lua` | The integrations.                                                                                   |
| `UI/ExportFrame.lua`                                                           | The export window.                                                                                  |
| `Core/Notices.lua`                                                             | Chat notices when the quest window is replaced by another addon.                                    |
| `Core/Diagnostics.lua`, `Core/Slash.lua`                                       | `/fqm` commands.                                                                                    |
| `Options/Options.lua`                                                          | Settings panel (modern `Settings` API).                                                             |
| `Core/Bootstrap.lua`                                                           | `ADDON_LOADED` (saved variables) and `PLAYER_LOGIN` (everything else).                              |

## Hooks

Every hook body runs through `ns.SafeCall`, so an error is recorded once, forwarded once to the
game's error handler (BugSack sees it), announced once in chat, and never interrupts Blizzard's code.

| Window                              | Mechanism                                                                                                                                             | Marker placement                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quest offer, reward and log details | `hooksecurefunc("QuestInfo_Display")`; quest ID from `GetQuestID()` or, for quest log templates, `C_QuestLog.GetSelectedQuest()`                      | Inline texture markup before `QuestInfoTitleHeader`'s text, the technique Blizzard itself uses for quest type icons in the same title; an invisible motion-only frame over it provides the tooltip. The addon remembers the text it set, so it never stacks markers and restores the plain title when disabled.                                                                                   |
| Quest progress page                 | `QuestFrameProgressPanel:HookScript("OnShow")` (the XML binds the function value, so a global hook would miss it)                                     | Same inline markup on `QuestProgressTitleText`.                                                                                                                                                                                                                                                                                                                                                   |
| Quest greeting page                 | `QuestFrameGreetingPanel:HookScript("OnShow")` plus `hooksecurefunc("QuestFrameGreetingPanel_OnShow")` for the `QUEST_LOG_UPDATE` path                | Pip on the bottom right of each row's quest icon (`button.Icon`). Quest ID from `GetActiveQuestID(id)` or the fifth return of `GetAvailableQuestInfo(id)`.                                                                                                                                                                                                                                        |
| Gossip window                       | `ScrollUtil.AddInitializedFrameCallback` on `GossipFrame.GreetingPanel.ScrollBox` (fires after Blizzard's initializer each time a pooled row is used) | Pip on the row's quest icon. Rows for options and headers get their pip hidden, so recycled frames never keep a stale marker.                                                                                                                                                                                                                                                                     |
| Quest log                           | `hooksecurefunc("QuestLogQuests_Update")`, then `QuestScrollFrame.titleFramePool:EnumerateActive()`                                                   | Pip on the corner of the quest's POI button, which Blizzard places at (6, -4) on every row while the `questPOI` CVar is on (found with `QuestScrollFrame.Contents:FindButtonByQuestID`). Title and POI buttons are siblings, so the pip's holder frame is raised above the POI. Without POI buttons, left of `button.Text`. Tooltip via the `QuestMapLogTitleButton.OnEnter` EventRegistry event. |
| Objective tracker                   | `hooksecurefunc(QuestObjectiveTracker, "Update")` (and the campaign module if present), then `EnumerateActiveBlocks`                                  | Pip on `block.poiButton`, left of the header, or in that spot when the tracker shows no POI buttons. Headers wrap freely, so the marker never touches the text. Tooltip via `OnQuestBlockHeader.OnEnter`, building one outside groups exactly as Blizzard's PTR feedback addon does.                                                                                                              |
| Item and area trigger offers        | `hooksecurefunc(QuestObjectiveTracker, "AddAutoQuestPopUp")` with type `OFFER`                                                                        | No marker (Blizzard shows a pop-up and closes the offer before `QUEST_DETAIL` reaches addons); the recorder uses this hook to record the quest and its item.                                                                                                                                                                                                                                      |
| Quest links, map pins               | `TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Quest)`, `MapCanvas.QuestPin.OnEnter`                                                   | Tooltip lines only.                                                                                                                                                                                                                                                                                                                                                                               |

Per-frame state (which quest a row shows, whether its scripts are hooked, the text last set) lives
in the modules' own weak-keyed tables, never as fields on Blizzard frames. Each marker texture sits on
a small holder frame of the addon's own, parented to the Blizzard row, which lets it be raised above
sibling frames such as POI buttons; the holder takes no mouse input.

Placement values live in `Badge.DEFAULT_LAYOUT`; `/fqm tune` overrides them per context in the saved
variables and refreshes open windows, so positions can be tuned in game without a reload.

## Data

`tools/generate-data.ts` builds the ID sets from pinned sources (see [DATA.md](DATA.md)) and writes
`Data/*.lua`, a plain-list fixture for the specs, and a TypeScript copy for the Worker. The encoder
(`tools/data/bitset.ts`) and the Lua decoder (`Core/Bitset.lua`) share one format: base64 characters
holding six IDs each, least significant bit first, in segments where IDs are dense and as loose IDs
where they are sparse. The whole data set is about 8 KB.

## Tests

- `tests/helpers/wow.lua` emulates the client: widgets expose only the methods listed in the
  client's widget documentation (`tests/helpers/widget_api.lua`, regenerated from the UI source),
  and the Blizzard frames and functions the addon hooks are emulated after the FrameXML, including
  quirks such as XML-bound `OnShow` scripts and `ScrollUtil`'s argument order.
- `tests/spec/addon_spec.lua` loads the addon through its TOC and drives every integration, the
  settings panel, slash commands, chat notices and error containment.
- `tests/spec/bitset_spec.lua` checks every generated set against the plain ID lists across
  IDs 1 to 110,000.
- `tests/spec/rules_spec.lua` enforces the project rules on every file the TOC loads.
