import { SKIPPED_FORMATS } from "./const/loc.js";

// image_url entries are protocol-relative and carry size metadata in the
// fragment, e.g. "//cdn.loc.gov/.../_150px.jpg#h=150&w=100".
const _cleanImageUrl = (url) => {
  const base = (url ?? "").split("#")[0];
  if (!base) return "";
  return base.startsWith("//") ? `https:${base}` : base;
};

const _pickThumbnail = (imageUrls) =>
  _cleanImageUrl(imageUrls.find((u) => u.includes("150px")) ?? imageUrls[0]);

export const parseResults = (data, source) =>
  (data?.results ?? [])
    .map((item) => {
      const formats = item.original_format ?? [];
      if (formats.some((f) => SKIPPED_FORMATS.has(String(f).toLowerCase()))) return null;

      const imageUrls = item.image_url ?? [];
      if (!Array.isArray(imageUrls) || imageUrls.length === 0) return null;

      const pageUrl = item.id ?? item.url ?? "";
      if (!pageUrl) return null;

      const description = Array.isArray(item.description)
        ? item.description.join(" ")
        : (item.description ?? "");

      return {
        title: item.title ?? "",
        url: pageUrl,
        snippet: String(description).trim(),
        source,
        thumbnail: _pickThumbnail(imageUrls),
        imageUrl: _cleanImageUrl(imageUrls[imageUrls.length - 1]),
      };
    })
    .filter((r) => r && r.thumbnail && r.url);
