export const SETTINGS_SCHEMA = [
  {
    key: "recordType",
    label: "Record type",
    type: "select",
    options: ["any", "observations", "specimens", "fossils"],
    default: "any",
    description:
      "Observations are field and camera-trap photos; specimens are herbarium sheets, museum trays and pinned material; fossils are fossil photography.",
  },
];
