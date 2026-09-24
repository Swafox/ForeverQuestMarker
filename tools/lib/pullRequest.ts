/** Commits the regenerated data on a new branch and opens a pull request with gh. */

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.slice(0, 3).join(" ")} failed:\n${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString().trim();
}

export function branchName(now: Date): string {
  const stamp = now
    .toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `community-data/${stamp}`;
}

export interface PullRequestOptions {
  root: string;
  branch: string;
  title: string;
  body: string;
  paths: string[];
}

/** Returns the pull request URL. */
export function openPullRequest(options: PullRequestOptions): string {
  const { root, branch, title, body, paths } = options;
  run(["git", "switch", "-c", branch], root);
  run(["git", "add", "--", ...paths], root);
  const staged = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], {
    cwd: root,
  });
  if (staged.exitCode === 0)
    throw new Error("Nothing to commit for the pull request.");
  run(["git", "commit", "-m", title], root);
  run(["git", "push", "-u", "origin", branch], root);
  return run(
    ["gh", "pr", "create", "--head", branch, "--title", title, "--body", body],
    root,
  );
}
