import { API_URL, NSFW_MAP, PAGE_SIZE } from "./const/search.js";

export const buildSearchUrl = (query, page, nsfw) => {
  const params = new URLSearchParams({
    query,
    count: String(PAGE_SIZE),
    page: String(Math.max(page || 1, 1)),
    nsfw: NSFW_MAP[nsfw] ?? "0",
  });
  return `${API_URL}?${params}`;
};

export const buildHeaders = (apiKey) => ({
  Accept: "application/json",
  "API-Key": apiKey,
});
