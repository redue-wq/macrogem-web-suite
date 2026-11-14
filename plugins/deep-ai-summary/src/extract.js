// Fetches the full text of top result pages to give the model real context
// instead of just snippets. Default mode is fully in-process: fetch with a
// rotating UA and per-page timeout, strip chrome with cheerio, and keep
// prose-looking paragraphs up to the page's char cap. If an external
// extractor URL is configured (trafilatura-style helper), it is tried first
// and the in-process path is the fallback.
//
// Failure of any single page is non-fatal: the model gets the other full
// texts plus every result's snippet as usual.

const FALLBACK_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const UAS = [
  FALLBACK_UA,
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

// `import("cheerio")` resolves against the app's own node_modules.
let _cheerio = null;
const cheerio = async () => (_cheerio ??= await import("cheerio"));

export const parseCaps = (raw) => {
  const caps = String(raw ?? "")
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return caps.length ? caps : [6000, 1500, 1500];
};

const capFor = (caps, i) => caps[Math.min(i, caps.length - 1)];

const pickUa = (seed) => UAS[(seed >>> 0) % UAS.length];

// --- in-process extraction -------------------------------------------------

const looksLikeProse = (text) =>
  /[.!?,:;'"()\u2019\u201d]/.test(text) || text.split(" ").length >= 12;

const stripNoise = ($root) => {
  $root.find("script, style, noscript, svg, nav, header, footer, aside, form, button, iframe").remove();
  return $root;
};

const extractInProcess = async (url, maxChars, timeoutS, seed) => {
  const { load } = await cheerio();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutS * 1000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": pickUa(seed), Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    const html = (await res.text()).slice(0, 3_000_000);
    const $ = load(html);
    stripNoise($("body"));
    const article = $("article, main, [role='main']").first();
    const scope = article.length ? article : $("body");

    // Whole-text mode first: one big text if it fits the cap, else paragraphs.
    const paras = [];
    scope.find("p, li, pre, blockquote, td").each((_i, el) => {
      if (paras.length >= 400) return false;
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text.length < 60 || !looksLikeProse(text)) return;
      if (paras.length && paras[paras.length - 1] === text) return;
      paras.push(text);
    });
    if (!paras.length) return null;

    let out = "";
    for (const p of paras) {
      if (out.length + p.length + 1 > maxChars) {
        const room = maxChars - out.length - 1;
        if (room > 200) out += (out ? " " : "") + p.slice(0, room);
        break;
      }
      out += (out ? " " : "") + p;
    }
    return out || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// --- optional external helper ----------------------------------------------

const extractHelper = async (settings, url, maxChars) => {
  const base = settings.extractorUrl.trim().replace(/\/+$/, "");
  const endpoint = base.includes("{url}")
    ? base.replace("{url}", encodeURIComponent(url)).replace("{max_chars}", String(maxChars))
    : `${base}/extract?url=${encodeURIComponent(url)}&max_chars=${maxChars}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), settings.pageTimeoutS * 1000);
  try {
    const res = await fetch(endpoint, {
      headers: settings.extractorToken
        ? { Authorization: `Bearer ${settings.extractorToken}` }
        : {},
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "ok" || data.status === "fallback") return data.text || null;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// --- dispatch ---------------------------------------------------------------

const extractOne = async (settings, url, maxChars, seed) => {
  if (settings.extractorUrl.trim()) {
    const viaHelper = await extractHelper(settings, url, maxChars);
    if (viaHelper) return viaHelper;
  }
  return extractInProcess(url, maxChars, settings.pageTimeoutS, seed);
};

// Returns texts aligned with the input urls (null where a page gave nothing).
export const extractSources = async (settings, urls) => {
  const caps = parseCaps(settings.pageCaps);
  return Promise.all(
    urls.map((url, i) => extractOne(settings, url, capFor(caps, i), i + 1)),
  );
};
