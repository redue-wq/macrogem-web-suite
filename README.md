# macrogem-web-suite

Community plugins and themes for [degoog](https://github.com/degoog-org/degoog) — Microslop implies the existence of Macrogem.

Install from degoog's **Extensions** page by adding this repo, or clone/copy the folders into your data directory by hand.

## Deep AI Summary — `plugins/deep-ai-summary`

AI summary panel, forked from the official [AI Summary](https://github.com/degoog-org/official-extensions) plugin and rebased onto it (same slot, same providers, same look), plus:

1. **Full-page context** — instead of summarizing only the search snippets, the top result pages are fetched server side and their main text is given to the model as primary evidence (`--- Source [N] full text ---` blocks). Per-page char caps and timeout, and failures fall back to the snippet, so a broken page never breaks the summary. Extraction is built in (cheerio-based, zero setup); an external trafilatura-style helper is optional.
2. **Custom panel title** — the panel badge text is a setting.
3. **Max sources** — how many results the summary cites at all.

Works with the same providers as upstream: OpenAI, OpenAI-compatible, OpenRouter, Ollama, llama.cpp, vLLM, LM Studio, Gemini, Anthropic and Perplexity.

## Bong — `themes/bong`

A zen-based theme by [fccview](https://github.com/degoog-org/official-extensions), rearranged:

- Bong banner as the homepage and results logo (white-text variant in dark mode)
- Breaking Bad intro green smoke as the home-page background (light/dark variants)
- Results tabs, meta line, result column and filter fields aligned to the search bar
- AI summary panel restyled; `__CUSTOM_CSS__` still works as an override layer

---

Everything here is tested against degoog 1.1.1. Issues and PRs welcome.
