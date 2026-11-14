import { SETTINGS_SCHEMA } from "./settings.js";
import { buildHeaders, buildSearchUrl } from "./request.js";
import { parseResults } from "./parse.js";

export default class MarginaliaEngine {
  isClientExposed = false;
  name = "Marginalia";
  bangShortcut = "marg";
  settingsSchema = SETTINGS_SCHEMA;

  apiKey = "public";
  nsfw = "off";

  configure(settings) {
    this.apiKey = settings.apiKey || "public";
    this.nsfw = settings.nsfw || "off";
  }

  async executeSearch(query, page = 1, _timeFilter, context) {
    const q = query.trim();
    if (!q) return [];

    const doFetch = context?.fetch ?? fetch;

    try {
      const response = await doFetch(buildSearchUrl(q, page, this.nsfw), {
        headers: buildHeaders(this.apiKey),
      });
      context?.sentinel?.(response, this.name);
      return parseResults(await response.json(), this.name);
    } catch (e) {
      if (e?.name === "SentinelBreach") throw e;
      return [];
    }
  }
}
