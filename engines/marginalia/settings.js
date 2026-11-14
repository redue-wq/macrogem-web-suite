export const SETTINGS_SCHEMA = [
  {
    key: "apiKey",
    label: "API Key",
    type: "password",
    secret: true,
    default: "public",
    placeholder: "public",
    description:
      'The shared "public" key works but hits a shared rate limit (HTTP 503). Email contact@marginalia-search.com for your own free non-commercial key.',
  },
  {
    key: "nsfw",
    label: "NSFW filter",
    type: "select",
    options: ["off", "reduce"],
    default: "off",
    description: "Experimental reduction of extreme results.",
  },
];
