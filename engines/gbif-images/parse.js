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

export const parseResults = (data, source, query, resolved) =>
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
        _item: item,
      };
    })
    .filter((r) => r && r.thumbnail && r.url)
    .filter((r) => _notDomestic(r._item, resolved))
    .filter((r) => _nameRelevant(query, r._item))
    .sort((a, b) => _prettyHost(b._item) - _prettyHost(a._item))
    .map(({ _item, ...r }) => r);

// GBIF's backbone nests the domestic dog inside the wolf (Canis
// familiaris under Canis lupus), so a "grey wolf" search is ~70% dogs.
// Skip familiaris occurrences — unless the query itself resolved to the
// dog ("dog" -> its own taxon).
const _notDomestic = (item, resolved) => {
  if (!/\bfamiliaris\b/i.test(item?.scientificName ?? "")) return true;
  return resolved?.domestic === true;
};

// GBIF ingests community photos (iNaturalist, Flickr) alongside camera-trap
// and museum media; no quality signal exists on the API, but the media host
// is a good proxy. Community-hosted images first, research media after.
const _prettyHost = (item) => {
  const urls = [
    ...(item?.media ?? []).map((m) => m?.identifier ?? ""),
    ...(item?.extensions?.["http://rs.tdwg.org/ac/terms/Multimedia"] ?? [])
      .map((m) => m?.["http://rs.tdwg.org/ac/terms/accessURI"] ?? m?.["http://purl.org/dc/terms/identifier"] ?? ""),
  ];
  return urls.some((u) => /inaturalist|staticflickr|flickr\.com|wikimedia/i.test(u)) ? 1 : 0;
};

// For text-search fallbacks (no taxon resolved): drop occurrences whose name
// only matches through the author abbreviation ("Cat." of Knautia
// subcanescens Cat.) by requiring a query token to word-hit the taxon's
// names — including higher ranks, since family-level scientific queries
// ("Gonyleptidae") match the classification, not the genus or epithet.
const _nameRelevant = (query, item) => {
  const tokens = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return true;
  const words = `${item?.genericName ?? item?.genus ?? ""} ${item?.specificEpithet ?? ""} ${item?.family ?? ""} ${item?.order ?? ""} ${item?.class ?? ""} ${item?.kingdom ?? ""} ${item?.vernacularName ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((t) =>
    words.some((w) => w.startsWith(t) || (t.length >= 3 && t.startsWith(w))),
  );
};
