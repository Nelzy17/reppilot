// The four coaching dimensions, in fixed display order.
//
// This lives outside the chart component on purpose: trend-charts.tsx is a
// client module, and a plain value exported from one reaches a Server Component
// as a client reference, not as the array itself.
//
// The colours are roles, not raw hex — globals.css swaps them per theme. The
// order is the categorical assignment order and must not be shuffled without
// re-running the palette validator.

export const DIMENSIONS = [
  {
    key: "product_knowledge",
    label: "Product knowledge",
    color: "var(--rp-series-1)",
  },
  { key: "communication", label: "Communication", color: "var(--rp-series-2)" },
  {
    key: "objection_handling",
    label: "Objection handling",
    color: "var(--rp-series-3)",
  },
  {
    key: "clinical_accuracy",
    label: "Clinical accuracy",
    color: "var(--rp-series-4)",
  },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];
