import { API_URL, BASIS_MAP, PAGE_SIZE } from "./const/gbif.js";

export const buildSearchUrl = (query, page, recordType) => {
  const params = new URLSearchParams({
    q: query,
    mediaType: "stillImage",
    limit: String(PAGE_SIZE),
    offset: String(Math.max(((page || 1) - 1) * PAGE_SIZE, 0)),
  });
  const basis = BASIS_MAP[recordType];
  if (basis) params.set("basisOfRecord", basis);
  return `${API_URL}?${params}`;
};
