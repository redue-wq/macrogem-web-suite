export const API_URL = "https://api.gbif.org/v1/occurrence/search";

// Catalogue of Life eXtended Release — GBIF's primary taxonomy since June
// 2026. Occurrence results then carry COL classifications (the legacy
// backbone is frozen at 2023 and missing intermediate ranks like the fish
// higher taxa).
export const COL_XR_KEY = "7ddf754f-d193-4cc9-b351-99906754a03b";

export const PAGE_SIZE = 20;

export const HEADERS = {
  "User-Agent": "degoog/1.0 (+https://github.com/redue-wq/macrogem-web-suite)",
  Accept: "application/json",
};

// "any" sends no basisOfRecord filter.
export const BASIS_MAP = {
  observations: "HUMAN_OBSERVATION",
  specimens: "PRESERVED_SPECIMEN",
  fossils: "FOSSIL_SPECIMEN",
};

// v1 keeps occurrence media in two shapes: the normalized `media` array on
// newer records, and the legacy Multimedia extension (AccessURI) on older ones.
const MEDIA_EXT = "http://rs.tdwg.org/ac/terms/Multimedia";
const ACCESS_URI = "http://rs.tdwg.org/ac/terms/accessURI";

export const mediaUrls = (item) => {
  const urls = [];
  for (const m of item?.media ?? []) {
    if (m?.identifier) urls.push({ url: String(m.identifier), license: m.license ?? "" });
  }
  for (const m of item?.extensions?.[MEDIA_EXT] ?? []) {
    const uri = m?.[ACCESS_URI] ?? m?.["http://purl.org/dc/terms/identifier"];
    if (uri) urls.push({ url: String(uri), license: m?.["http://purl.org/dc/elements/1.1/rights"] ?? "" });
  }
  return urls;
};
