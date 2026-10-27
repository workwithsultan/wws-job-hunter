# Job Hunter

A self-hosted workspace for discovering US remote jobs, reviewing AI match scores, and tracking applications. Each installation belongs to one person. You supply your own provider accounts and keep your own database.

## Install and run

Requires **Node.js 24 LTS or newer** and npm. Download and extract the source package, then open a terminal in its project folder.

1. Install dependencies: `npm ci`
2. Create local configuration: `npm run setup`
3. Build the app: `npm run build`
4. Start it: `npm start`
5. Open **http://127.0.0.1:8790**.

Open **Settings** to add your profile, an OpenAI API key, a model ID available to your account that supports Responses API structured outputs, and a SerpApi key. Open **Search** to choose target roles and job sites. Your first search starts only after you explicitly confirm it.

API calls consume your own provider credits. Installing and opening the app makes no provider calls. No sample jobs, profiles, credentials, or application records are included.

## Workspace

- **Jobs:** filter opportunities, read match reasons, open original postings, and export CSV.
- **Applications:** follow applied, interviewing, offer, accepted, rejected, and withdrawn statuses.
- **Search:** edit roles, exclusion keywords, sources, result limits, schedule, and view actual execution history.
- **Settings:** edit your profile, match threshold, and provider keys.

Data is stored in SQLite. Google Sheets, Google service accounts, Cloudflare, Railway, Telegram, and a separate database server are not required. Existing historical spreadsheets are not imported or modified.

## Search behavior

Discovery uses SerpApi's Google search API for remote United States postings on Greenhouse, Lever, Ashby, Workable, and Workday. Results cover the last day. URL normalization prevents repeated imports of the same posting. Excluded title keywords are applied locally to titles only.

Readable descriptions are scored against your own profile using OpenAI's Responses API and structured output. Your profile and each description are sent to OpenAI with response storage disabled. Scores are suggestions for your own job search; they do not confirm eligibility or submit an application.

JavaScript-only, blocked, inaccessible, or unsupported descriptions are marked **Needs review**, with no invented score. Provider discovery failures stop the run explicitly. Unprocessed jobs remain available for a later run when AI scoring fails. Application statuses and notes are not overwritten by a later score.

Scheduled searches are off by default. Enable them only after setup. The server must remain running; missed schedules are not replayed. Stopping the server cancels active provider requests and keeps already-saved jobs. A restart marks a search left by an unexpected shutdown as interrupted. Editing search settings or credentials is blocked during an active run.

## Local configuration

All environment settings live in the untracked `.env.local` file. `npm run setup` creates it without overwriting an existing file. API keys saved in Settings are written to this file with owner-only permissions and are never returned by the API. Other preferences and your profile live in the local database.

The generated file uses port 8790, loopback host `127.0.0.1`, and `./data` as its data directory. Model and API keys start empty; the interface works before providers are configured. Existing keys are kept when a key field is left blank. Removing a provider key disables scheduled searches.

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
