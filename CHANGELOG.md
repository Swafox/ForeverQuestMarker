# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (0.x while WoW Forever is in beta).

Before tagging a release, rename `Unreleased` to the version and date, for example
`## [0.1.0] - 2026-10-01`; the release workflow refuses tags without a matching section.

## [Unreleased]

## [2.0.0] - 2026-11-12

### Added

- NPC tooltips: hovering a quest giver lists the new Forever quests it offers, which ones you have
  done and which are in your log. Quest givers come from community reports shipped with the addon
  and from the quests you have met yourself. Options to turn it off or hide completed quests.
- Journal (`/fqm journal`, the settings, or the minimap addon menu): your progress through Forever's
  new quests, overall and by zone, with a progress bar and a filter for completed quests.
- Waypoints: click a quest in the journal, or `/fqm track <questID>`, to put the game's own map pin
  on its quest giver and track it.
- Minimap addon compartment entry: left-click opens the journal, right-click the settings, and the
  tooltip shows your progress.
- Changed Classic quests now say what changed (quest giver, turn-in, objectives, required items,
  title or level) when the community data knows.

### Changed

- The recorder also notes the turn-in NPC, the item IDs a quest asks for and a hash of the objective
  text, so changed Classic quests can be detected. `/fqm export` writes format version 2; the
  submission page accepts both versions.
- `/fqm check` shows where a quest is picked up and what changed in it; `/fqm status` counts the
  community quest givers and change details.

## [0.1.8] - 2026-11-12

### Changed

- Quest data checked against Forever build 1.60.1.70888 and Classic Era 1.15.9.70576: no quests
  changed classification (1,818 confirmed new).

## [0.1.6] - 2026-11-07

### Changed

- Quest data from Forever build 1.60.1.70862 and Classic Era 1.15.9.70576: 10 more quests are
  confirmed new (1,818 in total).

## [0.1.5] - 2026-11-04

### Changed

- Quest data checked against Forever build 1.60.1.70755 and Classic Era 1.15.9.70576: no quests
  changed classification (1,808 confirmed new).

## [0.1.4] - 2026-10-20

### Fixed

- Release packaging: this version publishes the 0.1.3 changes, since 0.1.3 was tagged without a
  changelog section and never released. The addon itself is unchanged since 0.1.3.

## [0.1.3] - 2026-10-20

### Changed

- Quest data from Forever build 1.60.1.70450 and Classic Era 1.15.9.70003: 16 more quests are
  confirmed new (1,808 in total).

## [0.1.2] - 2026-09-24

### Fixed

- Release packaging: this version is also published on Wago Addons. The addon itself is unchanged
  since 0.1.0 (0.1.1 was tagged but never released).

## [0.1.0] - 2026-09-24

### Added

- Quest classification: original Classic (QuestieDB), confirmed new (Forever client quest table
  or player reports), likely new (in no known list), changed (player reports), Season of Discovery,
  and other Classic Era quests. Data from Forever build 1.60.1.69977 and Classic Era 1.15.9.69722.
- Markers in the quest window title (offer, progress, reward and quest log details), gossip and
  quest greeting lists, the quest log, and the objective tracker.
- Tooltip explanations on markers, quest giver rows, quest log entries, tracked quests, world map
  quest pins and quest links.
- Chat notice when another addon replaces the quest window, and an optional announcement for every
  new quest offered.
- Quest recorder and `/fqm export` (JSON or CSV) for the community quest list; the export window
  links the submission page.
- Settings panel, `/fqm` commands for status, probing open windows, checking a quest ID, errors,
  and live marker placement tuning.
