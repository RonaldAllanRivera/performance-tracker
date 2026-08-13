# Discord handover message

*The message I'd post in the tech channel. Kept here so it stays with the code.*

---

Hey 👋 Finished the campaign video tracker.

Repo: https://github.com/RonaldAllanRivera/performance-tracker
The sheet it reads: https://docs.google.com/spreadsheets/d/1PcktR73Hsn8p6Rw1gMEEBXNQweVy9aAFd-74cHqAJaM/edit?usp=sharing

**What it does:** every morning it reads that tracking sheet, pulls the view
counts for each video from YouTube, compares them to yesterday, saves today's
numbers, and posts a short summary to #campaign-reports. Runs by itself on
GitHub Actions.

The sheet is the only thing ops touches — one row per video, and the notes
column says what each row is there to exercise if you're poking at it.

**Quickest way to see it:** clone it and run

```
npm install && npm run job:dry
```

That runs everything on fake data — no API keys needed — and prints exactly what
it would have posted. Takes about 30 seconds.

**3 things to know before you change anything:**

**1. It only reads the sheet, never writes to it.** Please keep it that way. If
the job wrote to the sheet at the same moment someone was editing a row, their
edit would just disappear.

**2. The alert settings are in `src/rules.ts`.** If the reports are too noisy or
too quiet, change the numbers in that file — not the logic. Fair warning, those
numbers are my guesses. We should tune them once we have a couple of weeks of
real data.

**3. The AI only writes the sentences, not the numbers.** All the maths is in
`src/analyze.ts` and it's unit tested. So if a number looks wrong, it's a bug in
that file — don't go digging through the AI prompt.

**What's not done yet:**

- **TikTok** — there's no free official API for TikTok view counts. TikTok links
  in the sheet get validated and reported as "pending" so nobody assumes they're
  being tracked, but the numbers aren't there.
- **No retries** — if YouTube times out, that video just has no data for the day.
  The next day's report handles the gap correctly, but the data is still missing.
- **No heartbeat** — this is the one that bothers me. If the scheduled job stops
  running, nobody finds out, because a missing report looks exactly like a quiet
  morning. While I was building it GitHub skipped two scheduled runs entirely
  and then delivered the third 2.5 hours late, so this isn't hypothetical. Next
  on my list.

**If a report looks off:** check the small text at the bottom of the Discord
message. It says whether the summary was written by the AI or by the backup
template. If it says "template" several days in a row, the OpenAI key or the API
is the problem — the numbers are still correct either way.

Happy to walk anyone through it, just ping me 🙏
