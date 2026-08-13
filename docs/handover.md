# Discord handover message

*The message I'd post in the tech channel. Kept here so it stays with the code.*

---

hey 👋 finished the campaign video tracker — repo is `performance-tracker`

**what it does:** every morning it reads the tracking sheet ops keeps, pulls the
view counts for each video from YouTube, compares them to yesterday, saves
today's numbers, and posts a short summary to #campaign-reports. runs by itself
on GitHub Actions.

**quickest way to see it:** clone it and run

```
npm install && npm run job:dry
```

that runs everything on fake data — no API keys needed — and prints exactly what
it would have posted. takes about 30 seconds.

**3 things to know before you change anything:**

**1. it only reads the sheet, never writes to it.** please keep it that way. if
the job wrote to the sheet at the same moment someone was editing a row, their
edit would just disappear.

**2. the alert settings are in `src/rules.ts`.** if the reports are too noisy or
too quiet, change the numbers in that file — not the logic. fair warning, those
numbers are my guesses. we should tune them once we have a couple weeks of real
data.

**3. the AI only writes the sentences, not the numbers.** all the maths is in
`analyze.ts` and it's unit tested. so if a number looks wrong, it's a bug in
that file — don't go digging through the AI prompt.

**what's not done yet:**

- **tiktok** — there's no free official API for TikTok view counts. tiktok links
  in the sheet get checked and reported as "pending" so nobody assumes they're
  being tracked, but the numbers aren't there.
- **no retries** — if YouTube times out, that video just has no data for the day.
- **no heartbeat** — this is the one that bothers me. if the scheduled job stops
  running, nobody finds out, because a missing report looks exactly like a quiet
  morning. it already skipped runs twice while I was building it. next on my
  list.

**if a report looks off:** check the small text at the bottom of the Discord
message. it says whether the summary was written by the AI or by the backup
template. if it says "template" several days in a row, the OpenAI key or the API
is the problem — the numbers are still correct either way.

happy to walk anyone through it, just ping me 🙏
