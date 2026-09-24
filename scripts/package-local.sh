#!/usr/bin/env bash
# Builds .release/ForeverQuestMarker-<version>.zip without the BigWigs packager, for
# handing a test build to someone. The version token is replaced with the git
# description (or "dev").
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(git -C "$repo_root" describe --tags --always 2>/dev/null || echo dev)"
stage="$repo_root/.release/stage/ForeverQuestMarker"

rm -rf "$repo_root/.release/stage"
mkdir -p "$stage"
grep -v '^#' "$repo_root/scripts/addon-files.txt" | while read -r entry; do
  [[ -z "$entry" ]] && continue
  cp -R "$repo_root/$entry" "$stage/"
done
sed -i.bak "s/@project-version@/$version/" "$stage/ForeverQuestMarker.toc" && rm "$stage/ForeverQuestMarker.toc.bak"

zip_path="$repo_root/.release/ForeverQuestMarker-$version.zip"
rm -f "$zip_path"
(cd "$repo_root/.release/stage" && zip -qr "$zip_path" ForeverQuestMarker)
rm -rf "$repo_root/.release/stage"
echo "Wrote $zip_path"
