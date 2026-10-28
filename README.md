# Job Hunter

An application for discovering jobs across countries, reviewing job matches, and tracking applications. Each installation belongs to one person. You supply your own provider accounts and keep your own database.

## Install and run

Requires **Node.js 24 LTS or newer** and npm. Download and extract the source package, then open a terminal in its project folder.

1. Install dependencies: `npm ci`
2. Create local configuration: `npm run setup`
3. Build the app: `npm run build`
4. Start it: `npm start`
5. Open **http://127.0.0.1:8790**.

Open **Settings** to connect your required OpenRouter API key, choose an available text model from the account dropdown, connect at least one required SerpApi key, and upload your resume PDF. The model dropdown stays disabled until an OpenRouter key is connected. Open **Search** to choose target roles, country, and work type. Choose **Search jobs** to start. If setup is incomplete, a checklist dialog links directly to each required field. A configured search starts only after you explicitly confirm its estimated usage.

API calls consume your own provider credits. An unconfigured installation makes no provider calls. Connecting keys verifies model access or account quota; these metadata requests do not run job discovery or AI assessment. No sample jobs, profiles, credentials, or application records are included.

## Workspace

- **Jobs:** opportunities stay visible for a rolling 24 hours after entering the queue. Filter results, read match reasons, open original postings, export the current queue, and check SerpApi quota. Expired entries stay in local storage for deduplication; they are not deleted. Notes and queue-status edits do not extend the window. Returning an application to Jobs starts a fresh 24 hours. Applications retain their full history. The open Jobs page refreshes at expiry and when you return to the tab, without starting a search.
- **Applications:** follow Applied, Interviewed, Offered, Accepted, Rejected, and Withdrawn stages.
- **Search:** edit roles, exclusion keywords, country and work type.
- **Search logs:** review search executions in a table with status, time, duration, result counts, and full progress or error messages.
- **Settings:** upload, preview, or replace your resume PDF and manage provider keys.

Save buttons remain disabled until the form has valid changes. Reverting edits disables them again. Saving forms, changing models, adding keywords or keys, and deleting saved items require confirmation. Cancel and Escape preserve the current draft without saving it. Searches wait until pending edits and operations finish. Resume and search settings save separately so one form cannot overwrite the other. Provider Connect buttons require valid input; appearance changes apply immediately.

Country flags and contextual emoji use the device’s native emoji font, including Apple emoji on Apple devices. Country names remain readable and keyboard searchable. The interface supports light, dark, and system appearance.

All pages share the same content width and responsive spacing. Settings keeps the resume file and its Preview/Replace controls together above the two provider sections. Search groups title keywords alongside country and work type on wide screens; fixed job sites are secondary expandable details. On smaller screens, job assessments move beneath titles and quota account details collapse while the remaining balance and next reset stay visible. Quota refresh preserves the known layout, marks loading, and clears balances when verification fails. Search-log durations use readable units; interrupted runs without a finish timestamp are explicitly identified. Dialogs preserve drafts on cancellation and return focus to the relevant control.

Search logs are ordered newest first, with status filters and 25 rows per page. Running searches update automatically while the app is open. Starting a search opens its log view. Succeeded means the run completed; Failed reports a search error, and Interrupted identifies a run stopped by a server shutdown. Filter and page selections stay in the URL. Refresh reloads history without starting a search. Setup or connection errors before a run starts remain visible where they occur and do not create phantom history records.

Data is stored in SQLite. Google Sheets, Google service accounts, Cloudflare, Railway, Telegram, and a separate database server are not required. Existing historical spreadsheets are not imported or modified.

## Search behavior

Discovery automatically searches Greenhouse, Lever, Ashby, Workable, and Workday through SerpApi's Google search API. Greenhouse includes both `boards.greenhouse.io` and `job-boards.greenhouse.io`; equivalent job URLs share a stable identity to prevent duplicate imports. These supported sites are fixed and shown for information; there is no site selection setting. Query previews and quota estimates use all five sites. Choose a supported country or **Any country**, and **Remote**, **Hybrid**, **On-site**, or **Any type**. New and upgraded installations retain the previous United States / Remote defaults. Country affects query terms and provider localization; work type affects query terms. Any country omits country terms and localization parameters. Queries use English terms. These are discovery preferences, so review each posting's actual location, work arrangement, and eligibility. Changing preferences affects future searches and keeps existing jobs. Results cover the last day. URL normalization prevents repeated imports of the same posting. Excluded title keywords are applied locally to titles only.

Readable descriptions are assessed against your resume using OpenRouter Chat Completions and structured output. Your extracted resume text and each job description pass through OpenRouter to the selected model provider. Requests require compatible parameters, disallow backup-provider fallbacks, and set `data_collection: "deny"` to restrict provider routing by OpenRouter’s data-policy metadata. Account privacy settings and provider policies still apply; the app does not promise blanket zero retention. Each assessment has a decision, a concise reason, and an AI fit estimate from 0 to 100 when evidence supports a score. Matches display a percentage; ambiguous or incomplete assessments display **Needs review**. The percentage is an estimate of job-relevant fit, not a hiring probability. There is no configurable minimum threshold. Missing essential information stays Needs review. These assessments help you decide what to apply for; they do not verify eligibility or submit applications. Assessment remains separate from application status. Only matches and review items appear in Jobs, Applications, totals, details, and CSV export. Nonmatches are automatically excluded; pending jobs stay hidden until assessed. Hidden records remain locally for deduplication and retry.

JavaScript-only, blocked, inaccessible, or unsupported descriptions are marked **Needs review**, without an invented verdict. Provider discovery failures stop the run explicitly. Unprocessed jobs remain available for a later run when AI assessment fails. Application statuses and notes are not overwritten by a later assessment.

Searches start only when you click Search jobs and confirm. There is no auto-run scheduler or Telegram integration. The app process must stay running until an active search finishes. Stopping the server cancels active provider requests and keeps already-saved jobs. A restart marks a search left by an unexpected shutdown as interrupted. Editing search settings or credentials is blocked during an active run.

## Resume PDF

In Settings → Resume, choose a PDF up to 10 MB and 20 pages. The browser extracts matching text locally using [Mozilla PDF.js](https://mozilla.github.io/pdf.js/). One upload/replace confirmation saves the original PDF, its name/page count, and extracted text together in the local SQLite database. Cancel preserves the previous file and text. Preview and Replace sit inside the file card; clicking the filename opens the PDF preview. The preview renders actual PDF pages with page controls and a download action, without an editable text review or separate Save profile action. The binary PDF is not sent to OpenRouter; only its extracted text is sent during matching.

The profile accepts up to 12,000 characters; longer PDFs are rejected rather than truncated. Scanned resumes require OCR first. Locked, malformed, empty, or unreadable files receive an explicit correction. Pages without readable text are identified before import. Formatting and reading order can differ, especially with columns, so check the original PDF for readable content. Leaving Settings cancels an import still being read. The PDF, matching text, source filename, and page count are backed up in SQLite. Older installations with only extracted text must re-upload the PDF to enable preview. Programmatic profile changes invalidate a previously stored PDF when it no longer represents the saved matching text. Profile text is sent to OpenRouter only when job assessment runs.

## Provider quota

The Jobs page shows verified remaining SerpApi requests, estimated job searches at the current settings before retries, and each account’s individual reset date and remaining balance. A job search can consume multiple requests; the estimate is not a guaranteed number of runs. Refresh checks provider metadata without running job discovery. Balances update after an active run finishes. If no key is connected or quota cannot be verified, the page states that explicitly without inventing a balance or reset date.

Use **Add key** repeatedly to connect several SerpApi keys from separate accounts, including three accounts as in the original system. The input remains visible after each addition. Keys for the same account are rejected to avoid counting the same balance twice. Account balances and reset dates come from the [SerpApi Account API](https://serpapi.com/account-api), which does not consume search credits. Refresh reloads them; each run verifies them again.

SerpApi has a monthly search allowance. The app calculates a daily planning target from each account's remaining searches and days until renewal, then adjusts search depth automatically. This is an estimate, not a provider daily limit or a hard daily spending cap. The confirmation shows estimated requests; retries can use additional credits. If a renewal date is unavailable, no daily target is invented. Unknown quota or exhausted accounts block search explicitly.

The model dropdown verifies the key through OpenRouter’s current-key endpoint and loads the [account-filtered model catalog](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails). It shows text-input/text-output models whose metadata includes both `structured_outputs` and `response_format`. Models are not restricted to one vendor. Endpoint capabilities and account credit can still differ; failures are reported explicitly. Every returned assessment is validated locally, and missing or invalid output becomes Needs review. No static model list, alternate model or direct OpenAI connection is used as a fallback. Generation requests are not automatically retried to avoid accidental duplicate paid calls.

## Local configuration

All environment settings live in the untracked `.env.local` file. `npm run setup` creates it without overwriting an existing file. API keys saved in Settings are written to this file with owner-only permissions and are never returned by the API. Other preferences and your profile live in the local database.

The generated file uses port 8790, loopback host `127.0.0.1`, and `./data` as its data directory. Model and API keys start empty; the interface works before providers are configured. Saved keys are masked. Change or remove them explicitly; empty key submissions are rejected.

This release serves only on a loopback address. Remote server installations can be reached through an SSH tunnel. Public internet binding, multi-user accounts, reverse-proxy authentication, and hosted service operation are outside this release.

## Back up and update

1. Stop the app with **Ctrl+C**.
2. Copy the entire `data` folder and `.env.local` to your own private backup location.
3. Update the source and run `npm ci` and `npm run build`.
4. Run `npm start`.

Preserve both the database and its environment file. CSV export is for portability, not a full backup. The app does not delete old jobs automatically.

Database schema 4 removes obsolete schedule settings while retaining PDF storage and nullable percentage scores without inventing values for old records. Existing scores, application history and notes are preserved; older application records without a decision remain visible as review items. Records without a usable score display Needs review. The old minimum-threshold preference remains removed.

## Development and verification

`npm run check` checks strict TypeScript. `npm run format:check` checks formatting. `npm test` verifies storage persistence, validation, request boundaries, and missing-provider behavior using isolated empty installations; no paid provider calls are made. `npm run build` creates the interface and server. `npm run dev` watches the TypeScript server; rebuild the interface after editing its source.

`npm audit` checks dependency advisories. `npm run package` produces a source archive from an explicit allowlist. The archive excludes `.env.local`, SQLite data, dependencies, build output, Git history, local context notes, and runtime logs.

The application uses React, Radix UI primitives, Lucide icons, Fastify, and SQLite. See [SECURITY.md](SECURITY.md) for the local security boundary. Licensed under MIT.

Job titles open the original posting directly in a new tab. Status can be changed from the table with confirmation; the explicit edit icon opens a centered notes/details dialog. Jobs and Applications use the same stages and spreadsheet palette: Need to apply (blue), Needs review (yellow), Applied (light green), Interviewed (teal), Offered (purple), Accepted (darker green), Rejected (red), and Withdrawn (gray). Stored internal status identifiers remain compatible with existing databases.

Jobs contains only Need to apply and Needs review. Changing a job to Applied or another application stage moves it exclusively to Applications; moving it back to either preparation stage returns it to Jobs. Each page’s status filters and counters follow that partition, and existing notes and scores are preserved.

Upgrades remove saved schedule settings even if auto-run was previously enabled. Existing jobs, PDF files and search history remain intact. Historical run origins are preserved in stored records, but the redundant Trigger column is no longer shown. Log timestamps and quota planning use the device timezone.

OpenRouter configuration uses `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env.local`. Existing direct OpenAI credentials are never treated as OpenRouter credentials. Reconnect through Settings; a successfully verified OpenRouter key replaces obsolete direct OpenAI configuration entries. Existing workspace records and SerpApi connections are preserved.
