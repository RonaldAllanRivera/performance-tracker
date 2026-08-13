# Self-review

*Submitted via the Google Form. Kept here so it stays with the code.*

## What's strong

**1. The AI never touches a number.**

All the maths happens in `src/analyze.ts` in plain functions with unit tests. The AI
only turns the finished numbers into sentences.

*Example:* the report says "Genshin Impact Q3 gained 15,679 views". My code
worked out 15,679 by subtracting yesterday's stored number from today's. The AI
only wrote the sentence around it. So if OpenAI is down, the report still goes
out with exactly the same numbers — it just reads a bit flatter.

**2. The alerts are tuned so people will actually read them.**

*Example:* a video going from 4 views to 7 is +75%, comfortably over my 50%
"spike" threshold — but it's only 3 extra views. My first version alerted on
exactly this, because it only looked at percentages. Now a spike also has to
clear 100 actual views, so it stays quiet. There's a test in
`tests/analyze.test.ts` that asserts the alert does *not* fire.

Same with "stalled" — my first version alerted on every finished video every
single morning, forever. Now it only alerts on the day a video stops growing.

**3. Problems show up in the report, not in a log file nobody opens.**

*Example:* if someone pastes a Vimeo link into row 11, the Discord message says
`Row 11: unsupported site "example.com"`. It names the row so ops knows exactly
what to fix. I put these in the same message as the good news on purpose — if
warnings went to a separate channel, people would mute it.

**4. Anyone can run it in 30 seconds with no passwords.**

```bash
npm install && npm run job:dry
```

That runs the whole thing on fake data and prints exactly what it would have
posted to Discord. No API keys needed. I did this because a reviewer with ten
minutes is not going to sign up for four services first.

## What's weak

**The alert thresholds are guesses.** I picked "+50% and at least 100 views"
without ever seeing real campaign data. They're all in one file (`src/rules.ts`) so
they're easy to change, but easy to change is not the same as correct.

**No retries when fetching data.** If YouTube times out, that video gets no
snapshot that day. Tomorrow's report handles the gap correctly, but the data is
still missing. The AI call does retry once; the data fetches don't, and they
should.

**One database query per video.** Fine for 100 videos. Should be batched before
it reaches a few thousand.

**I didn't test the database code itself.** The "no duplicates" guarantee comes
from a unique index in MongoDB. I checked it by running the job twice and
counting the rows, but that check isn't automated.

**TikTok isn't built.** There's no free official API for TikTok view counts, so
TikTok links are validated and reported as "pending" instead of tracked. That
could easily be half the real workload.

## With another day

1. A heartbeat that tells me when a run doesn't happen (explained at the bottom).
2. Tune the thresholds against two weeks of real data instead of guessing.
3. TikTok — and I'd argue for paying a data provider rather than writing
   scrapers. Scrapers break constantly, and a subscription costs less than an
   engineer fixing them once a month.

## If I only had two hours

I'd cut the AI summary, the tests, and the Google Sheet, and just hardcode a list
of video IDs. Keep: fetch stats → save them → post to Discord.

The point of the tool is that a message arrives every morning. Everything else
makes that message better, but none of it matters if the message doesn't arrive.

## One alternative I seriously considered

**Building it in Make.com instead of writing code.** I looked at Zapier too.

Content Lab clearly uses workflow automation, I'd have had something working
faster, and ops could have edited it without me. Make could genuinely do this
job — it has scheduling, HTTP modules for the YouTube API, and data stores to
keep yesterday's numbers so today's can be compared against them. Its scheduler
is also more dependable than GitHub Actions, which I found out the hard way when
mine skipped runs.

I chose code because the important part here is the alert logic, and I want that
tested. If I tune a threshold in a visual editor, there's no record of what I
changed or why — six months later nobody can answer "why did it alert on that?"
Both alert rules I got wrong on the first attempt were caught by tests, and
those tests still sit there stopping anyone reintroducing the same mistake.

**When I'd choose Make instead:** if there were no logic — for example "new
Typeform response → create a Notion page → post to Slack" — Make or Zapier wins
and I wouldn't write code at all. The question I ask is whether there's a rule
worth testing.

## What I'd monitor first

**1. How long since the last successful run.** More important than everything
else here.

**2. How often the AI summary fails.** The bottom of every Discord message says
whether the AI or the backup template wrote it. If it says "template" for a
week, the AI is broken — but the report still arrives every day looking fine, so
nobody would notice otherwise.

This already paid off. On the first scheduled run the AI call timed out and the
backup template wrote the summary instead. 20 seconds was plenty from my laptop,
but not from GitHub's servers in the US. Nothing broke and nobody would have
noticed. I changed it to 45 seconds with one retry.

**3. How many videos are skipped or unavailable each day.** A sudden jump usually
means something changed on YouTube's side, not that ten creators deleted their
videos overnight.

**4. YouTube API errors and quota.**

## What would make me uncomfortable about shipping this today

**The report going missing looks exactly like a quiet day.**

If the scheduled job stops running, nobody finds out. There's no error, because
nothing ran. The team just doesn't get a message, and assumes there was nothing
to report. That's the failure I'd worry about most — not the tool saying
something wrong, but the tool going quiet while everyone assumes it's fine.

**And it happened, three times, while I was building it.**

Day 1: the scheduled run never fired. No error, no failed build, the status badge
still green from a manual run I'd done earlier. I only found out because I went
looking.

I assumed the problem was timing — I'd scheduled it for 01:00 UTC, which is when
everyone schedules things. So I moved it to a quieter time. To test without
waiting a day, I added a second temporary schedule 30 minutes out. That one
didn't run either, and was still missing 56 minutes after it should have. At
that point I wrote in this document that GitHub simply wasn't running the job.

Day 3: it ran — **2 hours and 36 minutes late.** Scheduled for 08:35, arrived at
11:11.

So my first explanation was wrong, and I only found that out by watching it. The
real answer is that GitHub's scheduler isn't broken, it's just not punctual. It
runs the job eventually, whenever it gets around to it. Meanwhile every run I
triggered by hand finished in under 25 seconds, so nothing is misconfigured —
GitHub says in their own docs that scheduled runs are best-effort.

For a morning report, "eventually" isn't good enough. A digest people read with
their coffee is worth much less at lunchtime.

**What I'd do about it:** run the job from a normal Linux timer on the company's
own server, which fires on time and catches up if the machine was off. And build
the heartbeat — something outside this system that shouts when the daily message
doesn't arrive. That's no longer a nice-to-have; the thing it protects against
has now happened three times in three days.

**Nothing checks that the AI's sentences match the numbers.**

If OpenAI is down, the backup template takes over — that part is handled. But if
the AI is *up* and writes a wrong number, nothing catches it. Someone in ops
might paste that sentence into a client email. I'd add a check that every number
in the AI's text also exists in my calculated results, and fall back to the
template if it doesn't.

**If my guessed thresholds are wrong, people stop reading.**

Alerts only work while people trust them. If the tool cries wolf for two weeks,
everyone starts ignoring it — and then it's worse than having no alerts at all,
because it costs attention every morning and gives nothing back.
