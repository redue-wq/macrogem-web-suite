import { mediaUrls } from "./const/gbif.js";

const BASIS_LABELS = {
  HUMAN_OBSERVATION: "observation",
  PRESERVED_SPECIMEN: "specimen",
  FOSSIL_SPECIMEN: "fossil",
  MATERIAL_SAMPLE: "material sample",
  MACHINE_OBSERVATION: "camera trap",
  LIVING_SPECIMEN: "living specimen",
  OCCURRENCE: "occurrence",
  OBSERVATION: "observation",
  MATERIAL_CITATION: "material citation",
};

const _taxonomy = (item) => {
  const groups = item?.classifications ?? {};
  const first = Object.values(groups)[0];
  const chain = (first?.classification ?? [])
    .map((c) => c?.name)
    .filter(Boolean);
  return chain;
};

const _title = (item) => {
  const common = item?.vernacularName ?? "";
  const scientific = item?.scientificName ?? "";
  if (common && scientific && !scientific.toLowerCase().startsWith(common.toLowerCase())) {
    return `${common} (${scientific})`;
  }
  return scientific || common || "Unidentified organism";
};

const _snippet = (item) => {
  const parts = [];
  const clades = _taxonomy(item);
  if (clades.length > 1) parts.push(clades.slice(0, -1).join(" › "));
  const who = item?.recordedBy;
  if (who) parts.push(`${BASIS_LABELS[item?.basisOfRecord] ?? "record"} by ${who}`);
  const where = item?.locality || item?.country || item?.stateProvince;
  if (where) parts.push(where);
  const when = item?.eventDate ?? item?.year;
  if (when) parts.push(String(when));
  return parts.join(" · ");
};

export const parseResults = (data, source) =>
  (data?.results ?? [])
    .map((item) => {
      const media = mediaUrls(item);
      if (media.length === 0) return null;

      const pageUrl = item?.key ? `https://www.gbif.org/occurrence/${item.key}` : "";
      if (!pageUrl) return null;

      // Prefer a direct image file over publisher pages that would render
      // as broken thumbnails.
      const usable = media.find((m) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(m.url)) ?? media[0];

      return {
        title: _title(item),
        url: pageUrl,
        snippet: _snippet(item),
        source,
        thumbnail: usable.url,
        imageUrl: usable.url,
      };
    })
    .filter((r) => r && r.thumbnail && r.url);
