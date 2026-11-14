# Deep AI Summary


An AI summary plugin for [degoog](https://github.com/degoog-org/degoog), forked
from the official [AI Summary](https://github.com/degoog-org/official-extensions)
plugin and rebased onto it. Same slot, same look — plus two extra features:

1. **Full-page context** — instead of summarizing only the search snippets,
   the top result pages are fetched and their main text is given to the model
   as primary evidence, with a `--- Source [N] full text ---` block per page.
   Failed pages fall back to their snippet.
2. **Custom panel title** — the panel badge text is a setting, so the summary
   can introduce itself as whatever you like.

## How page fetching works

Fully in-process by default, **zero setup**: each top result is fetched with a
rotating browser UA and a per-page timeout, parsed with cheerio (the app's own
copy), stripped of script/style/nav/chrome, and reduced to prose paragraphs up
to the page's char cap. Everything runs inside the degoog server process.

Optionally, an external extractor can be used for higher-quality article
extraction (e.g. a small trafilatura service): set **External extractor URL**
to either a bare base (it appends `/extract?url=...&max_chars=...`) or a
template with `{url}` / `{max_chars}` placeholders. If the helper fails or
returns nothing, the in-process path is used instead. A bearer token can be
set for the helper; it is only sent from the server, never to the browser.

## Settings

| Setting | Notes |
| --- | --- |
| Provider / base URL / key / model | Same as AI Summary |
| Thinking | Same as AI Summary (Auto / On / Off) |
| Results to include | How many results the summary may cite at all |
| Pages to fetch | Top N results to fetch in full. `0` = snippets only |
| Page char caps | `6000,1500,1500` — one cap per page; last value repeats |
| Page fetch timeout | Per-page wait, default 30s |
| External extractor URL / token | Optional trafilatura-style helper; blank = built-in extraction |
| Panel title | Overrides the panel badge text |

Token limit parameter, thinking, extra headers etc. behave exactly as in the
official AI Summary plugin. Enable **only one** of the two plugins at a time —
both render summaries above the results.

## Differences from upstream

- `src/extract.js` — full-page fetch + extraction (built-in cheerio, optional
  external helper), added to the prompt path in `index.js` / `src/panel.js`
  (`buildFetchedUserPrompt`) and the system prompt note in `src/prompt.js`
- `src/settings.js` — the six settings above
- `script.js` — code blocks are sheltered from citation/highlight transforms
  so mid-stream code doesn't get corrupted
- Everything else is identical to upstream AI Summary; upstream changes can be
  pulled in wholesale

---

Part of the [macrogem-web-suite](https://github.com/redue-wq/macrogem-web-suite) collection.
