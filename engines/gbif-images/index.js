import { SETTINGS_SCHEMA } from "./settings.js";
import { HEADERS, API_URL } from "./const/gbif.js";
import { buildResolveUrl, buildSearchUrl } from "./request.js";
import { parseResults } from "./parse.js";

export const type = "images";

export default class GbifImagesEngine {
  isClientExposed = false;
  name = "GBIF";
  bangShortcut = "gbif";
  settingsSchema = SETTINGS_SCHEMA;

  recordType = "any";

  // query -> usage key | null ("not resolvable, use text search")
  _resolutions = new Map();

  configure(settings) {
    if (typeof settings?.recordType === "string") this.recordType = settings.recordType;
  }

  // Resolve a common name to a usage key through the backbone's vernacular
  // index, same approach as the taxonomy panel: the vernacular name must
  // equal the query ("cat" -> Felis, "grey wolf" -> Canis lupus). Modifier
  // compounds ("Fox's Shrew" for "fox") don't qualify. Equal candidates are
  // ranked by how many image-bearing occurrences actually sit behind them —
  // GBIF carries mislabelled vernaculars ("Dog" -> coyote), and a taxon
  // without imagery is worthless to an image engine. No exact match -> null,
  // which falls back to the text search with a relevance filter.
  static _exact(results, query) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const out = [];
    const seen = new Set();
    for (const r of results ?? []) {
      if (!r?.key || seen.has(r.key)) continue;
      for (const v of r.vernacularNames ?? []) {
        const words = String(v?.vernacularName ?? "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        if (words.length !== tokens.length) continue;
        if (!tokens.every((t, i) => words[i] === t)) continue;
        out.push({ key: r.key, rank: r.rank, name: r.canonicalName ?? r.scientificName ?? "" });
        seen.add(r.key);
        break;
      }
    }
    return out;
  }

  async _resolveTaxon(query, doFetch) {
    if (this._resolutions.has(query)) return this._resolutions.get(query);
    let verdict = null;
    try {
      const res = await doFetch(buildResolveUrl(query), { headers: HEADERS });
      const candidates = GbifImagesEngine._exact((await res.json())?.results, query).slice(0, 5);
      const scored = await Promise.all(
        candidates.map(async (c) => {
          try {
            const r = await doFetch(`${API_URL}?taxonKey=${c.key}&mediaType=stillImage&limit=0`, {
              headers: HEADERS,
            });
            return { ...c, count: (await r.json())?.count ?? 0 };
          } catch {
            return { ...c, count: 0 };
          }
        }),
      );
      scored.sort((a, b) => b.count - a.count);
      // A broader-rank candidate (Canis 146k images) usually wins on raw
      // count, but swallows its children (coyotes in "dog" results). Prefer
      // a species-level candidate when its imagery isn't a rounding error.
      const _specific = (c) => ["SPECIES", "SUBSPECIES", "VARIETY", "FORM"].includes(c.rank);
      const broad = scored.find((c) => !_specific(c));
      const specific = scored
        .filter(_specific)
        .find((c) => c.count >= Math.max(50, 0.05 * (broad?.count ?? 0)));
      const best = specific ?? scored[0];
      if (best?.count > 0) {
        verdict = { key: best.key, domestic: /\bfamiliaris\b/i.test(best.name) };
      }
    } catch {
      // resolution is best-effort; fall back to text search
    }
    this._resolutions.set(query, verdict);
    return verdict;
  }

  async executeSearch(query, page = 1, _timeFilter, context) {
    const q = query.trim();
    if (!q) return [];

    const doFetch = context?.fetch ?? fetch;

    try {
      const resolved = await this._resolveTaxon(q, doFetch);
      const response = await doFetch(buildSearchUrl(q, page, this.recordType, resolved?.key), {
        headers: HEADERS,
      });
      context?.sentinel?.(response, this.name);
      return parseResults(await response.json(), this.name, resolved ? "" : q, resolved);
    } catch (e) {
      if (e?.name === "SentinelBreach") throw e;
      return [];
    }
  }
}
