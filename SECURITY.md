# Security and data boundaries

This is a single-user, loopback-only application. Do not bypass the host restrictions or expose its port publicly. Protect the computer account and private backups as you would your resume and application history.

The server checks request hosts and origins, rejects cross-site changes, and requires JSON for write requests. It serves built assets only from the public directory. Secrets, source files, and SQLite files are outside that directory. API keys are never serialized to the client, included in CSV exports, or saved in the database. The environment file is written atomically with owner-only permissions; the data directory is owner-only.

API keys are plaintext on the server in `.env.local`, not encrypted. The local operating system account is the access boundary. A browser or application running with your own local account may access this local app; this is not a multi-user isolation system.

Job text is untrusted. It is displayed as text and passed to the scorer as data, not executed or rendered as HTML. Extracted URLs must use HTTPS and supported ATS hosts. Redirects outside supported job sites are rejected. Job content is limited in size; database queries use bound parameters. CSV text beginning with spreadsheet formula characters is escaped.

Your profile is sent to OpenAI when scoring runs. Search keywords are sent to SerpApi. Connecting an OpenAI key retrieves available models. Connecting or refreshing SerpApi keys reads account quota. Saved connections also load this metadata when Settings is opened. These requests do not start job discovery or scoring. Raw provider account responses, email addresses, and keys are not returned to the browser. Searches verify quota before proceeding. Use provider-side limits appropriate to your budget.

Before sharing source, run checks, build, tests, and dependency audit. Package through the allowlist script. Never upload the working directory, `.env.local`, data, backups, or browser profiles. This repository must not inherit the private historical project's Git history.

Report suspected issues privately to the repository owner. Do not include API keys, profiles, resumes, or database files in public issues.
