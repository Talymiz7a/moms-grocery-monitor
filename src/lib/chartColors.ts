// Month colors for the grouped product × month chart.
// Months are ordered, so each quarter has its own hue stepped light → dark:
// Q1 blue, Q2 green, Q3 pink, Q4 violet. Validated with the data-viz palette
// validator: every adjacent pair clears the colorblind (CVD ΔE ≥ 14.6) and
// normal-vision (ΔE ≥ 15.6) floors, and each quarter passes as an ordinal ramp.
// Four light steps sit below 3:1 contrast, so the chart always ships with a
// legend, exact-value tooltips and a table view.
export const MONTH_COLORS = [
  "#6ab8ff", "#3280de", "#004ca6", // Jan–Mar
  "#61ca5b", "#299825", "#006500", // Apr–Jun
  "#fa8bb4", "#c05781", "#882351", // Jul–Sep
  "#a79fff", "#7466ed", "#4a30b5", // Oct–Dec
];

/** Single-series charts (one measure over time). */
export const SERIES_COLOR = "#2a78d6";
export const SERIES_COLOR_2 = "#eb6834";

export const CHART_INK = { primary: "#1d2430", secondary: "#4a5565", grid: "#e6e9ef", axis: "#c9ced8" };
