import { API_URL, SPECIES_API_URL, BACKBONE_KEY, BASIS_MAP, PAGE_SIZE } from "./const/gbif.js";

export const buildResolveUrl = (query) => {
  const params = new URLSearchParams({
    q: query,
    qField: "VERNACULAR",
    datasetKey: BACKBONE_KEY,
    status: "ACCEPTED",
    limit: "100",
  });
  return `${SPECIES_API_URL}?${params}`;
};

export const buildSearchUrl = (query, page, recordType, taxonKey) => {
  const params = new URLSearchParams({
    mediaType: "stillImage",
    limit: String(PAGE_SIZE),
    offset: String(Math.max(((page || 1) - 1) * PAGE_SIZE, 0)),
  });
  if (taxonKey) params.set("taxonKey", String(taxonKey));
  else params.set("q", query);
  const basis = BASIS_MAP[recordType];
  if (basis) params.set("basisOfRecord", basis);
  return `${API_URL}?${params}`;
};
