# macrogem-web-suite

Microsoft Parody plugins I made for fun and personal use.

Community plugins and themes for [degoog](https://github.com/degoog-org/degoog) 

## Deep AI Summary — `plugins/deep-ai-summary`

AI summary panel, forked from the official [AI Summary](https://github.com/degoog-org/official-extensions) plugin (same slot, same providers, same look), plus:

<div align="center">
    <img width="700" src="./plugins/deep-ai-summary/screenshots/summary.png" />
</div>

1. **Full-page context:** instead of summarizing only the search snippets, the top result pages are fetched server side and their main text is given to the model as primary evidence (`--- Source [N] full text ---` blocks). Per-page char caps and timeout, and failures fall back to the snippet, so a broken page never breaks the summary. Extraction is built in.
2. **Custom panel title:** the panel badge text is a setting.
3. **Max sources:** how many results the summary cites at all.

## Taxonomy Panel — `plugins/taxonomy-panel`

When a query matches a taxon in the Catalogue of Life (GBIF's primary taxonomy), shows a card above the results with the full classification tree, IUCN status, occurrence stats and a range map.

<div align="center">
    <img width="700" src="./plugins/taxonomy-panel/screenshots/1.webp" />
</div>

## Marginalia — `engines/marginalia`

Marginalia Search, the indie engine indexing the small, old and text-heavy web.

<div align="center">
    <img width="700" src="./engines/marginalia/screenshots/1.webp" />
</div>

## GBIF — `engines/gbif-images`

Photos of life on Earth from the Global Biodiversity Information Facility: field observations, herbarium sheets, museum specimens and fossils, through the official GBIF API. No key needed.

<div align="center">
    <img width="400" src="./engines/gbif-images/screenshots/1.webp" />
</div>

## Bong — `themes/bong`

- Bong theme.

<div align="center">
    <img width="700" src="./themes/bong/screenshots/home.png" />
</div>

<div align="center">
    <img width="700" src="./themes/bong/screenshots/home-dark.png" />
</div>

<div align="center">
    <img width="700" src="./themes/bong/screenshots/results.png" />
</div>
