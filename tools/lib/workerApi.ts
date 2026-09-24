/**
 * Client for the community Worker's JSON API. Responses are validated before
 * use: titles end up in the repository, so malformed data fails loudly.
 */

const USER_AGENT = "ForeverQuestMarker-merge-submissions";
const MAX_TITLE_LENGTH = 200;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f|]/;
export const PREFERRED_LOCALE = "enUS";

export interface ConfirmedQuest {
  id: number;
  /** enUS title, else the title of the locale with the most reports. */
  title: string | null;
  reporters: number;
  firstReported: string;
  confirmedBy: string;
}

export interface ConfirmedResponse {
  generatedAt: string;
  foreverBuild: string | null;
  confirmed: ConfirmedQuest[];
}

export interface LocaleObservation {
  title: string;
  titleReports: number;
  reports: number;
  agreed: boolean;
  level: number | null;
  levelReports: number;
}

export interface ClassicObservation {
  id: number;
  reporters: number;
  level: { value: number; reports: number; total: number } | null;
  locales: Record<string, LocaleObservation>;
}

type Fields = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`Unexpected Worker response: ${path} ${message}`);
}

function object(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(path, "must be an object");
  return value as Fields;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function count(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0)
    fail(path, "must be a non-negative integer");
  return value as number;
}

function questId(value: unknown, path: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 1_000_000
  ) {
    fail(path, "must be a quest ID");
  }
  return value as number;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

function title(value: unknown, path: string): string {
  const text = string(value, path).trim();
  if (
    text.length === 0 ||
    [...text].length > MAX_TITLE_LENGTH ||
    UNSAFE_TEXT.test(text)
  ) {
    fail(path, "is not a safe quest title");
  }
  return text;
}

/** enUS if reported, otherwise the locale with the most reports (then by name). */
export function pickTitle(
  titles: Record<string, { title: string; reports: number }>,
): string | null {
  const preferred = titles[PREFERRED_LOCALE];
  if (preferred) return preferred.title;
  const [best] = Object.entries(titles).sort(
    ([localeA, a], [localeB, b]) =>
      b.reports - a.reports || (localeA < localeB ? -1 : 1),
  );
  return best ? best[1].title : null;
}

export function parseConfirmedResponse(json: unknown): ConfirmedResponse {
  const body = object(json, "body");
  const meta = body["meta"] === undefined ? {} : object(body["meta"], "meta");
  const confirmed = array(body["confirmed"], "confirmed").map(
    (value, index): ConfirmedQuest => {
      const path = `confirmed[${index}]`;
      const entry = object(value, path);
      const titles: Record<string, { title: string; reports: number }> = {};
      for (const [locale, localeValue] of Object.entries(
        object(entry["titles"], `${path}.titles`),
      )) {
        if (!/^[a-z]{2}[A-Z]{2}$/.test(locale))
          fail(
            `${path}.titles`,
            `has an invalid locale ${JSON.stringify(locale)}`,
          );
        const localeEntry = object(localeValue, `${path}.titles.${locale}`);
        titles[locale] = {
          title: title(localeEntry["title"], `${path}.titles.${locale}.title`),
          reports: count(
            localeEntry["reports"],
            `${path}.titles.${locale}.reports`,
          ),
        };
      }
      return {
        id: questId(entry["id"], `${path}.id`),
        title: pickTitle(titles),
        reporters: count(entry["reporters"], `${path}.reporters`),
        firstReported: string(entry["firstReported"], `${path}.firstReported`),
        confirmedBy: string(
          entry["confirmedBy"] ?? "auto",
          `${path}.confirmedBy`,
        ),
      };
    },
  );
  return {
    generatedAt: string(body["generatedAt"], "generatedAt"),
    foreverBuild:
      typeof meta["foreverBuild"] === "string" ? meta["foreverBuild"] : null,
    confirmed,
  };
}

export function parseClassicObservations(json: unknown): ClassicObservation[] {
  const body = object(json, "body");
  return array(body["quests"], "quests").map(
    (value, index): ClassicObservation => {
      const path = `quests[${index}]`;
      const entry = object(value, path);
      const locales: Record<string, LocaleObservation> = {};
      for (const [locale, localeValue] of Object.entries(
        object(entry["locales"], `${path}.locales`),
      )) {
        const at = `${path}.locales.${locale}`;
        const observed = object(localeValue, at);
        locales[locale] = {
          title: title(observed["title"], `${at}.title`),
          titleReports: count(observed["titleReports"], `${at}.titleReports`),
          reports: count(observed["reports"], `${at}.reports`),
          agreed: observed["agreed"] === true,
          level:
            observed["level"] === null
              ? null
              : count(observed["level"], `${at}.level`),
          levelReports: count(observed["levelReports"], `${at}.levelReports`),
        };
      }
      const level =
        entry["level"] === null
          ? null
          : object(entry["level"], `${path}.level`);
      return {
        id: questId(entry["id"], `${path}.id`),
        reporters: count(entry["reporters"], `${path}.reporters`),
        level: level
          ? {
              value: count(level["value"], `${path}.level.value`),
              reports: count(level["reports"], `${path}.level.reports`),
              total: count(level["total"], `${path}.level.total`),
            }
          : null,
        locales,
      };
    },
  );
}

/** Normalizes and checks the Worker base URL (https, or http for localhost). */
export function workerBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid Worker URL: ${value}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`The Worker URL must use https: ${value}`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export async function fetchWorkerJson(
  baseUrl: string,
  path: string,
  adminToken?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `GET ${path} failed with ${response.status} ${response.statusText}: ${detail}`,
    );
  }
  return response.json();
}
