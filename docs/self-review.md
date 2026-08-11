# Self-review

*Submitted via the Google Form; kept in the repo so it stays with the code.*

## What's strong

**The analysis is deterministic and the AI is kept away from it.** Every number,
comparison, and anomaly decision happens in pure functions under unit test. The
model only phrases an object that is already correct. That boundary is why the
fallback is honest instead of embarrassing — a model outage costs fluency, not
accuracy.

**The anomaly rules are tuned for being read, not for being clever.** A
percentage-only spike rule flags a video going from 4 to 7 views. A stall rule
based on state instead of transition re-alerts on every finished video every
morning, forever. Both would have turned this into noise inside a week, and the
tests that assert an alert does *not* fire are the ones I care most about.

**Nothing fails silently.** Bad rows, unsupported links, deleted videos, hidden
statistics, and platform outages all end up in the same Discord message as the
good news, naming the sheet row to fix. A separate errors channel is a channel
that gets muted.

**It runs on a fresh clone with no credentials.** `npm i && npm run job:dry`
executes the entire pipeline against fixtures — through the same validation and
the same response parser as the live path — and prints the exact Discord payload.

## What's weak

- **The thresholds are guesses.** I never saw real campaign data. They are
  isolated in `rules.ts` so they're cheap to change, but that isolates the
  problem rather than solving it.
- **No retries.** A transient API blip means no snapshot for that video that
  day. The gap is handled correctly downstream — rate-based flags are suppressed
  across a multi-day gap rather than reporting three days of growth as a spike —
  but the data is still missing.
- **Snapshot lookups are one query per video.** Fine at a few hundred videos,
  worth batching before a few thousand.
- **MongoStore itself is untested.** The idempotency guarantee rests on the
  unique index on `(videoId, date)`; I verified it by running the job twice and
  checking the collection count, not in CI.
- **TikTok is a stub**, and TikTok is plausibly half the real workload.

## With another day

A heartbeat first (see below), then threshold calibration against two weeks of
real data. Then TikTok — and I would push to buy a data provider rather than
maintain scrapers, because at agency scale the subscription is a rounding error
against an engineer-day a month of unblocking them.

## If I only had two hours

Cut the LLM digest, the tests, and the Sheet integration, and hardcode an array
of video IDs. Keep fetch → store → Discord. The daily loop arriving end-to-end
is the product; everything else is refinement on top of a thing that works.

## One alternative I seriously considered

**Building it in n8n or Make instead of writing code.** Content Lab clearly runs
on workflow automation, I would have had a first version faster, and ops could
have edited it without me.

I chose code because the part that actually matters here is the anomaly logic,
and I want that unit-tested, diffable, and reviewable in a pull request.
Threshold tuning inside a visual editor is invisible in version control, and
"why does it alert on this?" becomes unanswerable six months later.

**Where I'd flip:** if this were pure glue with no business logic — new Typeform
row → Notion page → Slack ping — n8n wins outright and I would not write code
for it. The deciding question is whether there is a rule worth testing, not
whether the task is an integration.

## What I'd monitor first

1. **Age of the last successful run.** Everything else is secondary to this.
2. **The AI fallback rate.** The embed footer names the writer. If it says
   "template" for a week, model calls are failing and the report still arrives
   every morning looking perfectly fine.
3. Counts of unavailable / hidden / skipped rows per run. A jump means something
   changed upstream, not that ten creators deleted their videos overnight.
4. YouTube API error rate and quota headroom.

## What would make me uncomfortable about shipping this today

**Silent failure is indistinguishable from a quiet day.** If the cron breaks — or
if GitHub disables the schedule, which it does for repositories that go quiet for
60 days — nobody finds out, because a missing digest looks exactly like a morning
with no news. The system has no heartbeat, and the watcher has no watcher. The
failure mode of a daily report is not that it says something wrong; it's that it
stops saying anything and everyone assumes things are fine. This is the first
thing I would fix, and it is the thing I would be nervous about on day one.

**Nothing validates the AI's prose against the numbers.** The template fallback
protects against the model being unavailable, not against it being wrong. Ops may
well paste a sentence from this straight into a client update. I would assert
that every figure in the generated text appears in the computed stats, and drop
to the template if it doesn't.

**The thresholds are guesses, and trust is spent quickly.** If they're badly
calibrated, ops stops reading the digest within two weeks — and a distrusted
alert is worse than no alert, because it costs attention every morning and
returns nothing.
