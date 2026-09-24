import { describe, expect, test } from "bun:test";
import {
  pullRequestBody,
  pullRequestTitle,
  renderSummary,
  type MergeSummary,
} from "./mergeSummary";
import { branchName } from "./pullRequest";

const summary: MergeSummary = {
  workerUrl: "https://fqm.example.workers.dev",
  generatedAt: "2026-09-23T12:00:00.000Z",
  confirmedByWorker: 3,
  added: [
    {
      id: 120001,
      title: "Into the Ruins",
      note: "3 independent reports, first 2026-09-20",
      source: "pipeline",
    },
  ],
  alreadyListed: 1,
  skipped: [{ id: 92401, reason: "already in the datamined Forever list" }],
  changes: null,
  reportPath: null,
  warnings: ["the Worker was deployed with older data"],
};

describe("merge summary", () => {
  test("lists what was added and skipped", () => {
    expect(renderSummary(summary)).toBe(
      [
        "Worker https://fqm.example.workers.dev, data generated 2026-09-23T12:00:00.000Z.",
        "Confirmed by community reports: 3; already in confirmed.json: 1; newly added: 1.",
        "  + 120001 Into the Ruins (3 independent reports, first 2026-09-20)",
        "Skipped because the local data already classifies them: 1.",
        "  - 92401: already in the datamined Forever list",
        "Classic change detection skipped (no admin token).",
        "Warning: the Worker was deployed with older data",
      ].join("\n"),
    );
  });

  test("builds the pull request title and body", () => {
    expect(pullRequestTitle(summary)).toBe(
      "chore(data): add 1 community-confirmed quest",
    );
    expect(
      pullRequestTitle({
        ...summary,
        added: [...summary.added, { id: 120002 }],
      }),
    ).toBe("chore(data): add 2 community-confirmed quests");
    expect(pullRequestBody(summary)).toContain("+ 120001 Into the Ruins");
  });

  test("names branches by date and time", () => {
    expect(branchName(new Date("2026-09-23T12:34:56Z"))).toBe(
      "community-data/20260923-1234",
    );
  });
});
