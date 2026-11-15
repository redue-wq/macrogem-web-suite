const GBIF = "https://api.gbif.org/v1";
const GBIF_V2 = "https://api.gbif.org/v2";
// Catalogue of Life eXtended Release — GBIF's primary taxonomy since June
// 2026. The legacy GBIF backbone (d7dddbf4-…) is frozen at 2023 and cannot
// represent intermediate ranks, which is why fish higher taxa (Osteichthyes,
// Actinopterygii…) vanished from it. COL XR has them as gigaclass/parvphylum.
const COL_KEY = "7ddf754f-d193-4cc9-b351-99906754a03b";
// ChecklistBank's key for the COL XR release GBIF mirrors; used only to look
// up per-taxon vernacular names. CoL taxon IDs are stable across releases.
const CLB_COL_KEY = "315192";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const DEFAULT_MIN_CONFIDENCE = 90;
const LOOSE_MIN_CONFIDENCE = 75;
// Words that are also common non-biology search terms (programming
// languages, brands...). A query that is exactly one of these never gets
// a card, even when GBIF matches it perfectly.
const DEFAULT_SKIP_TERMS = ["python", "hydra", "corona"];

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

// Match a scientific name against the Catalogue of Life eXtended Release.
// The v2 match response carries everything the card needs in one call:
// usage (canonical name, authorship, rank), the full classification
// (including intermediate ranks), match diagnostics, and the IUCN category
// relayed from the IUCN checklist via additionalStatus.
const _match = async (fetchFn, name) => {
  const m = await _fetchJson(
    fetchFn,
    `${GBIF_V2}/species/match?scientificName=${encodeURIComponent(name)}&checklistKey=${COL_KEY}`,
  );
  if (!m || m.synonym) return null;
  const u = m.usage;
  if (!u?.key) return null;
  const d = m.diagnostics ?? {};
  const iucn = (m.additionalStatus ?? []).find((s) => s.datasetAlias === "IUCN") ?? null;
  return {
    key: u.key,
    canonical: u.canonicalName ?? u.name ?? "",
    authorship: u.authorship ?? "",
    rank: u.rank ?? "",
    status: u.status ?? "",
    matchType: d.matchType ?? "",
    confidence: d.confidence ?? 0,
    classification: m.classification ?? [],
    iucn,
  };
};

// English common name for a usage, straight from ChecklistBank. Only needed
// for direct scientific matches; vernacular-resolved queries already carry
// the name the searcher typed.
const _englishVernacular = async (fetchFn, key) => {
  const list = await _fetchJson(
    fetchFn,
    `https://api.checklistbank.org/dataset/${CLB_COL_KEY}/taxon/${key}/vernacular`,
  );
  if (!Array.isArray(list)) return "";
  const eng = list.find((v) =>
    ["en", "eng"].includes(String(v?.language ?? "").toLowerCase()),
  );
  return eng?.name ?? "";
};

// COL XR duplicates every usage once per integrated source, and occurrence
// data is only linked to the subset of usages GBIF matches records against
// (the keys v2/match returns — search result keys often have 0 occurrences).
// So every resolution path must end in a v2 match.

// A candidate resolved without a v2 match (homonyms whose bare name match
// returns NONE even though the taxon exists, e.g. class Amphibia). Verified
// by actual occurrence data. The ChecklistBank row carries the full
// classification chain (lowercase ranks) — normalize it for the tree view.
const _fromCandidate = (candidate, occCount) => ({
  key: candidate.key,
  canonical: candidate.canonicalName ?? candidate.scientificName ?? "",
  authorship: candidate.authorship ?? "",
  rank: candidate.rank ?? "",
  status: candidate.taxonomicStatus ?? "ACCEPTED",
  matchType: "EXACT",
  confidence: 100,
  classification: (candidate.classification ?? []).map((c) => ({
    name: c.name ?? "",
    rank: String(c.rank ?? "").toUpperCase(),
  })),
  iucn: null,
  occCount,
});

// GBIF returns matchType NONE when several taxa share a name ("Multiple
// equal matches") — e.g. the ant genus Solenopsis versus a little-known
// plant genus, or the genera named Amphibia drowning the class. GBIF's own
// species search only returns source duplicates without authorship, so
// resolve through ChecklistBank's cleaner index: it lists each homonym once
// with its authorship, and "Genus Author, 1840" matches uniquely. Among
// equal candidates the one with the most occurrences wins — the clade a
// searcher means.
const _searchResolve = async (fetchFn, term, ranks) => {
  const wanted = term.toLowerCase();
  for (const rank of ranks) {
    const data = await _fetchJson(
      fetchFn,
      `https://api.checklistbank.org/dataset/${CLB_COL_KEY}/nameusage/search` +
        `?q=${encodeURIComponent(term)}&rank=${rank}&limit=10`,
    );
    const rows = (data?.result ?? []).filter((r) => {
      const usage = r?.usage ?? {};
      const name = usage.name ?? {};
      return (
        String(usage.status ?? "").toLowerCase() === "accepted" &&
        String(name.scientificName ?? "").toLowerCase() === wanted
      );
    });
    if (rows.length === 0) continue;

    let bestMatch = null;
    let bestCount = 0;
    for (const r of rows) {
      const name = r.usage.name ?? {};
      // Authorship turns "Solenopsis" (homonym) into "Solenopsis Westwood,
      // 1840" (unique) — the clean way to an occurrence-linked usage.
      const fullName = name.authorship
        ? `${name.scientificName} ${name.authorship}`
        : name.scientificName;
      let m = await _match(fetchFn, fullName);
      if (!m) m = await _match(fetchFn, name.scientificName);
      const key = m?.key ?? r.id;
      const occ = await _fetchJson(
        fetchFn,
        `${GBIF}/occurrence/search?checklistKey=${COL_KEY}&taxonKey=${key}&limit=0`,
      );
      const count = occ?.count ?? 0;
      if (count > bestCount) {
        bestCount = count;
        bestMatch = m
          ? { ...m, occCount: count }
          : _fromCandidate(
              {
                key: r.id,
                canonicalName: name.scientificName,
                authorship: name.authorship ?? "",
                rank,
                taxonomicStatus: "ACCEPTED",
                classification: r.classification ?? [],
              },
              count,
            );
      }
    }
    if (bestMatch) return bestMatch;
  }
  return null;
};

// Vernacular fallback: resolve the common name through the vernacular
// indexes, then match the resulting scientific name against COL XR for the
// occurrence-linked usage. Two sources, deduplicated:
//   - the legacy backbone index (frozen at 2023, but authoritative)
//   - COL XR's own index (carries current names the frozen backbone lacks;
//     "snow leopard" → Panthera uncia, not the backbone's Uncia uncia)
// Candidates are ranked by source consensus — how many independent exact
// entries agree — not by occurrence volume, which mislabels win ("fin
// whale" tagged "blue whale" has more records than the blue whale).
// "gray wolf" matches Canis lupus and C. l. familiaris; "giant panda" the
// species and its genus — consensus favors the full species.
const BACKBONE_KEY = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";

const _vernacularResolve = async (fetchFn, term) => {
  const wanted = term.toLowerCase();
  const byName = new Map();
  const addHits = (results) => {
    for (const r of results) {
      if (!r?.key) continue;
      for (const v of r.vernacularNames ?? []) {
        const name = String(v?.vernacularName ?? "");
        if (!name || name.toLowerCase() !== wanted) continue;
        const canonical = r.canonicalName || r.scientificName || "";
        if (!canonical) continue;
        const e = byName.get(canonical) ?? { canonical, display: name, count: 0, species: false };
        e.count += 1;
        if (r.rank === "SPECIES") e.species = true;
        byName.set(canonical, e);
        break;
      }
    }
  };
  const backbone = await _fetchJson(
    fetchFn,
    `${GBIF}/species/search?q=${encodeURIComponent(term)}&qField=VERNACULAR` +
      `&datasetKey=${BACKBONE_KEY}&status=ACCEPTED&limit=20`,
  );
  addHits(backbone?.results ?? []);
  const col = await _fetchJson(
    fetchFn,
    `${GBIF}/species/search?q=${encodeURIComponent(term)}&qField=VERNACULAR` +
      `&checklistKey=${COL_KEY}&status=ACCEPTED&limit=100`,
  );
  addHits(col?.results ?? []);
  if (byName.size === 0) return null;
  const entries = [...byName.values()].sort(
    (a, b) => b.count - a.count || Number(b.species) - Number(a.species),
  );
  let fallback = null;
  for (const e of entries.slice(0, 5)) {
    const m = await _match(fetchFn, e.canonical);
    if (!m) continue;
    // A valid name still needs occurrence data behind it to be worth a card.
    const occ = await _fetchJson(
      fetchFn,
      `${GBIF}/occurrence/search?checklistKey=${COL_KEY}&taxonKey=${m.key}&limit=0`,
    );
    if ((occ?.count ?? 0) > 0) return { match: m, vernacular: e.display };
    if (!fallback) fallback = { match: m, vernacular: e.display };
  }
  return fallback;
};

const _render = (data) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");

export const slot = {
  isClientExposed: false,
  id: "taxonomy-panel",
  name: "Taxonomy Panel",
  position: "above-results",
  waitForResults: false,
  description:
    "When a search query is a species or other taxon name, shows a GBIF card above results with the full classification tree, IUCN status, occurrence stats and a range map. Taxonomy comes from the Catalogue of Life, which GBIF uses as its primary classification.",

  settingsSchema: [
    {
      key: "minConfidence",
      label: "Match confidence",
      type: "text",
      placeholder: "90",
      description: "0–100. Only queries GBIF matches with at least this confidence show a card.",
    },
    {
      key: "skipTerms",
      label: "Hide for bare searches",
      type: "textarea",
      default: "python, hydra, corona",
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
      let m = await _match(fetchFn, term);
      let resolved = false;

      if (m) {
        const loose = m.matchType !== "EXACT" && m.matchType !== "VERBATIM";
        // A HIGHERRANK fallback above genus is a parse failure when (a) the
        // query was reduced by filler stripping ("hydra species"), or (b)
        // the matched taxon is not the query itself ("halcyon" → kingdom
        // Animalia). But an explicitly typed higher taxon ("animalia",
        // "aves", "chordata") is a legitimate card.
        const highRank = m.matchType === "HIGHERRANK" && m.rank !== "GENUS";
        const tooCoarse =
          highRank &&
          (fillerStripped || (m.canonical ?? "").toLowerCase() !== term.toLowerCase());
        const threshold = loose ? Math.max(minConfidence, LOOSE_MIN_CONFIDENCE) : minConfidence;
        if (!tooCoarse && m.confidence >= threshold) resolved = true;
      }

      let commonOverride = "";

      if (!resolved) {
        // Ambiguous or degraded name — resolve to the clade a searcher means.
        const found = await _searchResolve(fetchFn, term, [
          "GENUS",
          "CLASS",
          "ORDER",
          "FAMILY",
          "PHYLUM",
          "KINGDOM",
        ]);
        if (found) {
          m = found;
          resolved = true;
        }
      }

      if (!resolved) {
        // Scientific match failed — try the vernacular name index, so
        // queries like "grizzly bear" still get a card. Only exact
        // common-name hits count; partial phrases ("grizzly bear
        // prickly-pear cactus") are ignored.
        const v = await _vernacularResolve(fetchFn, term);
        if (v) {
          m = v.match;
          commonOverride = v.vernacular;
          resolved = true;
        }
      }

      if (!resolved || !m?.key) return { title: "", html: "" };

      const occBase =
        `${GBIF}/occurrence/search?checklistKey=${COL_KEY}&taxonKey=${m.key}`;
      const [occ, photo, vernacular] = await Promise.all([
        _fetchJson(
          fetchFn,
          `${occBase}&limit=1&facet=country&facetLimit=4&sortBy=eventDate&sortOrder=DESC`,
        ),
        showPhoto
          ? _fetchJson(fetchFn, `${occBase}&mediaType=stillImage&limit=5`)
          : Promise.resolve(null),
        commonOverride ? Promise.resolve("") : _englishVernacular(fetchFn, m.key),
      ]);

      const scientific = m.canonical || term;
      const authorship = m.authorship ?? "";
      const common = commonOverride || vernacular;

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

      const iucnCode = m.iucn?.statusCode ?? "";
      // "Not Evaluated" carries no information; showing it is just noise.
      const iucnLabel = iucnCode && iucnCode !== "NE" ? IUCN_LABELS[iucnCode] ?? iucnCode : "";
      const iucnHtml = iucnLabel
        ? badge(`iucn--${iucnCode.toLowerCase()}`, `IUCN · ${iucnLabel}`)
        : "";

      const mapHtml =
        showMap && count > 0
          ? `<div class="tp-map">` +
            `<img class="tp-map-base" loading="lazy" alt="" src="${_esc(
              proxied("https://tile.gbif.org/3857/omt/0/0/0@2x.png?style=gbif-classic"),
            )}">` +
            `<img class="tp-map-dots" loading="lazy" alt="GBIF occurrence density map" src="${_esc(
              proxied(
                `${GBIF_V2}/map/occurrence/density/0/0/0@2x.png?taxonKey=${m.key}&checklistKey=${COL_KEY}`,
              ),
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

      const lineageHtml = (() => {
        // GBIF catalog-style tree: each clade indented a level, rank label
        // right-aligned, the matched taxon highlighted. Deep chains (a
        // subspecies has ~19 ranks) fold their middle under a <details> so
        // the tree stays short and the indentation cannot reach the border.
        const cls = (m.classification ?? []).filter((c) => c?.name);
        if (!cls.length) return "";
        const row = (c, i) => {
          const current = i === cls.length - 1;
          const rank = String(c.rank ?? "");
          const rankLabel = rank
            ? rank.charAt(0).toUpperCase() + rank.slice(1).toLowerCase()
            : "";
          return (
            `<div class="tp-tree-row${current ? " tp-tree-current" : ""}" style="--tp-depth:${i}">` +
            `<span class="tp-tree-name">${_esc(c.name)}</span>` +
            (rankLabel ? `<span class="tp-tree-rank">${_esc(rankLabel)}</span>` : "") +
            `</div>`
          );
        };
        const FOLD_OVER = 9;
        const TAIL = 4;
        if (cls.length <= FOLD_OVER) {
          return `<div class="tp-tree">${cls.map(row).join("")}</div>`;
        }
        const mid = cls.slice(2, cls.length - TAIL);
        const fold =
          `<details class="tp-tree-fold">` +
          `<summary class="tp-tree-row" style="--tp-depth:2">` +
          `<span class="tp-tree-name">⋯ ${mid.length} intermediate ranks</span>` +
          `</summary>` +
          mid.map((c, i) => row(c, i + 2)).join("") +
          `</details>`;
        return (
          `<div class="tp-tree">` +
          cls.slice(0, 2).map((c, i) => row(c, i)).join("") +
          fold +
          cls.slice(-TAIL).map((c, i) => row(c, cls.length - TAIL + i)).join("") +
          `</div>`
        );
      })();

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
        badge("rank", _esc((m.rank ?? "").toLowerCase())) +
        badge("status", m.status ? _esc(m.status.toLowerCase()) : "") +
        iucnHtml +
        `</div>` +
        statsHtml +
        `</div>` +
        `</div>`;

      const footerHtml = `<a class="tp-link" href="https://www.gbif.org/taxon/${m.key}" rel="noopener">Open on GBIF ›</a>`;

      const bodyHtml =
        mapHtml || lineageHtml
          ? `<div class="tp-body">${mapHtml}${lineageHtml}</div>`
          : "";

      const looseNote =
        m.matchType !== "EXACT" && m.matchType !== "VERBATIM"
          ? `<span class="tp-loose">probable match</span> `
          : "";
      const content =
        `<div class="tp-card">${looseNote}${headHtml}${bodyHtml}${footerHtml}</div>`;
      return { title: common || scientific, html: _render({ content }) };
    } catch {
      return { title: "", html: "" };
    }
  },
};

export default { slot };
