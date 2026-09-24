# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (0.x while WoW Forever is in beta).

Before tagging a release, rename `Unreleased` to the version and date, for example
`## [0.1.0] - 2026-10-01`; the release workflow refuses tags without a matching section.

## [Unreleased]

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
