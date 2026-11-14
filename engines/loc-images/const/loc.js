export const API_URL = "https://www.loc.gov/photos/";

export const PAGE_SIZE = 20;

export const HEADERS = {
  "User-Agent": "degoog/1.0 (+https://github.com/redue-wq/macrogem-web-suite)",
  Accept: "application/json",
};

// The API returns collection-level and web page results alongside items;
// neither has an image to show.
export const SKIPPED_FORMATS = new Set(["collection", "web page"]);
