# Journal Lens

Research a scientific journal from its **name or publisher link**. Journal Lens checks indexing evidence and citation metrics, then measures **Received → Accepted** intervals from at least 15 articles in recent issues.

The repository includes a local web app, a command-line tool, and an installable **Codex skill**. It has no npm runtime dependencies and needs no paid API key for its public-source workflow.

## Requirements

- **Node.js 20 or newer**, with npm.
- **curl** available on your command line.
- Internet access to Crossref, OpenAlex, publishers and search sources.
- macOS, Linux, or Windows with WSL is recommended. The optional Worker build uses Bash.

Check your setup:

```sh
node --version
npm --version
curl --version
```

## Launch the app

```sh
git clone https://github.com/OUATILANAS/journal-lens.git
cd journal-lens
npm run dev
```

Open **http://127.0.0.1:4173/**. No `npm install` step is needed: the app uses Node built-ins and system curl.

Enter a journal name, homepage, issue URL, or journal subpage such as `/aims-and-scope`, then click **Run full check**. If a name is ambiguous, choose the exact journal. The tool resolves the homepage and automatically discovers specific recent issues.

Keep the terminal running while you use the app. Press **Ctrl+C** to stop the local server. Start it again with `npm run dev`; saved research jobs resume. If port 4173 is already in use, reuse your existing Journal Lens server, stop it first, or choose a different port on macOS/Linux/WSL: `PORT=4174 npm run dev` (then open http://127.0.0.1:4174/).

## What it checks

- **Web of Science Core Collection:** explicit Science Citation Index Expanded (**SCIE**) evidence, matched by Electronic ISSN / Print ISSN. Emerging Sources Citation Index (**ESCI**) journals are excluded.
- **CiteScore and Journal Impact Factor:** value, source, metric year when reported, check date and source authority.
- **Article histories:** at least 15 valid Received–Accepted pairs, with Revised dates retained when reported and marked **Not reported** otherwise.
- **Timing statistics:** sample size, median, mean, range and interquartile range, in calendar days.

The report displays the full Core Collection index name, source links, matched ISSN and whether verification came directly from Clarivate or from a publisher/institutional record. Those evidence types are kept distinct.

### Multiple issues and persistent research

The automatic audit can inspect up to **48 issues and 240 candidates per pass**. It skips invalid links, empty or blocked issues, non-research items, and invalid dates, then continues through later issues until it has 15 valid pairs. An aims/scope page is never treated as an issue.

Unresolved checks are saved and retried with backoff from one to ten minutes. **Retry missing checks now** resumes immediately; **Stop research** cancels a run. Verified article histories carry forward between passes. The tool rejects an ESCI journal rather than trying to force it to pass.

## Use the command-line tool

Run from the cloned project directory:

```sh
# Show commands.
node scripts/journal-lens.mjs help

# Full workflow from a name or link; keeps retrying unresolved checks.
node scripts/journal-lens.mjs check "Journal of Visualization"
node scripts/journal-lens.mjs check "https://link.springer.com/journal/11276"

# One research pass, useful for an agent investigating pending checks.
node scripts/journal-lens.mjs check --once "Precision Agriculture"

# Audit multiple specific issues directly.
node scripts/journal-lens.mjs audit \
  "https://link.springer.com/journal/12650/volumes-and-issues/29-5" \
  "https://link.springer.com/journal/12650/volumes-and-issues/29-4"
```

Commands return JSON. `ok: true` means the command executed; inspect the report's **`complete`**, **`pendingChecks`**, source provenance and **`issueAuditResults`** before treating research as complete. In persistent mode progress is written to stderr and final JSON to stdout. Ctrl+C stops the CLI; later persistent runs resume its saved checkpoint.

Additional commands include `search`, `resolve`, `journal`, `issues`, `article`, `works`, and `extract`. Run `help` for arguments. `extract` reads copied publisher text or HTML from stdin and preserves manual provenance.

## Install the Codex skill

From the cloned project directory:

```sh
npm run skill:install
```

The installer copies [skills/journal-lens](skills/journal-lens) to `${CODEX_HOME:-~/.codex}/skills/journal-lens` and writes the actual checkout path into the installed instructions. **Keep the checkout in place**: the skill runs its CLI from that directory.

Start a new Codex chat and ask:

```text
Use $journal-lens to fully check https://link.springer.com/journal/11276
```

Or:

```text
Use $journal-lens to check Precision Agriculture and audit 15 recent article acceptance intervals.
```

If an existing chat has not refreshed its skill catalog, start a new chat or ask it to read the installed `SKILL.md` directly. The app's **Use in another chat** button copies instructions containing your local project and skill paths.

To update an existing installation after pulling changes:

```sh
git pull
npm run skill:install -- --force
```

The installer refuses to overwrite an existing `SKILL.md` without `--force`. You can test or install elsewhere with:

```sh
node scripts/install-skill.mjs --dest /absolute/path/to/journal-lens-skill
```

The skill requires a Codex environment able to run local commands. Cloud-only chats and other computers cannot access your checkout automatically; clone and install on each computer where you want to use it. Installing the skill does not create a remote MCP server.

## Storage and exports

- Web reports are saved in the browser's local storage. Export **JSON** for portable reports or **CSV** for article histories.
- Background jobs and CLI checkpoints are stored in ignored **`.local/`** files.
- `data/research-sources.json` contains public journal-record URLs that may help discovery. A stored URL is not proof of indexing.
- Optional verified source checks belong in ignored `data/verified-evidence.json`; start with `data/verified-evidence.example.json`. Records retain their source, authority, check date and provenance and expire after 24 hours.
- No personal reports, job state, verification cache, source screenshots, account identifiers or credentials are shipped in this repository.

Browser-saved reports are not automatically available to a different chat or the CLI. Export JSON to transfer a report.

## Access limitations and interpretation

Some publishers return HTTP 403, rate limits or browser verification pages. Journal Lens uses anonymous HTTP sessions; it does **not** bypass paywalls, CAPTCHAs or browser challenges. A blocked homepage does not stop the other checks when metadata can safely identify the journal. Crossref volume/issue metadata and explicit editorial-history assertions can provide alternatives; the report labels their provenance.

Clarivate, Scopus and other sources may require registered or licensed access. Public web search can be blocked or return no relevant evidence. An unavailable source remains unverified; repeated attempts cannot guarantee that every journal will yield all data. Stop research if you do not want it to continue retrying. The skill guides a chat to investigate unresolved sources actively rather than blindly repeating the same failure.

Only explicit Received and Accepted dates qualify. Publication, online, deposit, first-decision dates, SJR and generic impact scores are not substitutes for the required dates or Journal Impact Factor. Missing Revised dates are disclosed and never invented.

Acceptance-time statistics describe a selected sample of **accepted articles**. They do not estimate acceptance probability or guarantee the turnaround of a new submission. Check issue recency, article eligibility, source dates and special-issue context before relying on the sample.

## Tests and optional Worker build

```sh
npm test
npm run build
npm run validate
```

Tests cover date extraction, missing revisions, metadata fallbacks, source matching, indexing distinctions, CSV handling, persistence, cancellation and multi-issue continuation.

The optional build creates `dist/server/index.js` as an ESM Worker artifact. **The complete app runs through `npm run dev`**: its local curl transport, persistent jobs and full-check endpoints require the Node server and are not included in the Worker runtime. `.openai/hosting.json` is a neutral build manifest with no registered Site identity.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/api.js` | Metadata APIs and publisher history extraction |
| `src/workflow.mjs` | One-input research workflow |
| `src/audit.mjs` | Multi-issue acceptance-date audit |
| `src/check-runner.mjs` | Persistent retry lifecycle |
| `src/ui.html` | Browser interface and report rendering |
| `scripts/dev.mjs` | Local HTTP server |
| `scripts/journal-lens.mjs` | Reusable CLI |
| `scripts/publisher-http.mjs` | Validated local curl transport |
| `scripts/web-research.mjs` | Public search and source evidence |
| `scripts/install-skill.mjs` | Portable Codex skill installer |
| `skills/journal-lens/` | Skill template and Codex metadata |
| `tests/` | Dependency-free regression tests |

## License

MIT. See [LICENSE](LICENSE). Third-party publisher/database content retains its original rights and access conditions.
