export const API_URL = "https://api.gbif.org/v1/occurrence/search";
export const SPECIES_API_URL = "https://api.gbif.org/v1/species/search";

// GBIF's occurrence q= search matches author abbreviations ("Cat." of
// Knautia subcanescens Cat.), so common-name queries resolve through the
// backbone's vernacular index first — same approach as the taxonomy panel.
export const BACKBONE_KEY = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";

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
