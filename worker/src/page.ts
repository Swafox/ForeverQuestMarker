/** The paste page served at GET / and its script at GET /app.js. */

export const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="6" fill="#2a2016"/>' +
      '<path d="M14 6h4l-.8 13h-2.4zM14 22h4v4h-4z" fill="#e0b453"/></svg>',
  );

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>ForeverQuest Marker reports</title>
<link rel="icon" href="${ICON}">
<style>
  :root {
    --bg: #f2e9d4;
    --panel: #fbf6ea;
    --text: #2b2118;
    --muted: #6a5842;
    --border: #cbb58c;
    --accent: #8a5a12;
    --accent-text: #fbf6ea;
    --field: #fffdf7;
    --ok: #2f6630;
    --ok-bg: #e6f0dc;
    --error: #972c24;
    --error-bg: #f6e0da;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14100b;
      --panel: #1e1811;
      --text: #ebe0c9;
      --muted: #a6957a;
      --border: #4b3c28;
      --accent: #dcae55;
      --accent-text: #1a140d;
      --field: #120e0a;
      --ok: #9ccc8f;
      --ok-bg: #1d2a18;
      --error: #eb9a8e;
      --error-bg: #34170f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 780px; margin: 0 auto; padding: 40px 16px 56px; }
  h1, h2 {
    font-family: Georgia, "Palatino Linotype", "Book Antiqua", serif;
    color: var(--accent);
    font-weight: normal;
    margin: 0;
  }
  h1 { font-size: 2rem; line-height: 1.2; }
  h2 { font-size: 1.25rem; margin-bottom: 12px; }
  .eyebrow {
    margin: 0 0 6px;
    color: var(--muted);
    font-size: 0.8rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .lead { margin: 12px 0 28px; color: var(--muted); max-width: 62ch; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: inset 0 0 0 3px var(--panel), inset 0 0 0 4px var(--border);
    padding: 22px 24px;
    margin-bottom: 20px;
  }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
  .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; }
  .stat-value {
    display: block;
    font-family: Georgia, "Palatino Linotype", serif;
    font-size: 1.7rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .stat-label { color: var(--muted); font-size: 0.85rem; }
  ol { margin: 0; padding-left: 1.3em; }
  li + li { margin-top: 4px; }
  code, kbd {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
    background: var(--field);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
  }
  label { display: block; font-weight: 600; margin-bottom: 8px; }
  textarea {
    width: 100%;
    min-height: 240px;
    resize: vertical;
    padding: 12px;
    background: var(--field);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
  button {
    font: inherit;
    border-radius: 4px;
    padding: 8px 18px;
    cursor: pointer;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
  }
  button.primary { background: var(--accent); color: var(--accent-text); font-weight: 600; }
  button:disabled { opacity: 0.6; cursor: progress; }
  .hint { color: var(--muted); font-size: 0.85rem; }
  .result { margin-top: 18px; padding: 14px 16px; border-radius: 4px; border: 1px solid; }
  .result.ok { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .result.error { color: var(--error); background: var(--error-bg); border-color: var(--error); }
  .result p { margin: 0; font-weight: 600; }
  .result ul { margin: 8px 0 0; padding-left: 1.2em; font-weight: normal; }
  .result li { overflow-wrap: anywhere; }
  footer { color: var(--muted); font-size: 0.85rem; }
  footer p { margin: 0 0 8px; }
  a { color: var(--accent); }
  @media (max-width: 560px) {
    .stats { grid-template-columns: 1fr; }
    .panel { padding: 18px 16px; }
  }
</style>
</head>
<body>
<main>
  <p class="eyebrow">ForeverQuest Marker</p>
  <h1>Community quest reports</h1>
  <p class="lead">Help tell the quests that are new in WoW Forever apart from the original Classic ones.
  Paste the addon's export below. A quest is added to the addon's data once several players report it independently.</p>

  <section class="stats" aria-label="Report statistics">
    <div class="stat"><span class="stat-value" id="stat-confirmed">-</span><span class="stat-label">new quests confirmed by reports</span></div>
    <div class="stat"><span class="stat-value" id="stat-pending">-</span><span class="stat-label">candidates waiting for more reports</span></div>
    <div class="stat"><span class="stat-value" id="stat-reporters">-</span><span class="stat-label">contributing installations</span></div>
  </section>

  <section class="panel">
    <h2>How to submit</h2>
    <ol>
      <li>In game, type <code>/fqm export</code>.</li>
      <li>Click into the export window, press <kbd>Ctrl</kbd>+<kbd>A</kbd> to select everything, then <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy it (<kbd>Cmd</kbd> on macOS).</li>
      <li>Paste it below and submit. Submitting again later is fine: your earlier reports are updated, not counted twice.</li>
    </ol>
  </section>

  <section class="panel">
    <form id="submit-form" novalidate>
      <label for="export-text">Export text</label>
      <textarea id="export-text" name="export" spellcheck="false" autocomplete="off"
        placeholder='{"format":"ForeverQuestMarker","version":1, ...}'></textarea>
      <div class="actions">
        <button type="submit" class="primary" id="submit-button">Submit report</button>
        <button type="button" id="clear-button">Clear</button>
        <span class="hint">Up to 2 MB and 5000 quests per export.</span>
      </div>
    </form>
    <div id="result" class="result" role="status" aria-live="polite" hidden></div>
  </section>

  <footer>
    <p>The export contains quest IDs, titles, levels, quest givers and map positions, plus a random installation ID.
    It contains no character, realm or account names. Your IP address is only kept as a keyed hash, to limit abuse
    and to count independent reports.</p>
    <p>Data: <a href="/api/confirmed">confirmed quests (JSON)</a> and <a href="/api/stats">statistics (JSON)</a>.</p>
  </footer>
</main>
<script src="/app.js" defer></script>
</body>
</html>
`;

export const PAGE_SCRIPT = `"use strict";
(() => {
  const MAX_BYTES = 2097152;
  const MAX_LINES = 20;
  const form = document.getElementById("submit-form");
  const input = document.getElementById("export-text");
  const submit = document.getElementById("submit-button");
  const clear = document.getElementById("clear-button");
  const result = document.getElementById("result");

  const number = (value) => (typeof value === "number" ? value.toLocaleString() : "-");
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  function loadStats() {
    fetch("/api/stats")
      .then((response) => (response.ok ? response.json() : null))
      .then((stats) => {
        if (!stats) return;
        setText("stat-confirmed", number(stats.candidates.confirmed));
        setText("stat-pending", number(stats.candidates.pending));
        setText("stat-reporters", number(stats.reporters));
      })
      .catch(() => {});
  }

  function show(kind, title, lines) {
    result.hidden = false;
    result.className = "result " + kind;
    result.replaceChildren();
    const heading = document.createElement("p");
    heading.textContent = title;
    result.appendChild(heading);
    if (lines.length > 0) {
      const list = document.createElement("ul");
      for (const line of lines) {
        const item = document.createElement("li");
        item.textContent = line;
        list.appendChild(item);
      }
      result.appendChild(list);
    }
  }

  function successLines(data) {
    const c = data.categories;
    const lines = [
      data.received + " quests received: " + data.inserted + " new, " + data.updated + " updated, " +
        data.unchanged + " unchanged.",
      "Possible new Forever quests: " + c.candidate + ". Already known new quests: " + c.known +
        ". Original Classic quests: " + c.classic + ".",
    ];
    if (c.sod + c.era > 0) lines.push("Quests from other Classic clients (not new): " + (c.sod + c.era) + ".");
    if (data.confirmed.length > 0) {
      lines.push("Your report confirmed new quests: " + data.confirmed.join(", ") + ".");
    }
    lines.push("Receipt: " + data.submissionId);
    return lines;
  }

  function errorLines(data) {
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const lines = errors.slice(0, MAX_LINES).map((error) => (error.path ? error.path + ": " : "") + error.message);
    const hidden = errors.length - MAX_LINES;
    if (hidden > 0 || data.truncated) lines.push("...and more errors.");
    return lines;
  }

  async function send(body) {
    submit.disabled = true;
    submit.textContent = "Submitting...";
    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        show("ok", "Thank you, your report was saved.", successLines(data));
        loadStats();
      } else if (response.status === 400) {
        show("error", "The export was rejected and nothing was saved.", errorLines(data));
      } else {
        show("error", data.message || "The submission failed (HTTP " + response.status + ").", []);
      }
    } catch {
      show("error", "Could not reach the server. Check your connection and try again.", []);
    } finally {
      submit.disabled = false;
      submit.textContent = "Submit report";
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (body.length === 0) {
      show("error", "Paste the export text first.", []);
      return;
    }
    if (new TextEncoder().encode(body).length > MAX_BYTES) {
      show("error", "The export is larger than 2 MB. Export fewer quests and try again.", []);
      return;
    }
    try {
      JSON.parse(body);
    } catch {
      show("error", "This is not a complete export.", [
        "In game, click into the export window, press Ctrl+A, then Ctrl+C, and paste again.",
      ]);
      return;
    }
    send(body);
  });

  clear.addEventListener("click", () => {
    input.value = "";
    result.hidden = true;
    input.focus();
  });

  loadStats();
})();
`;
