import { SETTINGS_SCHEMA } from "./settings.js";
import { HEADERS } from "./const/gbif.js";
import { buildSearchUrl } from "./request.js";
import { parseResults } from "./parse.js";

export const type = "images";

export default class GbifImagesEngine {
  isClientExposed = false;
  name = "GBIF";
  bangShortcut = "gbif";
  settingsSchema = SETTINGS_SCHEMA;

  recordType = "any";

  configure(settings) {
    if (typeof settings?.recordType === "string") this.recordType = settings.recordType;
  }

  async executeSearch(query, page = 1, _timeFilter, context) {
    const q = query.trim();
    if (!q) return [];

    const doFetch = context?.fetch ?? fetch;

    try {
      const response = await doFetch(buildSearchUrl(q, page, this.recordType), {
        headers: HEADERS,
      });
      context?.sentinel?.(response, this.name);
      return parseResults(await response.json(), this.name);
    } catch (e) {
      if (e?.name === "SentinelBreach") throw e;
      return [];
    }
  }
}
