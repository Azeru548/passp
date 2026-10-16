// Shared constants for the passport sheet generator.

export const A4 = { widthMm: 210, heightMm: 297 };

export const MM_PER_INCH = 25.4;

/** Export resolution. 300 DPI is the print-shop standard. */
export const EXPORT_DPI = 300;

export const mmToPx = (mm: number, dpi = EXPORT_DPI) => (mm * dpi) / MM_PER_INCH;

/** Default sheet photo: 36 x 46 mm — a hair above 35 x 45 so the sheet fills A4. */
export const DEFAULT_PHOTO = { widthMm: 36, heightMm: 46 };

export const DEFAULT_MARGIN_MM = 4;
/** Row gap between photos on the sheet, in mm. Small so the sheet stays tight. */
export const DEFAULT_GAP_MM = 2;
/** Columns spread across the page up to this gap; beyond it they stay centred. */
export const MAX_SPREAD_GAP_MM = 22;
export const DEFAULT_PHOTOS_PER_ROW = 5;
/** Hard ceiling on photos per A4 sheet (a 5 × 6 grid). */
export const MAX_PER_SHEET = 30;

/** Background colour presets typical for passport photos. */
export const BG_PRESETS: { name: string; value: string }[] = [
  { name: "White", value: "#ffffff" },
  { name: "Off-white", value: "#f3f1ec" },
  { name: "Light grey", value: "#e2e4e8" },
  { name: "Sky blue", value: "#cfe2f3" },
  { name: "Light blue", value: "#b3d4ef" },
  { name: "Deep blue", value: "#1c5fa8" },
  { name: "Red", value: "#c62828" },
  { name: "Cream", value: "#f6efdd" },
  { name: "Transparent", value: "transparent" }
];

/** Quick photo-size presets (mm). */
export const PHOTO_PRESETS: { name: string; widthMm: number; heightMm: number }[] = [
  { name: "36 × 46 (default)", widthMm: 36, heightMm: 46 },
  { name: "35 × 45 (passport)", widthMm: 35, heightMm: 45 },
  { name: "33 × 48 (US passport)", widthMm: 33, heightMm: 48 },
  { name: "2 × 2 in (51×51)", widthMm: 51, heightMm: 51 },
  { name: "40 × 50", widthMm: 40, heightMm: 50 }
];
