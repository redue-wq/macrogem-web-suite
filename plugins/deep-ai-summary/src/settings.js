import {
  ADAPTERS,
  EFFORT_ORDER,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  ProviderId,
  ReasoningEffort,
  ThinkingMode,
  TOKEN_PARAM_ORDER,
  TokenParam,
} from "../providers/index.js";
import { DEFAULT_SYSTEM_PROMPT } from "./prompt.js";

export const DEFAULT_TIMEOUT_S = 180;
export const DEFAULT_MAX_TOKENS = 2048;
export const FOLLOWUP_MIN_TOKENS = 512;

const asStr = (v) => (typeof v === "string" ? v : String(v ?? ""));
const asBool = (v) => v === "true" || v === true;
const asBoolOr = (v, fallback) =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : fallback;

const normaliseProvider = (raw) => {
  const all = Object.values(ProviderId);
  return all.includes(raw) ? raw : ProviderId.OpenAICompat;
};

const normaliseTokenParam = (raw) => (
  TOKEN_PARAM_ORDER.includes(raw) ? raw : TokenParam.MaxTokens
);

const normaliseEffort = (raw) => (
  EFFORT_ORDER.includes(raw) ? raw : ReasoningEffort.Medium
);

const normaliseCompatProvider = (raw) => {
  const compat = [
    "",
    ProviderId.OpenAI,
    ProviderId.OpenRouter,
    ProviderId.Ollama,
    ProviderId.LlamaCpp,
    ProviderId.Vllm,
    ProviderId.LmStudio,
  ];
  return compat.includes(raw) ? raw : "";
};

export const parseSettings = (raw) => {
  const timeoutSeconds = parseFloat(asStr(raw["timeoutSeconds"]) || "") || DEFAULT_TIMEOUT_S;
  const maxTokens = parseInt(asStr(raw["maxTokens"]) || "", 10) || DEFAULT_MAX_TOKENS;
  const thinking = asStr(raw["enableThinking"]);
  const maxSourcesRaw = parseInt(asStr(raw["maxSources"]) || "6", 10);
  const fetchPagesRaw = parseInt(asStr(raw["fetchPages"]) || "3", 10);
  const pageTimeoutRaw = parseInt(asStr(raw["pageTimeoutSeconds"]) || "30", 10);
  return {
    provider: normaliseProvider(asStr(raw["provider"])),
    openAICompatProvider: normaliseCompatProvider(asStr(raw["openAICompatProvider"])),
    baseUrl: asStr(raw["baseUrl"]),
    model: asStr(raw["model"]),
    apiKey: asStr(raw["apiKey"]),
    extraHeaders: asStr(raw["extraHeaders"]),
    tokenParam: normaliseTokenParam(asStr(raw["tokenLimitParam"])),
    timeoutMs: Math.max(5, timeoutSeconds) * 1000,
    systemPrompt: asStr(raw["systemPrompt"]),
    maxTokens: Math.max(16, maxTokens),
    questionMarkOnly: asBool(raw["questionMarkOnly"]),
    enableThinking: thinking === ThinkingMode.On,
    disableThinking: thinking === ThinkingMode.Off,
    maxSources: Math.min(20, Math.max(1, Number.isFinite(maxSourcesRaw) ? maxSourcesRaw : 6)),
    extractorUrl: asStr(raw["extractorUrl"] ?? raw["helperUrl"]),
    extractorToken: asStr(raw["extractorToken"] ?? raw["helperToken"]),
    fetchPages: Math.min(6, Math.max(0, Number.isFinite(fetchPagesRaw) ? fetchPagesRaw : 3)),
    pageCaps: asStr(raw["pageCaps"]),
    pageTimeoutS: Math.min(90, Math.max(5, Number.isFinite(pageTimeoutRaw) ? pageTimeoutRaw : 30)),
    panelTitle: asStr(raw["panelTitle"]).slice(0, 48),
    reasoningEffort: normaliseEffort(asStr(raw["reasoningEffort"])),
    hideOnError: asBool(raw["hideOnError"]),
    enableInputStyling: asBool(raw["enableInputStyling"]),
    openLinksInNewTab: asBool(raw["openLinksInNewTab"]),
    sendBrowserLanguage: asBoolOr(raw["sendBrowserLanguage"], true),
  };
};

const PROVIDER_KEY = "provider";

const asRules = (visibleWhen) => {
  if (!visibleWhen) return [];
  return Array.isArray(visibleWhen) ? visibleWhen : [visibleWhen];
};

const providerNotes = PROVIDER_ORDER.map((id) => ({
  key: `providerNotes-${id}`,
  label: `About ${PROVIDER_LABELS[id]}`,
  type: "info",
  description: ADAPTERS[id].settings.notes,
  visibleWhen: { key: PROVIDER_KEY, equals: id },
}));

const providerFields = () => {
  const byKey = new Map();
  for (const id of PROVIDER_ORDER) {
    for (const field of ADAPTERS[id].settings.fields) {
      const entry = byKey.get(field.key) ?? { field, ids: [] };
      entry.ids.push(id);
      byKey.set(field.key, entry);
    }
  }
  return [...byKey.values()].map(({ field, ids }) => ({
    ...field,
    visibleWhen: [{ key: PROVIDER_KEY, equals: ids }, ...asRules(field.visibleWhen)],
  }));
};

export const settingsSchema = [
  {
    key: PROVIDER_KEY,
    label: "Provider",
    type: "select",
    options: [...PROVIDER_ORDER],
    optionLabels: PROVIDER_ORDER.map((id) => PROVIDER_LABELS[id]),
    default: ProviderId.OpenAICompat,
    optionsFrom: {
      dependsOn: ["baseUrl"],
      refreshLabel: "Detect",
      emptyHint: "Pick one, or fill in the base URL below and hit Detect.",
    },
    description:
      "Which API degoog talks. The fields below change to match it. **Detect** asks the base URL what it is and picks for you.",
  },
  ...providerNotes,
  {
    key: "baseUrl",
    label: "API base URL",
    type: "url",
    placeholder: "Blank uses the provider default",
    description:
      "Blank uses the default for the provider above. A bare origin gets the standard path added.",
  },
  {
    key: "apiKey",
    label: "API key",
    type: "password",
    secret: true,
    placeholder: "Leave blank for local servers",
    description: "Sent only from this server, never to the browser.",
  },
  {
    key: "model",
    label: "Model",
    type: "text",
    required: true,
    placeholder: "gpt-4o-mini / gemini-flash-latest / claude-haiku-4-5",
    optionsFrom: {
      dependsOn: ["provider"],
      refreshLabel: "Fetch models",
      emptyHint: "Fetch models to list what this endpoint serves, or type any model id.",
    },
    description:
      "Model id. Reasoning models work; their thoughts stream live and clear when the answer starts.",
  },
  {
    key: "enableThinking",
    label: "Thinking",
    type: "select",
    options: [ThinkingMode.Auto, ThinkingMode.On, ThinkingMode.Off],
    optionLabels: ["Auto (default)", "On", "Off"],
    default: ThinkingMode.Auto,
    description:
      "Auto lets the model decide. On or Off may error on models that don't support them.",
  },
  {
    key: "maxSources",
    label: "Results to include",
    type: "text",
    placeholder: "6",
    description: "How many search results the summary can cite at all. Results beyond **Pages to fetch** appear as snippet-only.",
  },
  {
    key: "fetchPages",
    label: "Pages to fetch",
    type: "text",
    placeholder: "3",
    description: "How many of the top results get their full page fetched. `0` disables fetching. First results get preferential char caps.",
  },
  {
    key: "pageCaps",
    label: "Page char caps",
    type: "textarea",
    advanced: true,
    placeholder: "6000,1500,1500",
    description: "Comma-separated, one cap per fetched page, last value repeated for any extra pages. Default `6000,1500,1500`.",
  },
  {
    key: "pageTimeoutSeconds",
    label: "Page fetch timeout (seconds)",
    type: "text",
    advanced: true,
    placeholder: "30",
    description: "Per-page wait before giving up on that page. Default `30`.",
  },
  {
    key: "extractorUrl",
    label: "External extractor URL (optional)",
    type: "text",
    placeholder: "",
    advanced: true,
    description:
      "Optional URL of a trafilatura-style extraction helper (`{url}` and `{max_chars}` placeholders). When blank, pages are fetched and extracted in-process. Failure of a page is non-fatal either way: it falls back to the snippet.",
  },
  {
    key: "extractorToken",
    label: "External extractor token",
    type: "password",
    secret: true,
    placeholder: "",
    advanced: true,
    description: "Bearer token for the optional external extractor, if it needs one.",
  },
  {
    key: "panelTitle",
    label: "Panel title",
    type: "text",
    placeholder: "Deep AI Summary",
    description:
      "Overrides the title shown at the top of the summary panel. Blank uses the built-in badge.",
  },
  ...providerFields(),
  {
    key: "maxTokens",
    label: "Max tokens",
    type: "text",
    placeholder: "2048",
    description:
      "Cap on the response length. Default `2048`. Reasoning models spend tokens on thinking too, so give them `4096` or more.",
  },
  {
    key: "questionMarkOnly",
    label: "Only trigger on questions (?)",
    type: "toggle",
    description: "Only summarize when the query ends with `?`.",
  },
  {
    key: "hideOnError",
    label: "Hide summary on error or timeout",
    type: "toggle",
    description: "Removes the summary box instead of showing an error when the provider fails or times out.",
  },
  {
    key: "openLinksInNewTab",
    label: "Open links in a new tab",
    type: "toggle",
    description: "Opens citations, sources and links in the answer in a new tab.",
  },
  {
    key: "enableInputStyling",
    label: "Enable input styling",
    type: "toggle",
    description: "Adds a rotating rainbow border to the follow-up input while it has focus. Purely for show.",
  },
  {
    key: "extraHeaders",
    label: "Extra request headers",
    type: "textarea",
    advanced: true,
    placeholder: "x-opencode-session: {{session}}",
    description:
      "One `Name: value` per line, sent with every request to your provider. `{{session}}` becomes a stable id for the conversation, which is what OpenCode Go wants in `x-opencode-session`. Lines starting with `#` are ignored, and `Content-Type` and `Accept` cannot be overridden.",
  },
  {
    key: "timeoutSeconds",
    label: "Timeout (seconds)",
    type: "text",
    advanced: true,
    placeholder: "180",
    description: "Seconds to wait before giving up. Default `180`.",
  },
  {
    key: "systemPrompt",
    label: "Custom system prompt",
    type: "textarea",
    advanced: true,
    placeholder: DEFAULT_SYSTEM_PROMPT,
    description: "Replaces the built-in system prompt. Leave blank to keep it.",
  },
];
