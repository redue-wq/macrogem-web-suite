const GBIF = "https://api.gbif.org/v1";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const DEFAULT_MIN_CONFIDENCE = 90;
const LOOSE_MIN_CONFIDENCE = 75;
// Words that are also common non-biology search terms (programming
// languages, brands...). A query that is exactly one of these never gets
// a card, even when the backbone matches it perfectly.
const DEFAULT_SKIP_TERMS = ["python", "hydra"];

const apiCache = new Map();
const cacheExpiry = new Map();

let minConfidence = DEFAULT_MIN_CONFIDENCE;
let showMap = true;
let showPhoto = true;
let showStats = true;
let skipTerms = new Set(DEFAULT_SKIP_TERMS);
let template = "";

const _cacheGet = (key) => {
  const expiresAt = cacheExpiry.get(key);
  if (expiresAt == null || Date.now() > expiresAt) {
    apiCache.delete(key);
    cacheExpiry.delete(key);
    return null;
  }
  return apiCache.get(key) ?? null;
};

const _cacheSet = (key, value) => {
  if (apiCache.size >= CACHE_MAX_ENTRIES) {
    let oldestKey = null;
    let oldestExpiry = Infinity;
    for (const [k, exp] of cacheExpiry) {
      if (exp < oldestExpiry) {
        oldestExpiry = exp;
        oldestKey = k;
      }
    }
    if (oldestKey != null) {
      apiCache.delete(oldestKey);
      cacheExpiry.delete(oldestKey);
    }
  }
  apiCache.set(key, value);
  cacheExpiry.set(key, Date.now() + CACHE_TTL_MS);
};

const _esc = (s) => {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const _fetchJson = async (fetchFn, url) => {
  const cached = _cacheGet(url);
  if (cached != null) return cached;
  const res = await fetchFn(url, {
    headers: { Accept: "application/json", "User-Agent": "degoog-taxonomy-panel/1.0" },
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  _cacheSet(url, data);
  return data;
};

const _formatCount = (n) => {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
};

const IUCN_LABELS = {
  EX: "Extinct",
  EW: "Extinct in the Wild",
  CR: "Critically Endangered",
  EN: "Endangered",
  VU: "Vulnerable",
  NT: "Near Threatened",
  LRNT: "Lower Risk/near threatened",
  LRCD: "Lower Risk/conservation dependent",
  LC: "Least Concern",
  DD: "Data Deficient",
  NE: "Not Evaluated",
};

const IUCN_CATEGORY_LABELS = {
  EXINCT: "Extinct",
  EXTINCT: "Extinct",
  EXTINCT_IN_THE_WILD: "Extinct in the Wild",
  CRITICALLY_ENDANGERED: "Critically Endangered",
  ENDANGERED: "Endangered",
  VULNERABLE: "Vulnerable",
  NEAR_THREATENED: "Near Threatened",
  LEAST_CONCERN: "Least Concern",
  DATA_DEFICIENT: "Data Deficient",
  NOT_EVALUATED: "Not Evaluated",
  LOWER_RISK_NEAR_THREATENED: "Lower Risk/near threatened",
  LOWER_RISK_CONSERVATION_DEPENDENT: "Lower Risk/conservation dependent",
};

const _skippedTerm = (term) => skipTerms.has(String(term).trim().toLowerCase());

// Trailing taxonomic filler words ("hydra species", "python sp.") are
// stripped before matching: GBIF reads them as rank markers and, unable to
// parse the rest, answers with a coarse HIGHERRANK match (e.g. the whole
// kingdom Animalia) that would otherwise pass the confidence gate.
const FILLER_WORDS = new Set([
  // Taxonomic filler: GBIF reads these as rank markers.
  "species", "sp", "spp", "genus", "taxon",
  // Generic life-form words that often trail a taxon in casual queries
  // ("hydra animal", "python snake") but carry no matching value.
  // Note: no "fungi" — that is also the kingdom's scientific name.
  "animal", "animals", "plant", "plants", "tree", "trees",
  "snake", "snakes", "bird", "birds", "fish", "fishes",
  "insect", "insects", "flower", "flowers", "fungus",
]);

const _normalizeTerm = (term) => {
  let words = String(term).trim().split(/\s+/);
  while (words.length > 1) {
    const last = words[words.length - 1].toLowerCase().replace(/\.$/, "");
    if (!FILLER_WORDS.has(last)) break;
    words = words.slice(0, -1);
  }
  return words.join(" ");
};

const _parseQuery = (raw) => {
  const q = String(raw ?? "").trim();
  if (!q || q.startsWith("!")) return "";
  // Keep taxon-name shaped queries only: a handful of words, no URLs.
  const words = q.split(/\s+/);
  if (words.length > 6 || q.length > 80 || /https?:\/\//i.test(q)) return "";
  return q;
};

const _commonName = (record, usage) => {
  const names = record?.vernacularNames ?? [];
  const english = names.find((v) => (v.language ?? "").toLowerCase() === "en");
  return english?.vernacularName ?? usage?.vernacularName ?? "";
};

const _firstMediaUrl = (occ) => {
  const jpg = (u) => /\.(jpe?g|png|webp)(\?|$)/i.test(u);
  let fallback = "";
  for (const m of occ?.media ?? []) {
    if (!m?.identifier) continue;
    const url = String(m.identifier);
    if (jpg(url)) return url;
    if (!fallback) fallback = url;
  }
  const ext = occ?.extensions?.["http://rs.tdwg.org/ac/terms/Multimedia"] ?? [];
  for (const m of ext) {
    const uri =
      m?.["http://rs.tdwg.org/ac/terms/accessURI"] ?? m?.["http://purl.org/dc/terms/identifier"];
    if (uri && jpg(String(uri))) return String(uri);
    if (uri && !fallback) fallback = String(uri);
  }
  return fallback;
};

// Among a few candidate occurrences, prefer a direct image file with a
// stated license — a weak but real quality signal that avoids publisher
// pages and unlicensed spectrograms.
const _bestPhoto = (occurrences) => {
  const candidates = occurrences.map(_firstMediaUrl).filter(Boolean);
  if (candidates.length === 0) return "";
  const licensed = occurrences.find((occ, i) => {
    const media = occ?.media ?? [];
    return (
      candidates[i] &&
      media.some((m) => m?.format?.startsWith?.("image/") && m?.license)
    );
  });
  return licensed ? candidates[occurrences.indexOf(licensed)] ?? candidates[0] : candidates[0];
};

// Vernacular fallback: search the backbone's common-name index and accept
// only an exact, case-insensitive match of the whole query.
const BACKBONE_KEY = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";

const _vernacularMatch = async (fetchFn, term) => {
  const wanted = term.toLowerCase();
  const data = await _fetchJson(
    fetchFn,
    `${GBIF}/species/search?q=${encodeURIComponent(term)}&qField=VERNACULAR` +
      `&datasetKey=${BACKBONE_KEY}&status=ACCEPTED&limit=20`,
  );
  const hits = [];
  for (const r of data?.results ?? []) {
    if (!r?.key) continue;
    for (const v of r.vernacularNames ?? []) {
      const name = (v?.vernacularName ?? "").toLowerCase();
      if (name && name === wanted) {
        hits.push({
          key: r.key,
          scientificName: r.canonicalName || r.scientificName || "",
          vernacular: v.vernacularName,
          rank: r.rank ?? "",
        });
        break;
      }
    }
  }
  if (hits.length === 0) return null;
  // "gray wolf" matches both Canis lupus and C. l. familiaris — the full
  // species is almost always what a searcher means.
  return hits.find((h) => h.rank === "SPECIES") ?? hits[0];
};

const _render = (data) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");

export const slot = {
  isClientExposed: false,
  id: "taxonomy-panel",
  name: "Taxonomy Panel",
  position: "above-results",
  waitForResults: false,
  description:
    "When a search query is a species or other taxon name, shows a GBIF card above results with the full classification tree, IUCN status, occurrence stats and a range map.",

  settingsSchema: [
    {
      key: "minConfidence",
      label: "Match confidence",
      type: "text",
      placeholder: "90",
      description: "0–100. Only queries the GBIF backbone matches with at least this confidence show a card.",
    },
    {
      key: "skipTerms",
      label: "Hide for bare searches",
      type: "textarea",
      default: "python, hydra",
      description:
        "Comma-separated words that get no card when searched alone, for names that are usually something else (like the Python programming language). Adding context brings the card back: \"python animal\" or \"hydra species\" still show it.",
    },
    {
      key: "showMap",
      label: "Show range map",
      type: "toggle",
      default: "true",
    },
    {
      key: "showStats",
      label: "Show occurrence stats",
      type: "toggle",
      default: "true",
    },
    {
      key: "showPhoto",
      label: "Show representative photo",
      type: "toggle",
      default: "true",
    },
  ],

  init(ctx) {
    template = ctx.template;
  },

  configure(settings) {
    const n = parseInt(settings?.minConfidence ?? "90", 10);
    minConfidence = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : DEFAULT_MIN_CONFIDENCE;
    showMap = settings?.showMap !== "false";
    showStats = settings?.showStats !== "false";
    showPhoto = settings?.showPhoto !== "false";
    skipTerms = new Set(
      String(settings?.skipTerms ?? DEFAULT_SKIP_TERMS.join(", "))
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  },

  trigger(query) {
    return _parseQuery(query).length > 0;
  },

  async execute(query, context) {
    const rawTerm = _parseQuery(query);
    const term = _normalizeTerm(rawTerm);
    if (!term) return { title: "", html: "" };
    // "plant species", "animal" — queries that are nothing but filler words
    // would still match a whole kingdom exactly, which is never a useful card.
    if (FILLER_WORDS.has(term.toLowerCase())) return { title: "", html: "" };
    // The skip list only suppresses the bare word ("python"); an explicitly
    // qualified query ("python animal", "hydra species") shows the searcher
    // wants the organism, so it gets a card.
    if (_skippedTerm(rawTerm)) return { title: "", html: "" };
    const fillerStripped = term !== rawTerm;

    const fetchFn = context?.fetch || fetch;

    try {
      const match = await _fetchJson(
        fetchFn,
        `${GBIF}/species/match?name=${encodeURIComponent(term)}&strict=false`,
      );

      let key = "";
      let matchCanonical = "";
      let loose = false;
      let commonOverride = "";

      if (!match?.synonym && match?.usageKey) {
        loose = match.matchType !== "EXACT" && match.matchType !== "VERBATIM";
        // A HIGHERRANK fallback above genus after filler stripping ("hydra
        // species" → kingdom Animalia) is a parse failure — fall through to
        // the vernacular index instead. But a higher taxon typed as-is
        // ("animalia", "aves", "chordata") is a legitimate card.
        const tooCoarse =
          fillerStripped && match.matchType === "HIGHERRANK" && match.rank !== "GENUS";
        const threshold = loose ? Math.max(minConfidence, LOOSE_MIN_CONFIDENCE) : minConfidence;
        if (!tooCoarse && (match.confidence ?? 0) >= threshold) {
          key = match.usageKey;
          matchCanonical = match.canonicalName ?? "";
        }
      }

      if (!key) {
        // Scientific match failed (or was too fuzzy) — try the vernacular
        // name index, so queries like "grizzly bear" still get a card.
        // Only exact common-name hits count; partial phrases ("grizzly
        // bear prickly-pear cactus") are ignored.
        const found = await _vernacularMatch(fetchFn, term);
        if (!found) return { title: "", html: "" };
        key = found.key;
        matchCanonical = found.scientificName;
        commonOverride = found.vernacular;
      }

      const [record, iucn, occ, photo] = await Promise.all([
        _fetchJson(fetchFn, `${GBIF}/species/${key}`),
        _fetchJson(fetchFn, `${GBIF}/species/${key}/iucnRedListCategory`),
        _fetchJson(
          fetchFn,
          `${GBIF}/occurrence/search?taxonKey=${key}&limit=1&facet=country&facetLimit=4&sortBy=eventDate&sortOrder=DESC`,
        ),
        showPhoto
          ? _fetchJson(
              fetchFn,
              `${GBIF}/occurrence/search?taxonKey=${key}&mediaType=stillImage&limit=5`,
            )
          : Promise.resolve(null),
      ]);

      const usage = record ?? {};
      const scientific = usage.canonicalName || matchCanonical || usage.scientificName || term;
      const authorship = usage.authorship ?? "";
      const common = commonOverride || _commonName(record, match);
      const clades = [
        usage.kingdom,
        usage.phylum,
        usage.class,
        usage.order,
        usage.family,
        usage.genus,
      ].filter(Boolean);

      const count = occ?.count ?? 0;
      const countries = (occ?.facets?.[0]?.counts ?? [])
        .slice(0, 3)
        .map((f) => _esc(f.name))
        .join(", ");
      const lastSeen = occ?.results?.[0]?.eventDate ?? "";
      const photoUrl = showPhoto ? _bestPhoto(photo?.results ?? []) : "";

      const proxied = (url) =>
        url && context?.signProxyUrl ? context.signProxyUrl(url) : url;

      const badge = (cls, text) =>
        text ? `<span class="tp-badge tp-badge--${cls}">${_esc(text)}</span>` : "";

      const iucnCode = iucn?.code ?? "";
      const iucnLabel =
        IUCN_CATEGORY_LABELS[iucn?.category ?? ""] ?? IUCN_LABELS[iucnCode] ?? iucnCode;
      const iucnHtml = iucnLabel
        ? badge(`iucn--${(iucnCode || iucnLabel).toLowerCase()}`, `IUCN · ${iucnLabel}`)
        : "";

      const mapHtml =
        showMap && count > 0
          ? `<div class="tp-map">` +
            `<img class="tp-map-base" loading="lazy" alt="" src="${_esc(
              proxied("https://tile.gbif.org/3857/omt/0/0/0@2x.png?style=gbif-classic"),
            )}">` +
            `<img class="tp-map-dots" loading="lazy" alt="GBIF occurrence density map" src="${_esc(
              proxied(`${GBIF.replace("/v1", "")}/v2/map/occurrence/density/0/0/0@2x.png?taxonKey=${key}`),
            )}">` +
            `</div>`
          : "";

      const photoHtml = photoUrl
        ? `<img class="tp-photo" loading="lazy" alt="" src="${_esc(proxied(photoUrl))}">`
        : "";

      const statsHtml = showStats
        ? `<div class="tp-stats">` +
          `<span><strong>${_formatCount(count)}</strong> occurrences</span>` +
          (countries ? `<span>${countries}</span>` : "") +
          (lastSeen ? `<span>last recorded ${_esc(String(lastSeen).slice(0, 10))}</span>` : "") +
          `</div>`
        : "";

      const lineageHtml = clades.length
        ? `<div class="tp-lineage">${clades
            .map((c) => `<span class="tp-clade">${_esc(c)}</span>`)
            .join('<span class="tp-arrow">›</span>')}</div>`
        : "";

      const headHtml =
        `<div class="tp-head">` +
        (photoHtml ? `<div class="tp-photo-box">${photoHtml}</div>` : "") +
        `<div class="tp-head-meta">` +
        `<div class="tp-name">` +
        (common ? `<span class="tp-common">${_esc(common)}</span> ` : "") +
        `<span class="tp-scientific"><em>${_esc(scientific)}</em></span>` +
        (authorship ? ` <span class="tp-authorship">${_esc(authorship)}</span>` : "") +
        `</div>` +
        `<div class="tp-badges">` +
        badge("rank", _esc((usage.rank ?? match.rank ?? "").toLowerCase())) +
        badge("status", usage.taxonomicStatus ? _esc(usage.taxonomicStatus.toLowerCase()) : "") +
        iucnHtml +
        `</div>` +
        lineageHtml +
        statsHtml +
        `</div>` +
        `</div>`;

      const footerHtml = `<a class="tp-link" href="https://www.gbif.org/species/${key}" rel="noopener">Open on GBIF ›</a>`;

      const looseNote = loose ? `<span class="tp-loose">probable match</span> ` : "";
      const content =
        `<div class="tp-card">${looseNote}${headHtml}${mapHtml}${footerHtml}</div>`;
      return { title: common || scientific, html: _render({ content }) };
    } catch {
      return { title: "", html: "" };
    }
  },
};

export default { slot };
