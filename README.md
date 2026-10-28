# Job Hunter

An application for discovering jobs across countries, reviewing AI match scores, and tracking applications. Each installation belongs to one person. You supply your own provider accounts and keep your own database.

## Install and run

Requires **Node.js 24 LTS or newer** and npm. Download and extract the source package, then open a terminal in its project folder.

1. Install dependencies: `npm ci`
2. Create local configuration: `npm run setup`
3. Build the app: `npm run build`
4. Start it: `npm start`
5. Open **http://127.0.0.1:8790**.

Open **Settings** to connect your required OpenAI API key, choose an available text model from the account dropdown, connect at least one required SerpApi key, and add your profile. The model dropdown stays disabled until an OpenAI key is connected. Open **Search** to choose target roles, country, work type, and job sites. Your first search starts only after you explicitly confirm it.

API calls consume your own provider credits. An unconfigured installation makes no provider calls. Connecting keys verifies model access or account quota; these metadata requests do not run job discovery or AI scoring. No sample jobs, profiles, credentials, or application records are included.

## Workspace

- **Jobs:** filter opportunities, read match reasons, open original postings, and export CSV.
- **Applications:** follow applied, interviewing, offer, accepted, rejected, and withdrawn statuses.
- **Search:** edit roles, exclusion keywords, country, work type, sources and schedule, and view actual execution history.
- **Settings:** edit your profile, match threshold, and provider keys.

Save buttons remain disabled until the form has valid changes. Reverting edits disables them again. Provider Connect buttons require a key; model and appearance selections save immediately only when changed.

Data is stored in SQLite. Google Sheets, Google service accounts, Cloudflare, Railway, Telegram, and a separate database server are not required. Existing historical spreadsheets are not imported or modified.

## Search behavior

Discovery uses SerpApi's Google search API for postings on Greenhouse, Lever, Ashby, Workable, and Workday. Choose a supported country or **Any country**, and **Remote**, **Hybrid**, **On-site**, or **Any type**. New and upgraded installations retain the previous United States / Remote defaults. Country affects query terms and provider localization; work type affects query terms. Any country omits country terms and localization parameters. Queries use English terms. These are discovery preferences, so review each posting's actual location, work arrangement, and eligibility. Changing preferences affects future searches and keeps existing jobs. Results cover the last day. URL normalization prevents repeated imports of the same posting. Excluded title keywords are applied locally to titles only.

Readable descriptions are scored against your own profile using OpenAI's Responses API and structured output. Your profile and each description are sent to OpenAI with response storage disabled. Scores are suggestions for your own job search; they do not confirm eligibility or submit an application.

JavaScript-only, blocked, inaccessible, or unsupported descriptions are marked **Needs review**, with no invented score. Provider discovery failures stop the run explicitly. Unprocessed jobs remain available for a later run when AI scoring fails. Application statuses and notes are not overwritten by a later score.

Scheduled searches are off by default. Enable them only after setup. The server must remain running; missed schedules are not replayed. Stopping the server cancels active provider requests and keeps already-saved jobs. A restart marks a search left by an unexpected shutdown as interrupted. Editing search settings or credentials is blocked during an active run.

## Provider quota

Connect several SerpApi keys when they belong to separate accounts. Keys for the same account are rejected to avoid counting the same balance twice. Account balances and reset dates come from the [SerpApi Account API](https://serpapi.com/account-api), which does not consume search credits. Refresh reloads them; each run verifies them again.

SerpApi has a monthly search allowance. The app calculates a daily planning target from each account's remaining searches and days until renewal, then adjusts search depth automatically. This is an estimate, not a provider daily limit or a hard daily spending cap. The confirmation shows estimated requests; retries can use additional credits. If a renewal date is unavailable, no daily target is invented. Unknown quota or exhausted accounts block search explicitly.

The model dropdown uses the [OpenAI Models API](https://developers.openai.com/api/reference/resources/models/methods/list) and filters for text model families suitable for scoring. Account access and structured-output support can still differ by model; upstream errors are shown explicitly. No model IDs are supplied as a static fallback.

## Local configuration

All environment settings live in the untracked `.env.local` file. `npm run setup` creates it without overwriting an existing file. API keys saved in Settings are written to this file with owner-only permissions and are never returned by the API. Other preferences and your profile live in the local database.

The generated file uses port 8790, loopback host `127.0.0.1`, and `./data` as its data directory. Model and API keys start empty; the interface works before providers are configured. Saved keys are masked. Change or remove them explicitly; empty key submissions are rejected. Removing a provider key disables scheduled searches.

This release serves only on a loopback address. Remote server installations can be reached through an SSH tunnel. Public internet binding, multi-user accounts, reverse-proxy authentication, and hosted service operation are outside this release.

## Back up and update

1. Stop the app with **Ctrl+C**.
2. Copy the entire `data` folder and `.env.local` to your own private backup location.
3. Update the source and run `npm ci` and `npm run build`.
4. Run `npm start`.

Preserve both the database and its environment file. CSV export is for portability, not a full backup. The app does not delete old jobs automatically.

## Development and verification

`npm run check` checks strict TypeScript. `npm run format:check` checks formatting. `npm test` verifies storage persistence, validation, request boundaries, and missing-provider behavior using isolated empty installations; no paid provider calls are made. `npm run build` creates the interface and server. `npm run dev` watches the TypeScript server; rebuild the interface after editing its source.

`npm audit` checks dependency advisories. `npm run package` produces a source archive from an explicit allowlist. The archive excludes `.env.local`, SQLite data, dependencies, build output, Git history, local context notes, and runtime logs.

The application uses React, Radix UI primitives, Lucide icons, Fastify, and SQLite. See [SECURITY.md](SECURITY.md) for the local security boundary. Licensed under MIT.
