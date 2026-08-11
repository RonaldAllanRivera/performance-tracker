# Setup: getting the credentials

Written assuming you have never touched Google Cloud, MongoDB Atlas, or Discord
webhooks before. Every step says what to click, what you should see, and what
goes wrong if you skip it.

> Every **credential** in this guide is a placeholder in `<angle-brackets>` —
> replace the brackets and their contents, and never paste one verbatim.
> Shell commands set a `KEY=...` variable first; edit that line, not the command.

**Time needed:** about 30 minutes.
**You need:** a Google account, a Discord server you can administer, and a
GitHub account.

> **You do not need any of this to see the tool work.** `npm install && npm run
> job:dry` runs the whole pipeline on fixture data with no credentials at all.
> Do that first — it will make the rest of this make more sense.

## What you're collecting

| Step | Variable | What it's for |
|---|---|---|
| 1 | `TIMEZONE` | Which day a run is recorded against. Just text — no signup. |
| 2 | *(none — Google Cloud project)* | Prerequisite for steps 3 and 4 |
| 3 | `YOUTUBE_API_KEY` | Reading view counts |
| 4 | `SHEET_ID` + service-account key | Reading the tracking sheet |
| 5 | `MONGO_URI` | Storing daily snapshots |
| 6 | `DISCORD_WEBHOOK_URL` | Posting the report |
| 7 | `OPENAI_API_KEY` | *Optional.* Nicer prose. Everything works without it. |

Start by copying the template:

```bash
cp .env.example .env
```

Open `.env` in an editor and fill each value in as you go.

---

## 1. Timezone

No signup. Open `.env` and set it to wherever the team reads the report:

```
TIMEZONE=Asia/Manila
```

It must be a full [IANA zone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
like `Asia/Manila`, `Europe/Berlin`, or `America/New_York`. Abbreviations like
`PHT` or `EST` are rejected at startup with an explanation.

**This does not control what time the report arrives** — only which calendar day
each run is filed under. The arrival time is a cron line in
[`.github/workflows/daily.yml`](../.github/workflows/daily.yml), which has a
conversion table in its comments.

---

## 2. Google Cloud project (needed for steps 3 and 4)

Both the YouTube key and the Sheets access live inside a Google Cloud *project*.
You make one project and use it for both.

1. Go to **https://console.cloud.google.com**, sign in.
2. If this is your first time, accept the terms. **You do not need to enable
   billing** for anything in this guide.
3. Click the **project dropdown** in the top bar (next to the "Google Cloud"
   logo) → **New Project**.
4. Name it something like `campaign-video-tracker` → **Create**.
5. Wait a few seconds, then make sure the project dropdown shows your new
   project. **Everything below happens inside it** — if you get mysterious
   permission errors later, this is the first thing to re-check.

### Turn on the two APIs

1. In the search bar at the top, type **YouTube Data API v3** → open it →
   click **Enable**.
2. Search again for **Google Sheets API** → open it → click **Enable**.

You should now see both listed under **APIs & Services → Enabled APIs**.

---

## 3. `YOUTUBE_API_KEY`

1. Go to **APIs & Services → Credentials** (left sidebar).
2. **+ Create credentials** → **API key**.
3. A key appears in a popup. Copy it into `.env`:

   ```
   YOUTUBE_API_KEY=<paste-your-key-here>
   ```

4. **Recommended:** click **Edit API key** in that popup (or the pencil icon in
   the list) → under **API restrictions** choose **Restrict key** → tick
   **YouTube Data API v3** → **Save**. This means a leaked key can't be used for
   anything else.

**About quota:** the default is 10,000 units/day. This tool spends 1 unit per
batch of 50 videos, so a daily run over 500 videos costs 10 units. You will not
run out.

---

## 4. `SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON`

This is the fiddliest step. A **service account** is a robot Google account that
the job logs in as. You create it, download its key, and then **share the sheet
with it** exactly like you'd share with a colleague.

### 4a. Create the tracking sheet

The repo ships a ready-made template: **[`docs/Tracked.csv`](Tracked.csv)**.

1. Go to **https://sheets.google.com** and create a new spreadsheet.
2. **File → Import → Upload**, and drop in `docs/Tracked.csv`.
3. For "Import location" choose **Insert new sheet(s)** → **Import data**.

   > The file is called `Tracked.csv` on purpose: Google names the new tab after
   > the file, so you end up with a tab named exactly `Tracked` — which is the
   > range the job reads (`Tracked!A2:E`). If you rename the file before
   > importing, rename the tab back to `Tracked` afterwards, or nothing will be
   > found.

4. Delete the leftover empty `Sheet1` tab.
5. The template contains two example rows, flagged in the `notes` column. Leave
   them for a first smoke test, then replace them with your real campaign
   videos. Ops adds one row per video from here on; nothing else is asked of
   them.

6. Copy **your** sheet's ID out of the browser address bar. In this example URL

   ```
   https://docs.google.com/spreadsheets/d/1a2B3cD4eF5gH6iJ7kL8mN9oP/edit#gid=0
                                          └────────── this part ──────────┘
   ```

   the ID is `1a2B3cD4eF5gH6iJ7kL8mN9oP`. Yours will differ — put it in `.env`:

   ```
   SHEET_ID=<the-id-from-your-sheet-url>
   ```

<details>
<summary>Prefer to set the sheet up by hand?</summary>

Create a tab named exactly `Tracked` and put these headers in row 1. Column
order matters; the header text is for humans and is skipped by the job, which
reads from row 2 down.

| A | B | C | D | E |
|---|---|---|---|---|
| video_url | campaign | creator | added_by | notes |

</details>

### 4b. Create the service account

1. Back in Google Cloud → **IAM & Admin → Service Accounts**.
2. **+ Create service account**.
3. Name it `campaign-tracker` → **Create and continue**.
4. When it asks for a role, **skip it** — click **Continue**, then **Done**.
   Roles control Google Cloud resources; access to your sheet comes from
   sharing, not from a role.
5. You're back at the list. **Copy the email address** of the account you just
   made — it looks like
   `campaign-tracker@your-project.iam.gserviceaccount.com`. You need it in 4d.

### 4c. Download its key

1. Click the service account → **Keys** tab → **Add key** → **Create new key**.
2. Choose **JSON** → **Create**. A `.json` file downloads.
3. **Treat this file like a password.** Anyone holding it can read anything the
   account can read. Never commit it — `.gitignore` blocks the common filenames,
   and step 4e moves it out of the repo entirely. Keep the file: the recommended
   setup reads the key from it rather than from a copy of its contents.

### 4d. Share the sheet with the service account ⚠️

**This is the step everyone misses.** Without it, every request fails with a
403 whose message does not mention sharing.

1. Open your tracking sheet.
2. Click **Share**.
3. Paste the service account email from 4b.
4. Set it to **Viewer** (it never needs to write).
5. Untick "Notify people" → **Share**.

### 4e. Tell `.env` where the key is

Move the key out of `~/Downloads`, where it is easy to lose or delete:

```bash
mkdir -p ~/.config/campaign-tracker
mv ~/Downloads/your-key-file.json ~/.config/campaign-tracker/service-account.json
chmod 600 ~/.config/campaign-tracker/service-account.json
```

Add one line to `.env`:

```
GOOGLE_SERVICE_ACCOUNT_FILE=~/.config/campaign-tracker/service-account.json
```

That's it — nothing is copied, so nothing can be truncated. The `~` is expanded
for you, and a wrong path produces an error naming the exact path it tried.

> GitHub Actions can't use a file path, so step 9 sets a `GOOGLE_SERVICE_ACCOUNT_JSON`
> secret instead. That needs no preparation now: you paste the same file's
> contents straight in when you get there.

> **If a key is ever exposed** — pasted into a chat, committed, screenshotted —
> delete it under **IAM & Admin → Service Accounts → Keys** *before* creating a
> replacement. Deleting is what revokes it. A new key on the same service account
> inherits the existing sheet share, so nothing else needs redoing.

---

## 5. `MONGO_URI`

The free tier is permanently free and far more than enough.

1. Go to **https://www.mongodb.com/cloud/atlas/register** — sign up, or sign in
   if you already have an account.
2. **If Atlas shows you a "Create a Project" screen, create one.** Name it
   `campaign-video-tracker` and skip the tags. Projects cost nothing and keep
   this separate from anything else in your account. A brand-new signup is put
   into a default project automatically and won't see this screen.
3. Inside the project, **Create** / **Build a Database** → choose the
   **M0 / Free** tier. Any provider and region is fine — pick one near you.
4. Click **Create Deployment**.

   > Atlas allows one M0 free cluster per project. If the free option is
   > unavailable because you already have one, just reuse an existing cluster —
   > the job creates its own `campaign_tracker` database and touches nothing
   > else, so sharing a cluster with unrelated work is fine.

### Create a database user

Atlas usually prompts for this immediately; otherwise go to **Database Access**
→ **Add New Database User**.

1. Choose **Password** authentication.
2. Pick a username and click **Autogenerate Secure Password** — then **copy the
   password now**, you won't see it again.
3. Under "Database User Privileges" choose **Read and write to any database**.
4. **Add User**.

### Allow network access

Go to **Network Access** → **Add IP Address**.

- For local testing: **Add Current IP Address**.
- For GitHub Actions: you must also add **`0.0.0.0/0`** (Allow access from
  anywhere). GitHub's runners have no fixed IPs, so there is no narrower option
  short of running your own runner.

> Be aware of what that means: the database is then reachable from any IP, and
> your username and password are the only thing protecting it. Use the generated
> password, don't reuse it anywhere, and rotate it if it ever leaks. On a real
> production system I'd run this on a fixed-IP host instead.

### Build the connection string

1. Go to **Database** → **Connect** on your cluster → **Drivers**.
2. Copy the string. It looks like:

   ```
   mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```

3. Replace `<username>` and `<password>` with the ones you just made, deleting
   the angle brackets along with the placeholder text.

   ⚠️ **If your password contains `@ : / ? # [ ] %` you must URL-encode it**, or
   the connection string parses wrongly and you get a confusing auth error.
   `@` becomes `%40`, `#` becomes `%23`, `%` becomes `%25`. Autogenerated
   passwords sometimes contain these. The simplest fix is to regenerate the
   password until it's alphanumeric.

4. Put it in `.env`:

   ```
   MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   MONGO_DB=campaign_tracker
   ```

You don't need to create the database or collection — the job creates them,
along with the index, on first run.

---

## 6. `DISCORD_WEBHOOK_URL`

A webhook is a URL that posts into one specific channel. You need **Manage
Webhooks** permission on the server.

1. In Discord, find the channel you want the report in (e.g. `#campaign-reports`).
2. Hover the channel → **⚙️ Edit Channel** → **Integrations**.
3. **Webhooks** → **New Webhook**.
4. Name doesn't matter — the job overrides it with "Campaign Tracker".
5. **Copy Webhook URL** and put it in `.env`:

   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<webhook-id>/<webhook-token>
   ```

> Anyone with this URL can post into that channel. It's not a read credential,
> but keep it out of public places.

---

## 7. `OPENAI_API_KEY` — optional

Skip this if you like. Without it the digest is written from a template and
every number is identical; only the phrasing is flatter. The job says which
writer it used in the Discord footer.

1. Go to **https://platform.openai.com/api-keys**.
2. **Create new secret key** → copy it (shown once).
3. Add a few dollars of credit under **Billing** — new accounts have none, and
   without credit the call fails and the job silently uses the template.
4. Put it in `.env`:

   ```
   OPENAI_API_KEY=<your-openai-key>
   OPENAI_MODEL=gpt-4o-mini
   ```

At one run a day this costs a fraction of a cent per month.

---

## 8. Test it locally

Check your `.env` before making any live calls. This validates the shape of
every credential offline — no network, no writes — and never prints a secret,
so it is safe to run on a shared screen:

```bash
npm run check:env
```

It reports on every variable rather than stopping at the first problem, and
names exactly what is wrong. When it says *Ready to run*:

```bash
npm run job
```

You should see each step log its scope prefix, and a real message appear in
Discord. If something fails, the error names what to fix — the table at the
bottom of this page covers the common ones.

**Then run it a second time.** The report should post again, but the snapshot
count in Mongo should not change: snapshots are keyed on `(videoId, date)` and
re-running the same day updates rather than duplicates.

---

## 9. GitHub Actions (the daily schedule)

1. Push the repo to GitHub.
2. **Settings → Secrets and variables → Actions → New repository secret.**
3. Add one secret per value, using **exactly these names**:

   | Secret | Value |
   |---|---|
   | `SHEET_ID` | same as in `.env` |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | **open the `.json` key file and paste the whole thing**, newlines and all |
   | `YOUTUBE_API_KEY` | same as in `.env` |
   | `MONGO_URI` | same as in `.env` |
   | `DISCORD_WEBHOOK_URL` | same as in `.env` |
   | `OPENAI_API_KEY` | *(optional)* same as in `.env` |

   GitHub secrets accept multi-line values, so the key needs no encoding — just
   paste the file. `GOOGLE_SERVICE_ACCOUNT_FILE` is local-only and has no
   equivalent here, because a runner has no file to point at.

4. `TIMEZONE` is not secret, so set it under the **Variables** tab instead (or
   leave it — it defaults to `Asia/Manila`).
5. Go to the **Actions** tab → **Daily campaign video report** → **Run
   workflow**. This triggers a run by hand so you can confirm it works without
   waiting until tomorrow morning.
6. Confirm the run goes green and the message appears in Discord.

---

## Troubleshooting

| What you see | What it actually means |
|---|---|
| `Missing required environment variable(s): ...` | `.env` isn't filled in, or you're in the wrong directory. |
| `TIMEZONE="PHT" is not a valid IANA timezone name` | Use the full name, `Asia/Manila`. |
| Sheets returns **403** | You didn't share the sheet with the service account email (step 4d). This is the most common failure by a wide margin. |
| `... did not contain valid JSON` | Usually a truncated copy. Use `GOOGLE_SERVICE_ACCOUNT_FILE` instead — see step 4e. |
| `Could not read GOOGLE_SERVICE_ACCOUNT_FILE at ...` | The path is wrong. The message names the exact path it tried. |
| `error:1E08010C` or a signature/decoder error | The private key's line breaks got mangled. Locally, use `GOOGLE_SERVICE_ACCOUNT_FILE` (step 4e). In Actions, re-paste the whole file into the secret. |
| Sheets returns **404** | Wrong `SHEET_ID`, or the tab isn't named `Tracked`. |
| YouTube returns **403 accessNotConfigured** | The YouTube Data API v3 isn't enabled on this project, or the key is restricted to a different API. |
| Mongo `Authentication failed` | Wrong password, or it contains characters needing URL-encoding (step 5). |
| Mongo connection times out | The IP isn't allowlisted under Network Access. Actions needs `0.0.0.0/0`. |
| Discord returns **404** | The webhook was deleted, or the URL is truncated. |
| Report arrives but the footer says "template" | The OpenAI key is missing, invalid, or out of credit. Everything else is fine. |
| Scheduled run never fires | GitHub disables schedules in repos inactive for 60 days. Push a commit and re-enable in the Actions tab. |
