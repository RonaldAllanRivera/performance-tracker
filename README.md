# Campaign Video Performance Tracker

[![Daily campaign video report](https://github.com/RonaldAllanRivera/performance-tracker/actions/workflows/daily.yml/badge.svg)](https://github.com/RonaldAllanRivera/performance-tracker/actions/workflows/daily.yml)

Every morning before 09:00 Manila time — [both the time and the timezone are
configurable](#scheduling) — this posts a plain-English summary of how every
creator video in every live campaign performed yesterday, and flags the ones a
human should actually look at, into Discord.

---

## The problem

When a campaign is running, someone on ops has to know how the creator videos
are doing. Today that means opening each link, copying the view count into a
sheet, comparing it against what it said yesterday, and noticing by eye that one
video has taken off and another has quietly died. With a few dozen videos across
a few campaigns, that is a genuine chunk of a morning, every morning, and it is
the kind of task where the important thing — *that one video is suddenly doing
5× its normal numbers* — is the thing most easily missed while doing the boring
part.

This does the boring part on a schedule and says the important part out loud.

## What it does

Once a day it reads the tracking sheet ops already maintains, fetches yesterday's
numbers for every video, compares them against the last time it looked, records
today's numbers, decides which changes are worth a human's attention, writes a
short summary in plain English, and posts it to Discord — along with a list of
anything in the sheet that needs fixing.

**The report is exception-based, not a data dump.** It gives totals, a line per
campaign, anything flagged, and the three biggest individual movers. It does not
list every video every day: nine videos would be readable, two hundred would not,
and the anomaly you need to act on would be buried in the middle of them. The
full history lives in Mongo for anyone who wants to query it.

**Why there is a database at all:** the YouTube API only ever reports *today's*
number. It has no memory. "406,326,796 views" is not actionable; "+12,400 since
yesterday" is. Every delta and every flag in this system is a comparison against
a stored snapshot — without storage the tool degrades into a slow way of reading
numbers you could see by opening the video.

It is designed so that nothing in that chain can fail silently, and so that one
broken video, one bad row, or one platform outage never costs you the rest of
the report.

### What it looks like

![The daily report as it arrives in Discord](docs/discord-report.jpg)

Anomalies first, then how each campaign did, then the individual movers, then
anything in the sheet that needs fixing. The footer names which writer produced
the summary, so a run of "template" is visible without needing metrics.

## Architecture

```mermaid
flowchart LR
    Sheet[("Google Sheet<br/>ops-owned tracking list")]
    Cron{{"GitHub Actions<br/>cron, 09:00 PHT"}}
    Job["Daily job<br/><i>src/job.ts</i>"]
    YT["YouTube Source<br/>Data API v3, batched"]
    TT["TikTok Source<br/><i>stub — roadmap</i>"]
    Analyze["Analyzer<br/>deltas + anomaly flags<br/><i>pure, unit-tested</i>"]
    Mongo[("MongoDB<br/>snapshots")]
    Digest["Digest writer<br/><i>LLM — prose only</i>"]
    Template["Template writer"]
    Discord["Discord webhook"]

    Cron --> Job
    Sheet -->|"read only, never written"| Job
    Job --> YT
    Job -.->|"not implemented yet"| TT
    YT --> Analyze
    Mongo -->|"yesterday's snapshot"| Analyze
    Analyze -->|"today, idempotent upsert"| Mongo
    Analyze --> Digest
    Digest -.->|"on any failure"| Template
    Digest --> Discord
    Template --> Discord
```

### The three decisions worth knowing about

**A Google Sheet is the input, not a web UI.** Ops already lives in Sheets. A
bespoke internal tool is one more thing to log into, and internal tools nobody
logs into quietly rot. The tradeoff is that there is no validation at entry
time — so validation happens on read, and every rejected row is reported back in
the Discord message, naming the row number to fix. Feedback lands where ops
already looks.

**The job never writes to the sheet.** If it did, a job write and a human edit
could land at the same moment and the human would silently lose their row. The
sheet is the source of truth for *what to track*; Mongo is the source of truth
for *history*. Those two never overlap, so they can never disagree.

**The LLM never touches a number.** Every figure, every comparison, and every
anomaly decision is computed in [`src/analyze.ts`](src/analyze.ts) —
deterministically, in pure functions, under unit test. The model receives an
object that is already correct and its only job is to phrase it. That is why the
fallback is honest rather than embarrassing: if the model call fails, a template
renders the same facts from the same object, and the report still goes out with
identical numbers.

### Main components

| File | What it does |
|---|---|
| [`src/job.ts`](src/job.ts) | Orchestrates the pipeline. Owns the error philosophy. |
| [`src/inputs/sheet.ts`](src/inputs/sheet.ts) | Reads the tracking sheet; turns bad rows into warnings. |
| [`src/inputs/urls.ts`](src/inputs/urls.ts) | Pure URL parsing. One of two places untrusted input enters. |
| [`src/sources/youtube.ts`](src/sources/youtube.ts) | YouTube Data API v3, batched 50 ids per call. |
| [`src/sources/tiktok.ts`](src/sources/tiktok.ts) | Documented stub. Explains the tradeoff and the plan. |
| [`src/analyze.ts`](src/analyze.ts) | **The only module that decides anything.** Pure, tested. |
| [`src/rules.ts`](src/rules.ts) | The thresholds, in one place, tunable without touching logic. |
| [`src/storage.ts`](src/storage.ts) | Mongo snapshots + an in-memory twin for dry runs. |
| [`src/digest.ts`](src/digest.ts) | LLM prose with a deterministic template fallback. |
| [`src/notifiers/discord.ts`](src/notifiers/discord.ts) | Builds and posts the embed. |

`Source` and `Notifier` are the extension points. Instagram becomes another
`Source`; Slack becomes another `Notifier`. Both interfaces have exactly one
method, deliberately — there are two platforms and one channel, and a plugin
framework with registration and lifecycle hooks would be more impressive and
less useful.

---

## Running it

### See it work right now — no credentials, no database, no network

```bash
npm install
npm run job:dry
```

That runs the **entire** pipeline against fixture data and prints the exact
Discord payload it would have posted. The fixtures go through the same
validation and the same response parser as the live path, and they deliberately
cover a spike, a stall, ordinary growth, a deleted video, a video with hidden
statistics, a brand-new video, a pending TikTok link, and three rows that should
be rejected.

```bash
npm test          # 44 tests
npm run typecheck
npm run check:env # validates .env offline once you have credentials
```

### Running it for real

1. **Create the tracking sheet.** Import [`docs/Tracked.csv`](docs/Tracked.csv)
   into a new Google Sheet via **File → Import → Insert new sheet(s)**; the tab
   lands named `Tracked`, which is the range the job reads. Ops adds a row per
   video from then on — video URL, campaign, creator — and nothing else is
   asked of them.

2. **Set up credentials.** `cp .env.example .env` and fill it in.
   **[`docs/setup.md`](docs/setup.md) is a click-by-click walkthrough** of all
   five, written for someone who has never opened Google Cloud or Atlas — it
   covers the step everyone misses (sharing the sheet with the service account)
   and has a troubleshooting table for the errors whose messages don't say what
   is actually wrong.

3. **Run it.**

   ```bash
   npm run job
   ```

### Scheduling

There are **two separate knobs**, and it's worth knowing why they aren't one:

| Knob | Where | Controls |
|---|---|---|
| `TIMEZONE` | `.env` | Which calendar day a run is recorded against, and the date on the report |
| `cron` | [`.github/workflows/daily.yml`](.github/workflows/daily.yml) | What time the job actually fires |

The firing time can't live in `.env`, because GitHub parses the `on: schedule:`
block before any environment exists. The workflow file has a conversion table in
its comments — the rule is `UTC hour = local hour − that zone's UTC offset`.

It is set to `35 0 * * *` — 08:35 Manila — rather than a round 09:00, and that
is deliberate. GitHub's scheduler is best-effort and most congested on the hour;
the first run scheduled for 01:00 UTC never fired at all. An odd minute in a
quieter slot avoids the stampede, and starting early means a typical delay still
lands the report before 9am instead of after it.

`TIMEZONE` accepts any IANA zone name and is validated at startup, so a typo
fails immediately with an explanation instead of quietly filing every snapshot
under the wrong day. The job logs which zone it resolved:

```
[job] starting run for 2026-08-11 — Asia/Manila (UTC+8, local time 09:00)
```

Runs can also be triggered by hand from the Actions tab (`workflow_dispatch`),
which is how you test without waiting for tomorrow. Secrets use the same names
as `.env`. A failed run exits non-zero and shows up red.

Tests run before the pipeline in CI: it costs 400ms and means we never post
numbers produced by broken logic.

> Two caveats worth knowing. GitHub's cron has no DST awareness, so zones that
> observe DST drift by an hour twice a year — Manila doesn't, which is one
> reason it's a clean default. And scheduled runs are genuinely unreliable:
> they are delayed under load and sometimes skipped without notice. Moving off
> the hour improves the odds; only a heartbeat actually tells you when a run
> was missed, which is why that leads the roadmap.

---

## Stack and dependencies

TypeScript on Node 22, run directly with `tsx` — no build step. Vitest for tests.

Three runtime dependencies, and each one earns its place:

| Dependency | Why |
|---|---|
| `mongodb` | Official driver. Snapshot history needs a real datastore with a unique index. |
| `google-auth-library` | Service-account JWTs are RS256-signed. Hand-rolling that is a bad idea. |
| `dotenv` | Local `.env` loading. |

Everything else talks HTTP over native `fetch`: four APIs, four fetch calls. The
full `googleapis` package would have been ~50MB of transitive surface for a
single `spreadsheets.values.get`.

---

## Assumptions I made

1. **YouTube first.** TikTok has no free official API for public video stats, so
   TikTok links are validated and reported as pending rather than ingested.
   [`src/sources/tiktok.ts`](src/sources/tiktok.ts) has the full reasoning.
2. **Daily granularity is enough.** Ops reviews this in the morning; hourly
   polling would multiply cost and quota for a number nobody acts on faster.
3. **Internal and trusted.** No auth on anything. The sheet is shared with the
   team, the Discord channel is internal, and the job runs in CI.
4. **The sheet is the source of truth for what to track.** Deleting a row stops
   tracking; history for that video stays in Mongo.
5. **Editing a row's campaign or creator applies from that day forward, not
   retroactively.** The previous-snapshot lookup keys on `videoId` alone, so
   changing metadata never disturbs the deltas — a typo fix cannot corrupt the
   numbers. But past snapshots keep the attribution they had at the time,
   because a snapshot records what was true on that day and rewriting it would
   falsify the record. Each daily report is internally consistent since it only
   uses that day's attribution; a renamed campaign would only look odd in
   historical charts, which don't exist yet.
6. **View count is the primary metric.** Likes and comments are recorded and
   reported, but anomaly detection keys on views. Creators can hide likes
   independently, so treating them as primary would produce phantom alerts.
7. **The thresholds in `rules.ts` are starting guesses**, not calibrated against
   real campaign data. See the honesty note below.

## Questions I would have asked

The brief said to note anything whose answer would genuinely have changed the
build. Three would have:

1. **"Who reads this, and what do they do differently because of it?"** I built
   a daily anomaly alert. If the real need is end-of-campaign reporting to
   clients, this should be a weekly rollup and the anomaly detection is largely
   wasted work.
2. **"Do campaigns already live in Monday.com?"** I assumed a Sheet. If Monday
   is already the system of record, then building on a Sheet creates a second
   list that drifts from the first, and the right build is a Monday integration.
3. **"What is the actual TikTok/YouTube split?"** I built YouTube first because
   it has a clean free API. If the real mix is 80% TikTok, I built the wrong
   half and the entire budget should have gone into the scraping problem
   instead.

## What I deliberately left out

A web UI, auth, retry/queue infrastructure, TikTok scraping, Slack, historical
charts, Docker, and tests on anything that is pure I/O. Tests cover
[`analyze.ts`](src/analyze.ts) (the only module that decides anything),
[`urls.ts`](src/inputs/urls.ts) (where untrusted input enters), and the storage
contract. Everything else would have needed mocking into meaninglessness.

## What I would build next

1. **A heartbeat.** The most important missing piece — see below.
2. **TikTok ingestion**, almost certainly by buying a data provider rather than
   maintaining scrapers. At agency scale the cost is a rounding error against an
   engineer-day a month of unblocking them.
3. **Threshold calibration** against two weeks of real data, replacing my guesses.
4. **Per-campaign routing**, so each campaign's digest goes to its own channel.
5. **Batched snapshot lookups.** Currently one query per video; fine at a few
   hundred, worth fixing before a few thousand.

## Running this in production

Secrets would move out of Actions into whatever the company already uses, and
I'd add automated secret scanning to CI — a placeholder connection string in
these docs was enough to trip GitGuardian, which is exactly the sort of alert
that gets muted if it fires on things that aren't real. Examples in the setup
guide are now structurally invalid so a scanner can tell them apart from the
real thing. The
job itself is a single command, so it runs equally well as a systemd timer on
the VPS if scheduling should not depend on GitHub. First things to monitor, in
order:

1. **Age of the last successful run.** Everything else is secondary. The badge
   at the top of this README shows the last run's *result*, which is not the
   same thing — a schedule that stops firing altogether leaves the badge green
   and the digest silent.
2. **The AI fallback rate.** The embed footer says which writer produced the
   summary; if it reads "template" for a week, the model calls are failing and
   the report still arrives every morning looking fine.
3. Counts of unavailable / hidden / skipped rows per run — a jump usually means
   something changed upstream, not that ten creators deleted their videos.
4. YouTube API error rate.

### This repo is public

Deliberately — it's a portfolio piece. Three things make that safe:

- **No credential is committed.** `.env*` is gitignored with `.env.example` as
  the single exception, as are service-account key files. Verified against the
  real values: none of the cluster host, sheet id, API key, webhook id, or key
  material appears anywhere in history.
- **Secrets live in GitHub Actions secrets**, which GitHub redacts from workflow
  logs and never exposes to builds from forked pull requests. The workflow only
  triggers on `schedule` and `workflow_dispatch` — no `pull_request_target`, no
  `workflow_run` — so code from outside the repo never runs with them.
- **Secrets are scoped to the one step that needs them.** `npm ci` and `npm test`
  run without any credentials in their environment, so a compromised dependency's
  install script has nothing to find. Only `npm run job` gets them.
- **Review access is read-only.** A collaborator with write access could push a
  workflow that prints every secret to a public log; a reader cannot.
- **The job logs identifiers truncated.** Public repo means public Actions logs.
  Redaction relies on exact string matching and misses encoded forms, so the
  sheet id is logged as its first six characters.

Every credential is a single environment variable, which makes rotation routine
rather than an emergency — the response to any suspected exposure is to reissue
one value in two places.

### What would make me uncomfortable about shipping this today

**Silent failure is indistinguishable from a quiet day.** If the cron breaks —
or if GitHub disables the schedule, which it does for repositories that go quiet
for 60 days — nobody finds out, because a missing digest looks exactly like a
morning with no news. The system has no heartbeat, and the watcher has no
watcher. This is the first thing I would fix.

**Nothing validates the AI's prose against the numbers.** The template fallback
protects against the model being *unavailable*, not against it being *wrong*.
Ops may well paste a sentence from this into a client update. I would add an
assertion that every figure appearing in the generated text also appears in the
computed stats, and fall back to the template if it does not.

**The thresholds are guesses.** I picked +50% and a 100-view floor without ever
seeing real campaign data. If they are badly calibrated, ops stops trusting the
alerts within two weeks — and a distrusted alert is worse than no alert at all.

---

## Also in this repo

- **[`docs/setup.md`](docs/setup.md)** — click-by-click credential setup and a
  troubleshooting table.
- **[`docs/self-review.md`](docs/self-review.md)** — what's strong, what's weak,
  the alternative I rejected, and what would worry me in production.
- **[`docs/handover.md`](docs/handover.md)** — the message I'd post to the tech
  channel.

## How AI was used

Honestly, and specifically:

- **Architecture, scoping, and every judgment call in this README are mine.**
  The decision to cut the web UI in favour of a Sheet, the Source/Notifier
  boundaries, keeping the model away from the arithmetic, and what to leave out
  were the actual work.
- **I used Claude heavily as an implementation partner** — drafting modules
  against my structure, writing test cases around rules I specified, and talking
  through tradeoffs. It is genuinely faster at turning a decided design into
  typed code than I am.
- **Two things it got wrong that mattered**, both caught by reading output
  rather than reading code:
  - The first anomaly rules were percentage-only. A video going from 4 to 7
    views is a "+75% spike", and a stall rule based on *state* rather than
    *transition* re-alerts on every finished video every morning forever. Both
    would have made the digest noise within a week. Fixed with an absolute
    floor and transition detection — that is what the two "does NOT flag" tests
    in [`tests/analyze.test.ts`](tests/analyze.test.ts) exist to protect.
  - The first version reported a deleted video as `(untitled) — no longer
    viewable`, because the API returns no title for a video that is gone. I
    only noticed by running the dry run and reading it as an ops person would.
    The title is now carried forward from the last snapshot that had one.
- **The LLM inside the product** does exactly one thing: turn a verified object
  into a sentence. It never calculates, and if it is unavailable the report
  still goes out. That boundary was a deliberate design choice, not a
  limitation I ran into.
