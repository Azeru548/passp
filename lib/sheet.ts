import { A4, EXPORT_DPI, MAX_PER_SHEET, MAX_SPREAD_GAP_MM, mmToPx } from "./constants";

export { mmToPx };

export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInput {
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  /** Gap between neighbouring photos, in mm. */
  gapMm: number;
  photoWidthMm: number;
  photoHeightMm: number;
  photosPerRow: number;
  rows: number;
}

export interface Layout {
  cells: Cell[];
  width: number;
  height: number;
  gapH: number;
  gapV: number;
}

/** Largest number of fixed-width photos that fit across the page with the given gap. */
export function maxPhotosPerRow(
  pageWidthMm: number,
  marginMm: number,
  photoWidthMm: number,
  gapMm = 2
): number {
  const usable = pageWidthMm - 2 * marginMm;
  if (usable < photoWidthMm) return 1;
  return Math.max(1, Math.floor((usable + gapMm) / (photoWidthMm + gapMm)));
}

/** How many rows of fixed-height photos fit down the page with the given gap. */
export function resolveRows(
  pageHeightMm: number,
  marginMm: number,
  photoHeightMm: number,
  gapMm = 2
): number {
  const usable = pageHeightMm - 2 * marginMm;
  if (usable < photoHeightMm) return 1;
  return Math.max(1, Math.floor((usable + gapMm) / (photoHeightMm + gapMm)));
}

/**
 * Lay the photos out at their fixed size with a fixed gap between them. The
 * block is centred horizontally and anchored to the top of the page, so a short
 * sheet reads from the top edge instead of floating in the middle.
 */
export function computeLayout(input: LayoutInput): Layout {
  const width = Math.round(mmToPx(input.pageWidthMm, EXPORT_DPI));
  const height = Math.round(mmToPx(input.pageHeightMm, EXPORT_DPI));
  const m = mmToPx(input.marginMm, EXPORT_DPI);
  const g = mmToPx(input.gapMm, EXPORT_DPI);
  const aspect = input.photoWidthMm / input.photoHeightMm;

  const usableW = width - 2 * m;
  const usableH = height - 2 * m;
  const requestedW = mmToPx(input.photoWidthMm, EXPORT_DPI);

  const n = clamp(Math.floor(input.photosPerRow), 1, fitCount(usableW, requestedW, g));
  let r = clamp(
    Math.floor(input.rows),
    1,
    fitCount(usableH, mmToPx(input.photoHeightMm, EXPORT_DPI), g)
  );
  // Never exceed the per-sheet ceiling, whatever the controls ask for.
  if (n * r > MAX_PER_SHEET) r = Math.max(1, Math.floor(MAX_PER_SHEET / n));

  // The photo is the requested size, shrunk only if that cannot fit the grid.
  const fitW = n > 1 ? (usableW - (n - 1) * g) / n : usableW;
  const fitH = (r > 1 ? (usableH - (r - 1) * g) / r : usableH) * aspect;
  const pw = Math.max(1, Math.min(requestedW, fitW, fitH));
  const ph = pw / aspect;

  // Spread the columns across the usable width so the row reaches both margins
  // (no wide side bands). With only a few photos that would need an absurd gap,
  // so in that case keep the requested gap and centre the block instead.
  const filledGapH = n > 1 ? (usableW - n * pw) / (n - 1) : 0;
  const spread = n > 1 && filledGapH <= mmToPx(MAX_SPREAD_GAP_MM, EXPORT_DPI);
  const gapH = spread ? filledGapH : g;
  const blockW = n * pw + (n - 1) * gapH;

  const startX = spread ? m : Math.max(m, (width - blockW) / 2);
  // Rows are anchored to the top; the block is never floated to the middle.
  const startY = m;

  const cells: Cell[] = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < n; col++) {
      cells.push({
        x: startX + col * (pw + gapH),
        y: startY + row * (ph + g),
        w: pw,
        h: ph
      });
    }
  }

  return { cells, width, height, gapH, gapV: g };
}

/**
 * Source rectangle (in the original image) that crops to the target aspect
 * ratio, honouring a zoom factor and a normalised pan offset (-1..1).
 */
export function computeSourceRect(
  imgW: number,
  imgH: number,
  targetAspect: number,
  zoom: number,
  offsetX: number,
  offsetY: number
) {
  let baseW: number;
  let baseH: number;
  if (imgW / imgH > targetAspect) {
    baseH = imgH;
    baseW = imgH * targetAspect;
  } else {
    baseW = imgW;
    baseH = imgW / targetAspect;
  }

  const z = Math.max(1, zoom);
  const sw = baseW / z;
  const sh = baseH / z;

  const maxX = imgW - sw;
  const maxY = imgH - sh;

  const cx = (imgW - sw) / 2 + (clamp(offsetX, -1, 1) * maxX) / 2;
  const cy = (imgH - sh) / 2 + (clamp(offsetY, -1, 1) * maxY) / 2;

  return {
    x: clamp(cx, 0, maxX),
    y: clamp(cy, 0, maxY),
    w: sw,
    h: sh
  };
}

export interface DrawOptions {
  marginMm: number;
  gapMm: number;
  photoWidthMm: number;
  photoHeightMm: number;
  photosPerRow: number;
  rows: number;
  bgColor: string; // hex or "transparent"
  cutMarks: boolean;
  zoom: number;
  offsetX: number;
  offsetY: number;
  pageWidthMm?: number;
  pageHeightMm?: number;
}

/** Render the full A4 sheet onto a canvas at print resolution. */
export function drawSheet(
  canvas: HTMLCanvasElement,
  opts: DrawOptions,
  img: HTMLImageElement
): Layout {
  const layout = computeLayout({
    pageWidthMm: opts.pageWidthMm ?? A4.widthMm,
    pageHeightMm: opts.pageHeightMm ?? A4.heightMm,
    marginMm: opts.marginMm,
    gapMm: opts.gapMm,
    photoWidthMm: opts.photoWidthMm,
    photoHeightMm: opts.photoHeightMm,
    photosPerRow: opts.photosPerRow,
    rows: opts.rows
  });

  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return layout;

  // Paper
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layout.width, layout.height);

  const aspect = opts.photoWidthMm / opts.photoHeightMm;
  const src = computeSourceRect(
    img.naturalWidth,
    img.naturalHeight,
    aspect,
    opts.zoom,
    opts.offsetX,
    opts.offsetY
  );

  const hairline = Math.max(1, Math.round(mmToPx(0.2, EXPORT_DPI)));

  for (const c of layout.cells) {
    if (opts.bgColor && opts.bgColor !== "transparent") {
      ctx.fillStyle = opts.bgColor;
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }

    ctx.drawImage(img, src.x, src.y, src.w, src.h, c.x, c.y, c.w, c.h);

    if (opts.cutMarks) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = hairline;
      ctx.strokeRect(c.x + hairline / 2, c.y + hairline / 2, c.w - hairline, c.h - hairline);
    }
  }

  return layout;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/** How many items of size `size` fit in `span` with `gap` between them. */
function fitCount(span: number, size: number, gap: number) {
  if (size <= 0) return 1;
  return Math.max(1, Math.floor((span + gap) / (size + gap)));
}
