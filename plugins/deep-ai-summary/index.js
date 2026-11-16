import {
  adapterRequirements,
  ChatRole,
  DetectSource,
  effectiveProviderId,
  forgetDetection,
  listModels,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  sniffProvider,
} from "./providers/index.js";
import { DEFAULT_SYSTEM_PROMPT } from "./src/prompt.js";
import { parseSettings, settingsSchema, FOLLOWUP_MIN_TOKENS } from "./src/settings.js";
import { buildSources, buildUserPrompt, buildPanelHtml, buildFetchedUserPrompt, summaryCacheKey } from "./src/panel.js";
import { extractSources } from "./src/extract.js";
import { runStream } from "./src/pipeline.js";
import { cleanChatMessages } from "./src/messages.js";

const DEEP_AI_SUMMARY_ID = "deep-ai-summary-slot";
const MODEL_FIELD_KEY = "model";
const PROVIDER_FIELD_KEY = "provider";
const SUMMARY_NAMESPACE = "ext:deep-ai-summary:summary";
const TEXTS_NAMESPACE = "ext:deep-ai-summary:pagetexts";
const SHORT_TTL_MS = 2 * 60 * 1000;
// Follow-up chats should see the same page texts the summary saw; keep them
// longer than the summary itself since users read before asking.
const TEXTS_TTL_MS = 30 * 60 * 1000;
const ROUTE_STREAM = "/stream";
const ROUTE_CHAT = "/chat";
const ROUTE_ANIMATIONS = "/animations.js";

let _settings = parseSettings({});
let _summaryCache = null;
let _textsCache = null;
let _animationsSource = "";

const resolveCache = (ctx, namespace, ttl) => {
  if (typeof ctx?.useCache === "function") {
    return ctx.useCache(namespace, ttl);
  }
  if (typeof ctx?.createCache === "function") {
    const sync = ctx.createCache(SHORT_TTL_MS);
    return {
      get: async (k) => sync.get(k),
      set: async (k, v) => sync.set(k, v),
      delete: async (k) => { if (typeof sync.delete === "function") sync.delete(k); },
      clear: async () => sync.clear(),
    };
  }
  return null;
};

const fetchSourceTexts = async (results) => {
  const sources = buildSources(results, undefined, _settings.maxSources);
  const fetchN = Math.min(sources.length, _settings.fetchPages);
  if (fetchN === 0) return sources.map(() => null);
  return extractSources(_settings, sources.slice(0, fetchN).map((s) => s.url));
};

const buildSummaryMsgs = async (query, results) => {
  const sources = buildSources(results, undefined, _settings.maxSources);
  const texts = await fetchSourceTexts(results);
  return {
    messages: [
      { role: "system", content: _settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
      { role: "user", content: buildFetchedUserPrompt(query, sources, texts) },
    ],
    texts,
  };
};

// Follow-up chats get the same material the summary saw. The texts fetched
// for the summary are cached under its cache key; on a miss (expired), they
// are re-extracted from the results the client echoes back.
const buildChatContext = async (query, results, key) => {
  if (!query) return [];
  let texts = null;
  if (key && _textsCache) {
    try {
      const raw = await _textsCache.get(`texts|${key}`);
      if (raw) texts = JSON.parse(raw);
    } catch {
      // fall through to re-extraction
    }
  }
  if (!texts && results.length > 0) texts = await fetchSourceTexts(results);
  const sources = buildSources(results, undefined, _settings.maxSources);
  return [
    { role: ChatRole.System, content: buildFetchedUserPrompt(query, sources, texts) },
  ];
};

// Changing these changes the prompt even when results stay the same,
// so they are part of the summary cache key.
const promptSalt = () =>
  `${_settings.maxSources}|${_settings.fetchPages}|${_settings.pageCaps}`;

const providerOptions = () =>
  PROVIDER_ORDER.map((id) => ({ value: id, label: PROVIDER_LABELS[id] ?? id }));

const detectProvider = async (settings) => {
  forgetDetection(settings.baseUrl);
  const found = await sniffProvider(settings.baseUrl, settings.apiKey);
  const options = providerOptions();
  if (found.source === DetectSource.Fallback) {
    return {
      options,
      notice: `Could not identify ${found.origin}. Pick a provider yourself; OpenAI compatible is the safe bet.`,
    };
  }
  const where = settings.baseUrl.trim()
    ? `at ${found.origin}`
    : `on the default ${found.origin}, since no base URL is set`;
  return {
    options,
    value: found.id,
    notice: `Detected ${PROVIDER_LABELS[found.id]} ${where}.`,
  };
};

const fetchModels = async (settings) => {
  const id = effectiveProviderId(settings.provider, settings.openAICompatProvider);
  const options = await listModels(id, settings);
  const label = PROVIDER_LABELS[id] ?? id;
  return {
    options,
    notice: options.length
      ? `${options.length} models served over the ${label} API.`
      : `No models came back from the ${label} API. Check the base URL and key, or type the model id yourself.`,
  };
};

const LANGUAGE_RE = /^[a-z]{2}$/;

const pickLanguage = (raw) => {
  const code = String(raw ?? "").trim().toLowerCase();
  return LANGUAGE_RE.test(code) ? code : "";
};

const jsonError = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const slot = {
  id: DEEP_AI_SUMMARY_ID,
  settingsId: DEEP_AI_SUMMARY_ID,
  name: "Deep AI Summary",
  waitForResults: true,
  get description() {
    return this.t?.("deep-ai-summary-slot.description") ?? "Deep AI Summary";
  },
  position: "at-a-glance",
  isClientExposed: false,

  async init(ctx) {
    _summaryCache = resolveCache(ctx, SUMMARY_NAMESPACE, SHORT_TTL_MS);
    _textsCache = resolveCache(ctx, TEXTS_NAMESPACE, TEXTS_TTL_MS);
    _animationsSource = (await ctx.readFile?.("animations.js")) ?? "";
  },

  configure(s) {
    _settings = parseSettings(s ?? {});
    forgetDetection(_settings.baseUrl);
  },

  async getFieldOptions(key, values) {
    const settings = parseSettings(values ?? {});
    if (key === PROVIDER_FIELD_KEY) return detectProvider(settings);
    if (key === MODEL_FIELD_KEY) return fetchModels(settings);
    return { options: [] };
  },

  async trigger(query) {
    if (!_settings.model) return false;
    const reqs = adapterRequirements(_settings.provider, _settings.openAICompatProvider);
    if (reqs.baseUrl && !_settings.baseUrl) return false;
    if (reqs.apiKey && !_settings.apiKey) return false;
    if (_settings.questionMarkOnly && !query.trim().endsWith("?")) return false;
    return true;
  },

  async execute(query, context) {
    const results = context?.results ?? [];
    if (results.length === 0) return { html: "" };
    if (!_settings.model) return { html: "" };
    if (_settings.questionMarkOnly && !query.trim().endsWith("?")) return { html: "" };
    const sources = buildSources(results, context?.signFaviconUrl, _settings.maxSources);
    return {
      html: buildPanelHtml(
        this.t,
        query.trim(),
        sources,
        _settings.hideOnError,
        _settings.enableInputStyling,
        _settings.openLinksInNewTab,
        _settings.panelTitle,
      ),
    };
  },

  settingsSchema,
};

export const routes = [
  {
    method: "get",
    path: ROUTE_ANIMATIONS,
    handler: () =>
      _animationsSource
        ? new Response(_animationsSource, {
            headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache" },
          })
        : jsonError("Not ready", 503),
  },
  {
    method: "post",
    path: ROUTE_STREAM,
    async handler(req) {
      let body;
      try {
        body = await req.json();
      } catch {
        return jsonError("Invalid JSON", 400);
      }
      const query = (body.query ?? "").trim();
      const results = Array.isArray(body.results) ? body.results : [];
      if (!query || results.length === 0) return jsonError("Missing query or results", 400);
      if (!_settings.model) return jsonError("AI summary not configured", 400);
      if (_settings.questionMarkOnly && !query.endsWith("?")) return jsonError("Question-only mode", 403);
      const language = pickLanguage(body.language);
      const { messages, texts } = await buildSummaryMsgs(query, results);
      const cacheKey = `${summaryCacheKey(query, results, _settings.maxSources, promptSalt())}${language ? `|${language}` : ""}`;
      if (_textsCache) {
        try {
          await _textsCache.set(`texts|${cacheKey}`, JSON.stringify(texts));
        } catch {
          // chat follow-ups will re-extract instead
        }
      }
      return runStream(
        messages,
        _settings.maxTokens,
        cacheKey,
        _settings,
        _summaryCache,
        query,
        language,
        { key: cacheKey },
      );
    },
  },
  {
    method: "post",
    path: ROUTE_CHAT,
    async handler(req) {
      let body;
      try {
        body = await req.json();
      } catch {
        return jsonError("Invalid JSON", 400);
      }
      const messages = Array.isArray(body.messages) ? cleanChatMessages(body.messages) : [];
      if (!messages.some((m) => m.role === ChatRole.User)) {
        return jsonError("Missing messages", 400);
      }
      if (!_settings.model) return jsonError("AI summary not configured", 400);
      const query = (body.query ?? "").trim();
      const results = Array.isArray(body.results) ? body.results : [];
      const key = typeof body.key === "string" ? body.key : "";
      const context = await buildChatContext(query, results, key);
      return runStream(
        [...context, ...messages],
        Math.max(_settings.maxTokens, FOLLOWUP_MIN_TOKENS),
        null,
        _settings,
        _summaryCache,
        String(messages[0]?.content ?? ""),
        pickLanguage(body.language),
      );
    },
  },
];
