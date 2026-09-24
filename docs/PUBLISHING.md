# Publishing

Releases are built by the [BigWigs packager](https://github.com/BigWigsMods/packager) from a git
tag. The packager reads `## Interface: 16001` and labels the upload for the WoW Forever game version
(its `16???` interfaces map to the `forever` game type), replaces `@project-version@` with the tag,
strips the development files listed in `.pkgmeta`, and uses `CHANGELOG.md` as the release notes.
All add-ons must be free under Blizzard's UI Add-On Development Policy; this one has no paid tier.

## One-time setup

1. **GitHub.** Push the repository. The `CI` workflow runs on every push and pull request.
2. **CurseForge.** Create the project (category Quests, license GPL-3.0, game version Forever). Copy
   the project ID into the TOC as `## X-Curse-Project-ID: <id>`. Create an API token at
   <https://authors.curseforge.com/account/api-tokens> and add it as the repository secret
   `CF_API_KEY`.
3. **Wago Addons.** Create the project, put its ID in the TOC as `## X-Wago-ID: <id>`, create a token
   at <https://addons.wago.io/account/apikeys> and add it as the secret `WAGO_API_TOKEN`.
4. **Optional:** WoWInterface (`## X-WoWI-ID:` and secret `WOWI_API_TOKEN`).

Uploads to a platform are skipped until its ID and token exist, so the workflow is safe to run
before everything is set up; it always creates the GitHub release.

## Releasing

1. Run the checks: `busted`, `luacheck .`, `bun test tools`, `bun run typecheck`,
   `bun tools/generate-data.ts --check`, `bun tools/verify-ui-source.ts --clone`.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.1.0] - YYYY-MM-DD` and start a new empty
   `Unreleased` section.
3. Commit (`chore(release): 0.1.0`), then `git tag v0.1.0 && git push --follow-tags`.
4. The `Release` workflow refuses the tag if the changelog has no matching section, then packages
   and uploads `ForeverQuestMarker-v0.1.0-forever.zip`.

Use `-beta` or `-alpha` tag suffixes (`v0.1.0-beta.1`) for test builds; the packager marks them
accordingly on CurseForge and Wago.

For a quick manual build without the packager: `scripts/package-local.sh` writes
`.release/ForeverQuestMarker-<version>.zip`.

## Listing text

Suggested summary: "Marks quests that are new in WoW Forever, separating them from original Classic
quests." Use `README.md` for the description and `docs/media/badges-in-game-sizes.png` plus real
in-game screenshots (quest window, gossip, quest log) for the gallery. Credit QuestieDB and explain
confirmed versus likely new.

## Promotion

r/classicwow, r/wow, the WoW Forever Discord, the Forever beta forums, and the WoW UI and Macro forum.
