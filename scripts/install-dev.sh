#!/usr/bin/env bash
# Copies the addon into a WoW AddOns folder for testing.
#
#   scripts/install-dev.sh "/Applications/World of Warcraft/_forever_/Interface/AddOns"
#   scripts/install-dev.sh --link "<AddOns folder>"   symlink instead, so edits apply on /reload
#
# The Forever client's folder name may differ; it is the folder next to _retail_ or
# _classic_era_ that contains the Forever Wow executable.
set -euo pipefail

mode=copy
if [[ "${1:-}" == "--link" ]]; then
  mode=link
  shift
fi
addons_dir="${1:?usage: scripts/install-dev.sh [--link] <path to Interface/AddOns>}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
target="$addons_dir/ForeverQuestMarker"

if [[ ! -d "$addons_dir" ]]; then
  echo "AddOns folder not found: $addons_dir" >&2
  exit 1
fi

rm -rf "$target"
if [[ "$mode" == "link" ]]; then
  ln -s "$repo_root" "$target"
  echo "Linked $target -> $repo_root"
  exit 0
fi

mkdir -p "$target"
grep -v '^#' "$repo_root/scripts/addon-files.txt" | while read -r entry; do
  [[ -z "$entry" ]] && continue
  cp -R "$repo_root/$entry" "$target/"
done
echo "Installed into $target. In game: /reload, then /fqm status"
