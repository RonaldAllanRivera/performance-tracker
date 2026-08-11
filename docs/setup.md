# Setup: getting the credentials

Written assuming you have never touched Google Cloud, MongoDB Atlas, or Discord
webhooks before. Every step says what to click, what you should see, and what
goes wrong if you skip it.

> Every **credential** in this guide is a placeholder in `<angle-brackets>` —
> replace the brackets and their contents, and never paste one verbatim.
> Shell commands set a `KEY=...` variable first; edit that line, not the command.

**Time needed:** about 30 minutes.
**You need:** a Google account and a GitHub account. Discord is covered from
scratch in step 6 — you don't need an account or a server beforehand.

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

Where the daily snapshots are stored. The free tier is permanently free and far
more than enough — this writes a few hundred small documents a day.

### 5a. Create the cluster

1. Go to **https://www.mongodb.com/cloud/atlas/register** — sign up, or sign in
   if you already have an account.
2. **If Atlas shows a "Create a Project" screen, create one.** Name it
   `campaign-video-tracker` and skip the tags and the member step. Projects cost
   nothing and keep this separate from anything else in your account. A
   brand-new signup lands in a default project and won't see this screen.
3. Inside the project: **Create** / **Build a Database** → **M0** (the free
   tier). Any provider is fine; pick the region nearest you.
4. Leave **Automate security setup** ticked — it creates the database user and
   allowlists your current IP in one go. Leave **Preload sample dataset**
   unticked; this job creates its own data.
5. **Create Deployment.** Provisioning takes a couple of minutes.

> Atlas allows one M0 cluster per project. If the free tier is greyed out
> because you already have one, reuse any existing cluster — the job creates its
> own `campaign_tracker` database and touches nothing else, so sharing a cluster
> with unrelated work is harmless.

### 5b. Create a database user

With **Automate security setup** ticked, Atlas does this for you in the
"Connect to Cluster0" dialog that appears right after the cluster is created. It
shows a username and a generated password on the first step.

**Copy that password before clicking on.** It is shown once.

If you clicked past it — easy to do — you cannot retrieve it. Reset it instead:
**Database & Network Access → Database Access → Edit → Edit Password →
Autogenerate**, then **Update User**.

Creating one from scratch, if you unticked the automation: **Add New Database
User** → **Password** authentication → **Autogenerate Secure Password** →
privileges **Read and write to any database** → **Add User**.

> ⚠️ **Check the password before you move on.** If it contains any of
> `@ : / ? # [ ] %`, click regenerate until it is letters and digits only.
> Two separate things go wrong otherwise, and neither error mentions the cause:
>
> - Those characters have meaning inside a connection string, so the URI parses
>   wrongly and you get a bare authentication failure. You can URL-encode them
>   (`@` → `%40`, `%` → `%25`) if you must.
> - **A `#` is worse.** `.env` files treat an unquoted `#` as the start of a
>   comment, so the value is silently cut off at that point before the app ever
>   sees it. Wrapping the whole value in double quotes avoids this.
>
> Regenerating an alphanumeric password sidesteps both and takes five seconds.
> `npm run check:env` detects both, including the truncation.

### 5c. Allow network access

**Automate security setup allowlists your current IP only.** That is enough to
run the job on your machine and *not* enough for GitHub Actions — the scheduled
run will fail with a connection timeout while local runs keep working, which is
a confusing way to find out.

**Where it lives** — this is not obvious, because it is a tab rather than a
sidebar entry:

1. Close the "Connect to Cluster0" dialog first (**Done**).
2. Left sidebar, under **SECURITY**, click **Database & Network Access**.
3. On that page, select the **Network Access** tab.
4. **+ ADD IP ADDRESS**.

Your current IP is already listed if you left *Automate security setup* ticked
(commented "Created as part of the Auto Setup process"). That covers local runs.

For GitHub Actions, add a second entry. Some versions of the dialog offer an
**ALLOW ACCESS FROM ANYWHERE** button; if yours doesn't, just type the value in
— it is the same thing:

- **Access List Entry:** `0.0.0.0/0`
- **Comment:** `GitHub Actions — runners have no fixed IP`
- **Confirm**

Atlas will warn that this "potentially allows access to all IPv4 addresses" —
that is what you are asking for, and the tradeoff is spelled out below. The new
row shows **Pending** for a minute or two while it propagates; connections
attempted before it goes **Active** time out.

> ⚠️ **Leave "This entry is temporary" switched off.** It deletes the entry
> after a few hours. Local runs would keep working, and the scheduled job would
> begin failing with a connection timeout days later with nothing to point at.
> Do not build that failure mode into the database of a tool whose whole job is
> to stop things failing quietly.

Runners have no fixed IPs, so there is no narrower option short of hosting your
own runner.

> Know what you're accepting: the database is then reachable from any IP, and
> the username and password are the only thing protecting it. Use the generated
> password, don't reuse it anywhere, and rotate it if it leaks. In production I'd
> run this from a fixed-IP host and drop the wildcard.

### 5d. Build the connection string

1. In the "Connect to Cluster0" dialog, choose **Drivers** — the first option,
   under "Connect to your application". Not Compass, not Shell. If you closed
   the dialog, reopen it with **Connect** on the cluster.
2. Driver **Node.js**, latest version. Copy the string under "Add your
   connection string into your application code". It looks like this — the
   placeholder name varies (`<password>` or `<db_password>`), and a trailing
   `&appName=...` is fine to keep:

   ```
   mongodb+srv://<username>:<db_password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```

3. **Copy it before closing the dialog** — Atlas fills the real password in
   here (with *Show Password* on) and will not show it again.
4. Note that the **username is still a placeholder** (`<db_username>`) even
   though the password is filled in. Find the real one on **Database & Network
   Access → Database Access**, then replace it — **deleting the angle brackets**
   along with the placeholder text.
5. Put it in `.env`:

   ```
   MONGO_URI=<the finished string from step 3, all on one line>
   MONGO_DB=campaign_tracker
   ```

> **You only copy `MONGO_URI` from Atlas. `MONGO_DB` is not in Atlas anywhere —
> leave it as `campaign_tracker`.**
>
> It is a name *you* choose. Don't go looking for it in the UI and don't change
> it to match something you see there.

**Why it isn't there yet:** MongoDB has no "create database" step. Databases and
collections spring into existence on first write, which is why your new cluster
reports `Data Size: 0 B` and shows nothing under **Data Explorer**. The job
creates the `campaign_tracker` database, the `snapshots` collection, and the
unique index the first time you run it. After that, Data Explorer will show them.

Two related things that look wrong but aren't:

- The connection string ends `/?retryWrites=...` with no database name between
  the `/` and the `?`. That is correct — `MONGO_DB` selects the database.
- If you *do* leave a database name in the URI, `MONGO_DB` takes precedence.

### 5e. Check it

```bash
npm run check:env
```

That validates the string's shape offline — including the URL-encoding trap
above and any leftover `<angle-brackets>` — without connecting to anything.

---

## 6. `DISCORD_WEBHOOK_URL`

Where the daily report gets posted. A **webhook** is just a URL that posts a
message into one specific channel — no bot, no app to install, no OAuth.

Everything below is free and takes about five minutes. **You do not need an
existing Discord account or server** — this walks through creating both. In a
real deployment you'd point this at the company's own channel instead; a
personal server is fine for testing and for a portfolio submission.

### 6a. Get a Discord account

Skip to 6b if you already have one.

1. Go to **https://discord.com/register**.
2. Fill in email, username, and password, and confirm your date of birth.
3. **Check your inbox and click the verification link.** Discord blocks some
   actions until the address is verified.

You can do all of this in a browser at **https://discord.com/app** — there is no
need to install the desktop client.

### 6b. Create a server

A "server" in Discord is just a private space. Yours can have exactly one member.

1. In the far-left sidebar, click the **`+`** button (*Add a Server*).
2. **Create My Own** → **For me and my friends**.
3. Name it something like `Campaign Tracker` → **Create**.

You now have a server with a `#general` text channel.

### 6c. Make a channel for the reports (optional)

`#general` works, but a dedicated channel keeps the digest out of the way.

1. Hover **TEXT CHANNELS** in the channel list → click the **`+`**.
2. Name it `campaign-reports` → **Create Channel**.

### 6d. Create the webhook

1. Hover the channel you want the report in → click the **⚙️ gear** (*Edit
   Channel*).
2. **Integrations** in the left panel of that settings page.
3. **Webhooks** → **New Webhook** (or **Create Webhook** if it is the first).
4. Click the webhook that appears, then **Copy Webhook URL**.

   The name and avatar there don't matter — the job overrides them with
   "Campaign Tracker".

5. Put it in `.env`:

   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<webhook-id>/<webhook-token>
   ```

> Anyone holding this URL can post into that channel. It grants no read access
> and can't do anything else, but keep it out of public repositories — it is a
> credential, which is why it lives in `.env` and in GitHub Secrets rather than
> in the code.

**If you don't see Integrations or Webhooks:** you need *Manage Webhooks* on the
channel. On a server you created yourself you are the owner and always have it.
On someone else's server, ask an admin — or make your own server for testing and
switch the URL later.

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

   **Type the name by hand rather than pasting it.** The field accepts letters,
   digits and underscores only, and a pasted trailing newline, leading space or
   stray backtick fails with "Secret names can only contain alphanumeric
   characters" — none of which are visible in the box. The names are short:

   ```
   SHEET_ID
   GOOGLE_SERVICE_ACCOUNT_JSON
   YOUTUBE_API_KEY
   MONGO_URI
   DISCORD_WEBHOOK_URL
   OPENAI_API_KEY
   ```

   What goes in the **Secret** box for each:

   - `SHEET_ID`, `YOUTUBE_API_KEY`, `MONGO_URI`, `DISCORD_WEBHOOK_URL` — the
     same values as in your `.env`.
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the CI counterpart of
     `GOOGLE_SERVICE_ACCOUNT_FILE`, which has no meaning on a runner.
     **Paste it base64-encoded, on one line:**

     ```bash
     base64 -w0 ~/.config/campaign-tracker/service-account.json    # Linux
     base64 ~/.config/campaign-tracker/service-account.json | tr -d '\n'   # either OS
     ```

     Raw multi-line JSON also works, but produces unreadable logs: GitHub masks
     each *line* of a multi-line secret separately, so the lines that are just
     `{` and `}` become masks and every brace anywhere in the run output is
     replaced with `***` — even unrelated ones like `bash -e {0}`. One line of
     base64 registers one mask and leaves the log legible.
   - `OPENAI_API_KEY` — optional. Without it the digest uses the template.

   GitHub secrets accept multi-line values, so the key needs no encoding — just
   paste the file. `GOOGLE_SERVICE_ACCOUNT_FILE` is local-only and has no
   equivalent here, because a runner has no file to point at.

4. `TIMEZONE`, `MONGO_DB` and `OPENAI_MODEL` are **not** secrets. The workflow
   supplies sensible defaults (`Asia/Manila`, `campaign_tracker`,
   `gpt-4o-mini`), so you can skip them entirely. To override one, add it under
   the **Variables** tab — not Secrets.
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
| No **Integrations** tab on the channel | You lack *Manage Webhooks* on that server. Create your own server (step 6b) and use a channel there. |
| Report arrives but the footer says "template" | The OpenAI key is missing, invalid, or out of credit. Everything else is fine. |
| Actions run fails with `Missing required environment variable(s)` while local runs work | The credentials were added under the **Variables** tab. The workflow reads `secrets.*` for all six, so a variable of the same name resolves to empty. Move them to **Secrets**, and delete the variable copies — variables are unencrypted and are not masked in logs. |
| Braces replaced by `***` all over the Actions log | `GOOGLE_SERVICE_ACCOUNT_JSON` was stored as multi-line JSON. GitHub masks each line separately, including the `{` and `}` lines. Re-save it base64-encoded on one line. |
| Scheduled run never fires | GitHub disables schedules in repos inactive for 60 days. Push a commit and re-enable in the Actions tab. |
