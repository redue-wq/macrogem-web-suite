import { SETTINGS_SCHEMA } from "./settings.js";
import { HEADERS } from "./const/gbif.js";
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
  // equal the query ("cat" -> Felis, "red fox" -> Vulpes vulpes). Modifier
  // compounds ("Fox's Shrew" for "fox") don't qualify; when nothing equals
  // the query the engine falls back to the text search with a relevance
  // filter instead of guessing a taxon.
  static _pick(results, query) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    let best = null;
    let bestScore = 0;
    for (const r of results ?? []) {
      if (!r?.key) continue;
      for (const v of r.vernacularNames ?? []) {
        const words = String(v?.vernacularName ?? "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        if (words.length !== tokens.length) continue;
        if (!tokens.every((t, i) => words[i] === t)) continue;
        // For imagery a genus-level vernacular match ("Fox" -> Vulpes) is
        // the safer bet: species-epithet coincidences ("Fox's Shrew") rank
        // below it, and the occurrence search covers all descendants.
        const rankBonus = r.rank === "GENUS" ? 3 : r.rank === "SPECIES" ? 2 : 1;
        if (rankBonus > bestScore || !best) {
          bestScore = rankBonus;
          best = r;
        }
      }
    }
    return best?.key ?? null;
  }

  async _resolveTaxon(query, doFetch) {
    if (this._resolutions.has(query)) return this._resolutions.get(query);
    let verdict = null;
    try {
      const res = await doFetch(buildResolveUrl(query), { headers: HEADERS });
      verdict = GbifImagesEngine._pick((await res.json())?.results, query);
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
      const taxonKey = await this._resolveTaxon(q, doFetch);
      const response = await doFetch(buildSearchUrl(q, page, this.recordType, taxonKey), {
        headers: HEADERS,
      });
      context?.sentinel?.(response, this.name);
      return parseResults(await response.json(), this.name, taxonKey ? "" : q);
    } catch (e) {
      if (e?.name === "SentinelBreach") throw e;
      return [];
    }
  }
}
