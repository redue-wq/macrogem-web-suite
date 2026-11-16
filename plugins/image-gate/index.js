// Image gate: hides AI-slop domains, and hides results from topic-specific engines
// (iNaturalist, NASA...) when the query is clearly about something else.
// Routing runs in the browser with a small ONNX embedding model (served from ./vendor).
// This file serves config, the vendored runtime/model files, and the blocklist.

import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const VENDOR = join(HERE, "vendor");

// Built-in phrase templates per engine. A topic row that lists engines but
// leaves its examples empty gets the union of its engines' templates, so a
// fresh setup needs no phrase writing at all. Explicit examples always win.
const NATURE_PHRASES =
  "a wild animal; an insect or spider; a bird; a plant or tree or flower; a mushroom or fungus; a butterfly or moth; a fish, reptile or amphibian; a species of living organism";
const SPACE_PHRASES =
  "a planet or moon; a galaxy or nebula; a spacecraft or space mission; a telescope or astronomy; an astronaut or space station";
const ENGINE_TEMPLATES = {
  "inaturalist": NATURE_PHRASES,
  "gbif": NATURE_PHRASES,
  "nasa images": SPACE_PHRASES,
};

const DEFAULT_TOPICS = [
  { engines: "iNaturalist, GBIF", phrases: "" },
  { engines: "NASA Images", phrases: "" },
];
const DEFAULT_OTHER =
  "a city or country or landmark; a food or dish; a product or vehicle; a painting or artwork or drawing; a video game or fictional character; a person or clothing; a room, building or interior design; a landscape or beach or weather";
const DEFAULT_MARGIN = 0.05;

let groups = [];
let engineGroup = {};
let margin = DEFAULT_MARGIN;
let extraBlocked = new Set();
let blocked = new Set();
let blockLoaded = false;

const _parseList = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

async function loadBlocklist() {
  if (blockLoaded) return;
  try {
    const txt = await readFile(join(HERE, "blocklist.txt"), "utf8");
    blocked = new Set(txt.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean));
    blockLoaded = true;
  } catch (e) {
    console.error("[image-gate] could not read blocklist.txt:", e && e.message);
  }
}

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".onnx": "application/octet-stream",
};
const extOf = (p) => p.slice(p.lastIndexOf(".")).toLowerCase();

function walk(dir) {
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
  } catch {}
  return out;
}

const vendorRoutes = walk(VENDOR).map((full) => {
  const rel = relative(VENDOR, full).split(sep).join("/");
  return {
    method: "get",
    path: `/v/${rel}`,
    handler: async () => {
      const body = await readFile(full);
      return new Response(body, {
        headers: {
          "Content-Type": MIME[extOf(full)] || "application/octet-stream",
          "Cache-Control": "public, max-age=604800",
        },
      });
    },
  };
});

const json = (obj) =>
  new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default {
  name: "Image gate",
  description:
    "Hides AI-slop domains from image results, and hides topic-specific engines (iNaturalist, NASA...) when the query is clearly about something else.",

  // degoog only loads a plugin's script.js and settings once it registers as a command,
  // so this is a no-op bang. The real work is in script.js and the routes below.
  trigger: "imagegate",
  async execute() {
    return {
      title: "Image gate",
      html: "<p>Image gate is active on the Images tab. Configure it in Settings &gt; Plugins.</p>",
    };
  },

  settingsSchema: [
    {
      key: "topics",
      label: "Topic engines",
      type: "list",
      addLabel: "+ Add topic",
      description:
        "Each row is a topic. Engines: comma-separated engine names, exactly as in the results sidebar (iNaturalist, GBIF). Examples: a few short phrases separated by ; describing what searches fit this topic. Leave the examples empty to use the built-in template for those engines (iNaturalist/GBIF -> wildlife, NASA Images -> space); written examples always override the template. Engines not listed are never filtered.",
      itemSchema: [
        { key: "engines", label: "Engines (comma-separated)", type: "text" },
        { key: "phrases", label: "Examples (separate with ;)", type: "text" },
      ],
    },
    {
      key: "otherPhrases",
      label: "Everything else",
      type: "textarea",
      description:
        "Examples of searches that belong to none of the topics above (places, food, products, art...), separated by ; . This is what a topic competes against.",
    },
    {
      key: "margin",
      label: "Confidence margin",
      type: "number",
      description:
        "How much closer the best group must be than the runner-up before anything is hidden. Ambiguous words (python, apple, java) fall under this and show everything. Default 0.05.",
    },
    {
      key: "extraBlocked",
      label: "Extra blocked domains",
      type: "textarea",
      description: "One domain per line, added to the bundled AI blocklist. Subdomains are included.",
    },
  ],

  configure(settings) {
    const split = (str, sep) =>
      String(str || "")
        .split(sep)
        .map((p) => p.trim())
        .filter(Boolean);
    // phrases: use ";" if present, otherwise commas, so "dog, fox, wheat" works too
    const phraseSplit = (str) => split(str, String(str || "").includes(";") ? ";" : ",");

    const t = _parseList(settings?.topics);
    const topics = (t ?? DEFAULT_TOPICS)
      .map((x) => {
        let phrases = phraseSplit(x.phrases);
        if (!phrases.length) {
          // No examples written: fall back to the built-in templates of this
          // row's engines (union, order-preserving).
          phrases = [];
          for (const e of split(x.engines, ",")) {
            for (const p of split(ENGINE_TEMPLATES[e.toLowerCase()], ";")) {
              if (!phrases.includes(p)) phrases.push(p);
            }
          }
        }
        return { engines: split(x.engines, ","), phrases };
      })
      .filter((x) => x.engines.length && x.phrases.length);

    const otherRaw = settings?.otherPhrases || DEFAULT_OTHER;
    const other = String(otherRaw).includes(";") ? split(otherRaw, /[;\n]/) : split(otherRaw, /[,\n]/);
    groups = topics.map((x, i) => ({ name: `topic${i}`, phrases: x.phrases }));
    if (other.length) groups.push({ name: "other", phrases: other });

    engineGroup = {};
    topics.forEach((x, i) => {
      for (const e of x.engines) engineGroup[e.toLowerCase()] = `topic${i}`;
    });

    const m = parseFloat(settings?.margin);
    margin = Number.isFinite(m) && m >= 0 ? m : DEFAULT_MARGIN;

    extraBlocked = new Set(
      String(settings?.extraBlocked || "")
        .split(/[\n,]/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    );
  },

  routes: [
    {
      method: "get",
      path: "/config",
      handler: async () => {
        await loadBlocklist();
        return json({
          groups,
          engines: engineGroup,
          margin,
          blocked: [...blocked, ...extraBlocked],
        });
      },
    },
    ...vendorRoutes,
  ],
};
