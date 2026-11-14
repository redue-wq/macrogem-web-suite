export const parseResults = (data, source) =>
  (data?.results ?? []).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    snippet: item.description ?? "",
    source,
  }));
