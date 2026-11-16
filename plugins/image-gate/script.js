// Image gate (browser side).
// 1) hides results from blocklisted domains
// 2) hides topic-specific engine results when a small embedding model (served from this
//    instance, runs as WebAssembly in your browser) says the query is about another topic.
(() => {
  const ID = __PLUGIN_ID__;
  const BASE = `/api/plugin/${ID}`;
  const LOG = (...a) => console.debug("[image-gate]", ...a);

  let cfg = null;
  let cfgPromise = null;
  let modelPromise = null;
  let protos = null; // [{ name, vecs: Float32Array[] }]
  const verdicts = new Map(); // query -> { group, margin } | "pending" | "failed"
  let ranked = null; // search number the ranking is set for

  const loadCfg = () =>
    (cfgPromise ||= fetch(`${BASE}/config`)
      .then((r) => r.json())
      .then((c) => {
        cfg = {
          groups: c.groups || [],
          engines: c.engines || {},
          margin: typeof c.margin === "number" ? c.margin : 0.05,
          blocked: new Set(c.blocked || []),
        };
        cfg.groupNames = new Set(cfg.groups.map((g) => g.name));
        return cfg;
      })
      .catch(() => {
        cfgPromise = null;
        return null;
      }));

  // --- model --------------------------------------------------------------
  const loadModel = () =>
    (modelPromise ||= (async () => {
      const t0 = performance.now();
      const { pipeline, env } = await import(`${BASE}/v/transformers.min.js`);
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = `${BASE}/v/models/`;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.wasmPaths = {
        mjs: `${BASE}/v/ort-wasm-simd-threaded.mjs`,
        wasm: `${BASE}/v/ort-wasm-simd-threaded.wasm`,
      };
      const extractor = await pipeline("feature-extraction", "bge-small", {
        dtype: "q8",
        device: "wasm",
      });
      LOG(`model ready in ${Math.round(performance.now() - t0)}ms`);
      return extractor;
    })().catch((e) => {
      console.warn("[image-gate] model failed to load; showing everything", e);
      modelPromise = null;
      return null;
    }));

  const embed = async (extractor, texts) => {
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    const [n, d] = out.dims;
    const data = out.data;
    return Array.from({ length: n }, (_, i) => data.slice(i * d, (i + 1) * d));
  };
  const dot = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  };

  async function classify(query) {
    const extractor = await loadModel();
    if (!extractor || !cfg || cfg.groups.length < 2) return null; // can't compare: fail open
    if (!protos) {
      // Embedding all example phrases takes ~2s, so cache the result per config in localStorage.
      const sig = JSON.stringify(cfg.groups) + "|bge-small-q8";
      let h = 0;
      for (let i = 0; i < sig.length; i++) h = (Math.imul(31, h) + sig.charCodeAt(i)) | 0;
      const KEY = "image-gate:protos";
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || "null");
        if (saved && saved.h === h) protos = saved.p.map((g) => ({ name: g.name, vecs: g.vecs.map((v) => Float32Array.from(v)) }));
      } catch {}
      if (!protos) {
        protos = [];
        for (const g of cfg.groups) protos.push({ name: g.name, vecs: await embed(extractor, g.phrases) });
        try {
          localStorage.setItem(
            KEY,
            JSON.stringify({
              h,
              p: protos.map((g) => ({ name: g.name, vecs: g.vecs.map((v) => Array.from(v, (x) => +x.toFixed(5))) })),
            }),
          );
        } catch {}
      }
    }
    const [q] = await embed(extractor, [query]);
    const scores = protos
      .map((p) => ({ name: p.name, s: Math.max(...p.vecs.map((v) => dot(q, v))) }))
      .sort((a, b) => b.s - a.s);
    if (scores.length < 2) return { group: scores[0]?.name ?? null, margin: 1 };
    return { group: scores[0].name, margin: scores[0].s - scores[1].s, scores };
  }

  // --- filtering ----------------------------------------------------------
  const isBlocked = (url) => {
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    const parts = host.split(".");
    for (let i = 0; i < parts.length - 1; i++) if (cfg.blocked.has(parts.slice(i).join("."))) return true;
    return false;
  };

  const keep = (r, q) => {
    if (!cfg) return true;
    if (r.url && isBlocked(r.url)) return false;
    const group = cfg.engines[String(r.source || "").toLowerCase()];
    if (!group || !cfg.groupNames.has(group)) return true; // engine isn't gated
    const v = verdicts.get(q);
    if (v === "failed") return true; // model unavailable: fail open
    if (!v || v === "pending") return false; // wait for the verdict
    if (v.margin < cfg.margin) return true; // ambiguous query: show everything
    return v.group === group;
  };

  async function ensure() {
    const api = window.degoog && window.degoog.results;
    if (!api) return;
    const cur = api.current();
    if (!cur || cur.type !== "images") return;
    const q = cur.query || "";
    await loadCfg();
    if (!cfg) return;
    if (ranked !== cur.search) {
      ranked = cur.search;
      api.setRanking(ID, { hidden: (r) => !keep(r, (api.current() || {}).query || q) });
    }
    const gated = Object.keys(cfg.engines).length > 0;
    if (gated && !verdicts.has(q)) {
      verdicts.set(q, "pending");
      try {
        const v = await classify(q);
        verdicts.set(q, v || "failed");
        if (v) LOG(q, "->", v.group, "margin", v.margin.toFixed(3));
      } catch (e) {
        console.warn("[image-gate] classify failed", e);
        verdicts.set(q, "failed");
      }
    }
    api.refresh();
  }

  const start = () => {
    window.addEventListener("degoog-results-ready", ensure);
    window.addEventListener("degoog-results-settled", ensure);
    ensure();
  };
  if (window.degoog && window.degoog.results) start();
  else window.addEventListener("degoog-results-api-ready", start, { once: true });
})();
