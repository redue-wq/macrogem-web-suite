import { API_URL, PAGE_SIZE } from "./const/loc.js";

export const buildSearchUrl = (query, page) => {
  const params = new URLSearchParams({
    q: query,
    fo: "json",
    c: String(PAGE_SIZE),
    sp: String(Math.max(page || 1, 1)),
    at: "results,pagination",
  });
  return `${API_URL}?${params}`;
};
