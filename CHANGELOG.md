# Changelog

Three days of work, grouped by day rather than by version — there are no
releases yet, and the useful thing to see is how the build actually went.

The entries that matter most are under **Learned**: several assumptions in the
original design turned out to be wrong once real credentials, a real scheduler,
and a real spreadsheet were involved, and those corrections are the reason the
current version looks the way it does.

---

## 2026-08-13 — day 3

### Fixed
- **The sheet reader now reads a cell's hyperlink, not just its visible text.**
  Four rows silently stopped being tracked overnight with nobody having edited
  the sheet. Google Sheets had converted their pasted URLs into smart links: the
  cell displays the video's *title* and keeps the address only as link metadata,
  and the values API returns display text. Those rows read as "not a URL" and
  dropped out while looking perfectly normal to whoever pasted them. Now fetches
  grid data (still one request) and prefers the hyperlink in the URL column.
  Recovered the live sheet from 5 tracked videos back to 7 with no manual fix.

### Learned
- **The scheduler does fire — 2h36m late.** Yesterday's conclusion was that
  GitHub simply never ran the job. The next morning it did: scheduled 00:35 UTC,
  actual 03:11. So the scheduler is neither broken nor dependable, which is a
  more useful finding than either extreme, and one reasoning alone would not
  have produced. "Runs once a day" is a promise GitHub Actions can keep;
  "arrives before 9am" is not.

---

## 2026-08-12 — day 2

### Added
- **Per-campaign rollup in the daily report.** The sheet had a `campaign` column
  and every snapshot stored it, but nothing in the output ever used it — data
  collected and discarded, in a tool named after campaigns. Grouped by campaign
  and sorted by movement rather than size, because a daily report should lead
  with what changed today, not with the largest back catalogue.
- Workflow status badge, and a README section explaining why running this repo
  publicly is safe (secrets scoped to one step, no PR triggers, identifiers
  truncated in logs).
- The actual daily report screenshotted into the README, from a real run.

### Fixed
- Cron moved off 01:00 UTC, GitHub's most congested slot.
- The service-account key stored as base64 rather than raw JSON: GitHub masks
  each *line* of a multi-line secret separately, so the `{` and `}` lines became
  masks and every brace anywhere in the run log was replaced with `***` —
  including unrelated ones like `bash -e {0}`.
- `checkout@v4` / `setup-node@v4` → v5, silencing four Node 20 deprecation
  warnings per run.
- The digest call retries once and waits 45s instead of 20s. The first scheduled
  CI run had timed out against OpenAI and shipped the template.

### Learned
- **The first scheduled run never fired, and nothing said so.** No error, no red
  run, badge still green from the previous manual one. This is precisely the
  failure the self-review had already named as the most worrying — it arrived on
  day one, silently, and was found only by going to look.
- Editing a row's campaign or creator applies from that day forward, not
  retroactively. Deltas key on `videoId` alone, so a typo fix cannot corrupt the
  numbers, but a snapshot keeps the attribution it had at the time — rewriting
  it would falsify the record.

---

## 2026-08-11 — day 1

### Added
- The pipeline, end to end: Google Sheet → YouTube Data API → MongoDB snapshots
  → pure analyzer → LLM digest with template fallback → Discord embed, on a
  GitHub Actions cron.
- **Idempotent daily snapshots**, keyed `(videoId, date)` with a unique index —
  the guarantee enforced by the database rather than by the application
  remembering to be careful.
- **Anomaly detection** with a deliberate absolute floor on spikes and stalls
  detected as a *transition* rather than a state. A percentage-only rule flags a
  video going 4 → 7 views; a state-based stall rule re-alerts on every finished
  video every morning forever. Both would have made the digest noise inside a
  week.
- `Source` and `Notifier` interfaces, one method each, as the extension points
  for more platforms and more channels. Deliberately not a plugin framework.
- A **credential-free dry run** (`npm run job:dry`) that exercises the whole
  pipeline against fixtures — through the same validation and the same response
  parser as the live path — so a reviewer can see it work before requesting a
  single key.
- `npm run check:env`, an offline preflight that validates every credential's
  shape without a network call and without ever printing a secret.
- Configurable report timezone, validated at startup.
- Support for pointing at a service-account key *file* rather than pasting its
  contents.

### Fixed
- Carry the last known title forward when a video disappears. A deleted video
  returns no title, so the report said `(untitled) — no longer viewable`, which
  tells ops nothing about which video to go and look at. Found by running the
  dry run and reading the output as an ops person would, not by reading code.
- A `.gitignore` gap: `.env.*` matches only a dot separator, so `.env-sample`,
  `.env_prod` and `.envrc` were all committable.
- Stopped logging the full spreadsheet id — public repo means public Actions
  logs, and GitHub's redaction is an exact string match.

### Learned
- **The setup guide had six defects, all found by running it rather than
  reading it.** The worst was silent: shell examples embedded
  `<angle-brackets>`, which bash reads as input redirection, so the command
  failed and appended an *empty* credential.
- A credential copied out of a terminal is a credential that gets truncated —
  three times, at the same character. That is why the key can now be read from a
  file instead.
