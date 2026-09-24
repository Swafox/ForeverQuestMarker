import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
const CACHE_DIR = join(REPO_ROOT, ".cache", "sources");
const USER_AGENT = "ForeverQuestMarker-data-generator (+https://github.com/)";

export interface SourcePins {
  questieDB: {
    repo: string;
    commit: string;
    classicQuestDB: string;
    eraQuestFixes: string;
    sodBaseQuests: string;
  };
  wago: {
    foreverBuild: string;
    eraBuild: string;
  };
}

export const SOURCES_FILE = join(REPO_ROOT, "dataset", "sources.json");

export async function readPins(): Promise<SourcePins> {
  return (await Bun.file(SOURCES_FILE).json()) as SourcePins;
}

export async function writePins(pins: SourcePins): Promise<void> {
  await Bun.write(SOURCES_FILE, `${JSON.stringify(pins, null, 2)}\n`);
}

function cachePathFor(url: string): string {
  return join(
    CACHE_DIR,
    url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "_"),
  );
}

export interface FetchOptions {
  offline?: boolean;
  /** Pinned URLs are immutable, so a cached copy is always reused. */
  immutable?: boolean;
}

export async function fetchText(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const cachePath = cachePathFor(url);
  const cached = Bun.file(cachePath);
  if ((options.offline || options.immutable) && (await cached.exists())) {
    return cached.text();
  }
  if (options.offline) {
    throw new Error(`Offline mode: ${url} is not cached at ${cachePath}`);
  }
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(
      `GET ${url} failed with ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  await mkdir(dirname(cachePath), { recursive: true });
  await Bun.write(cachePath, text);
  return text;
}

export function questieRawUrl(pins: SourcePins, path: string): string {
  return `https://raw.githubusercontent.com/${pins.questieDB.repo}/${pins.questieDB.commit}/${path}`;
}

export function wagoQuestV2Url(build: string): string {
  return `https://wago.tools/db2/QuestV2/csv?build=${encodeURIComponent(build)}`;
}

/** Resolves the newest upstream revisions for `--update`. */
export async function resolveLatestPins(
  current: SourcePins,
): Promise<SourcePins> {
  const commitResponse = await fetch(
    `https://api.github.com/repos/${current.questieDB.repo}/commits/HEAD`,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!commitResponse.ok)
    throw new Error(`GitHub API failed: ${commitResponse.status}`);
  const commit = ((await commitResponse.json()) as { sha: string }).sha;

  const foreverVersion = (
    await fetchText(
      "https://raw.githubusercontent.com/Gethe/wow-ui-source/forever/version.txt",
    )
  ).trim();

  const buildsResponse = await fetch("https://wago.tools/api/builds", {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!buildsResponse.ok)
    throw new Error(`wago.tools builds failed: ${buildsResponse.status}`);
  const builds = (await buildsResponse.json()) as Record<
    string,
    { version: string }[]
  >;
  const eraBuild = builds["wow_classic_era"]?.[0]?.version;
  if (!eraBuild) throw new Error("wago.tools did not list a Classic Era build");

  return {
    questieDB: { ...current.questieDB, commit },
    wago: { foreverBuild: foreverVersion, eraBuild },
  };
}
