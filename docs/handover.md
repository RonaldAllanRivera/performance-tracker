# Discord handover message

*Posted to the tech channel; kept in the repo so it stays with the code.*

---

hey — shipped the campaign video tracker, repo's here: `performance-tracker`

**what it is:** reads the tracking sheet ops maintains, pulls yesterday's stats
for every video, stores a daily snapshot in Mongo, works out what changed, and
posts a plain-english digest to #campaign-reports at 9am. runs on a GitHub
Actions cron.

**if you want to see it work,** clone it and run `npm i && npm run job:dry` —
that runs the whole pipeline on fixture data with no credentials and prints
exactly what it would've posted. easiest way to get your bearings.

**three things before you touch it:**

- the job only ever *reads* the sheet, never writes to it. please keep it that
  way — if it wrote back, a job write and someone editing a row at the same time
  would silently clobber their edit.
- alert thresholds live in `src/rules.ts`, not in the logic. if the digest is
  too noisy or too quiet, change the numbers there. they're my guesses, not
  calibrated on real data, so expect to tune them.
- the AI only writes the sentences. every number is computed and unit-tested in
  `analyze.ts`. if a figure looks wrong, it's a bug in there and you can prove it
  in a test — don't go looking at the prompt.

**still unfinished:** tiktok isn't ingested (no free stats API — links get
validated and reported as pending so nobody assumes they're tracked). no retries,
so a transient API blip = a missing day for that video. and there's no heartbeat
yet, which is the one that actually bugs me: if the cron dies, a missing report
looks identical to a quiet morning. that's next.

**if the digest looks weird,** check the footer first — it says whether the
summary came from the AI or the template. "template" for several days running
means the OpenAI key or the API is the problem, not the data.

happy to walk anyone through it, just ping me 🙏
