import { HEADERS } from "./const/loc.js";
import { buildSearchUrl } from "./request.js";
import { parseResults } from "./parse.js";

export const type = "images";

export default class LocImagesEngine {
  isClientExposed = false;
  name = "Library of Congress";
  bangShortcut = "loc";

  async executeSearch(query, page = 1, _timeFilter, context) {
    const q = query.trim();
    if (!q) return [];

    const doFetch = context?.fetch ?? fetch;

    try {
      const response = await doFetch(buildSearchUrl(q, page), { headers: HEADERS });
      context?.sentinel?.(response, this.name);
      return parseResults(await response.json(), this.name);
    } catch (e) {
      if (e?.name === "SentinelBreach") throw e;
      return [];
    }
  }
}
