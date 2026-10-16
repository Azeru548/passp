"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import {
  A4,
  BG_PRESETS,
  DEFAULT_GAP_MM,
  DEFAULT_MARGIN_MM,
  DEFAULT_PHOTO,
  DEFAULT_PHOTOS_PER_ROW,
  MAX_PER_SHEET,
  PHOTO_PRESETS
} from "@/lib/constants";
import { drawSheet, maxPhotosPerRow, resolveRows } from "@/lib/sheet";

type RowsMode = "auto" | "manual";
type BgModel = "isnet" | "isnet_fp16" | "isnet_quint8";
type ItemStatus = "pending" | "working" | "done" | "error";

// Which model the browser downloads once (then caches):
//   isnet_quint8 -> smallest (~10 MB), lower quality
//   isnet_fp16   -> balanced (~44 MB)   <-- default
//   isnet        -> largest, best quality
const BG_MODEL = (process.env.NEXT_PUBLIC_BG_MODEL || "isnet_fp16") as BgModel;

interface SheetSettings {
  marginMm: number;
  gapMm: number;
  photoWidthMm: number;
  photoHeightMm: number;
  photosPerRow: number;
  rows: number;
  bgColor: string;
  cutMarks: boolean;
}

interface BatchItem {
  id: string;
  name: string;
  originalUrl: string;
  blob: Blob;
  imageEl: HTMLImageElement | null;
  status: ItemStatus;
  error?: string;
  usedFallback: boolean;
  /** Per-customer background override; null = use the batch colour. */
  bgColor: string | null;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = src;
  });
}

async function downscale(file: File, maxDim = 2000): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1 && file.size < 6 * 1024 * 1024) return file;

    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.95));
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rough stage the background remover is in. */
type RemovalPhase = "download" | "remove";

type RemovalProgress = {
  phase: RemovalPhase;
  /** 0–100 */
  percent: number;
};

/** What the loading overlay is currently showing. */
type LoaderState = {
  title: string;
  detail?: string;
  /** `null` renders an indeterminate bar. */
  percent: number | null;
};

/**
 * Removes the background entirely inside the browser. The first call downloads
 * the model (cached afterwards); no server, no upload, no per-image cost.
 */
async function removeBgOnDevice(
  blob: Blob,
  onProgress: (progress: RemovalProgress) => void
): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(blob, {
    model: BG_MODEL,
    output: { format: "image/png" },
    progress: (key: string, current: number, total: number) => {
      if (!total) return;
      onProgress({
        phase: key.startsWith("fetch") ? "download" : "remove",
        percent: Math.max(0, Math.min(100, Math.round((current / total) * 100)))
      });
    }
  });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

const today = () => new Date().toISOString().slice(0, 10);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const safeName = (name: string, index: number) =>
  (name || `customer-${index + 1}`).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || `customer-${index + 1}`;

const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: "queued",
  working: "removing…",
  done: "ready",
  error: "original (no removal)"
};

export default function PassportStudio() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [processing, setProcessing] = useState(false);
  const [loader, setLoader] = useState<LoaderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // background + layout (shared by every customer)
  const [bgColor, setBgColor] = useState("#ffffff");
  const [photosPerRow, setPhotosPerRow] = useState(DEFAULT_PHOTOS_PER_ROW);
  const [rowsMode, setRowsMode] = useState<RowsMode>("auto");
  const [manualRows, setManualRows] = useState(6);
  const [marginMm, setMarginMm] = useState(DEFAULT_MARGIN_MM);
  const [gapMm, setGapMm] = useState(DEFAULT_GAP_MM);
  /** Whether the colour controls edit every customer, or only the active one. */
  const [colorScope, setColorScope] = useState<"all" | "active">("all");
  const [preparing, setPreparing] = useState(false);
  const [photoW, setPhotoW] = useState(DEFAULT_PHOTO.widthMm);
  const [photoH, setPhotoH] = useState(DEFAULT_PHOTO.heightMm);
  const [cutMarks, setCutMarks] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const itemsRef = useRef<BatchItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const queueRef = useRef<BatchItem[]>([]);
  const runningRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<BatchItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const autoRows = useMemo(() => {
    const byHeight = resolveRows(A4.heightMm, marginMm, photoH, gapMm);
    const bySheetCap = Math.max(1, Math.floor(MAX_PER_SHEET / Math.max(1, photosPerRow)));
    return Math.min(byHeight, bySheetCap);
  }, [marginMm, photoH, gapMm, photosPerRow]);
  // Manual rows can only ever reduce the count — never overflow the page.
  const rows = rowsMode === "auto" ? autoRows : clamp(manualRows, 1, autoRows);
  const maxN = useMemo(
    () => Math.min(maxPhotosPerRow(A4.widthMm, marginMm, photoW, gapMm), MAX_PER_SHEET),
    [marginMm, photoW, gapMm]
  );

  useEffect(() => {
    setPhotosPerRow((n) => clamp(n, 1, maxN));
  }, [maxN]);

  useEffect(() => {
    setManualRows((r) => clamp(r, 1, autoRows));
  }, [autoRows]);

  const active = useMemo(
    () => items.find((i) => i.id === activeId) ?? items[0] ?? null,
    [items, activeId]
  );

  const settings: SheetSettings = useMemo(
    () => ({
      marginMm,
      gapMm,
      photoWidthMm: photoW,
      photoHeightMm: photoH,
      photosPerRow,
      rows,
      bgColor,
      cutMarks
    }),
    [marginMm, gapMm, photoW, photoH, photosPerRow, rows, bgColor, cutMarks]
  );

  const renderItem = useCallback(
    (item: BatchItem): HTMLCanvasElement | null => {
      if (!item.imageEl) return null;
      const canvas = document.createElement("canvas");
      drawSheet(
        canvas,
        {
          ...settings,
          bgColor: item.bgColor ?? settings.bgColor,
          zoom: item.zoom,
          offsetX: item.offsetX,
          offsetY: item.offsetY
        },
        item.imageEl
      );
      return canvas;
    },
    [settings]
  );

  // Redraw the on-screen preview whenever the active customer or settings change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active?.imageEl) return;
    drawSheet(
      canvas,
      {
        ...settings,
        bgColor: active.bgColor ?? settings.bgColor,
        zoom: active.zoom,
        offsetX: active.offsetX,
        offsetY: active.offsetY
      },
      active.imageEl
    );
  }, [active, settings]);

  // ---- background removal queue (one image at a time, to protect weak PCs) ----
  const processOne = useCallback(
    async (item: BatchItem, pos: { index: number; total: number }) => {
      const where = pos.total > 1 ? `${item.name} · photo ${pos.index} of ${pos.total}` : item.name;

      updateItem(item.id, { status: "working", error: undefined });
      setLoader({ title: "Removing the background", detail: where, percent: 0 });

      try {
        const cut = await removeBgOnDevice(item.blob, (p) => {
          // The first photo also pulls the model down the wire, once ever.
          const next: LoaderState =
            p.phase === "download"
              ? {
                  title: "Downloading the background remover",
                  detail: "One-time download — afterwards it runs offline",
                  percent: p.percent
                }
              : { title: "Removing the background", detail: where, percent: p.percent };
          // This callback fires very often; identical values bail out of the
          // re-render so a weak machine isn't re-rendering while it should be
          // crunching the image.
          setLoader((prev) =>
            prev &&
            prev.title === next.title &&
            prev.detail === next.detail &&
            prev.percent === next.percent
              ? prev
              : next
          );
        });
        const url = URL.createObjectURL(cut);
        const el = await loadImage(url);
        updateItem(item.id, { imageEl: el, status: "done", usedFallback: false });
      } catch (e) {
        const el = await loadImage(item.originalUrl);
        updateItem(item.id, {
          imageEl: el,
          status: "error",
          usedFallback: true,
          error: (e as Error).message
        });
      }
    },
    [updateItem]
  );

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setProcessing(true);
    let done = 0;
    while (queueRef.current.length) {
      const next = queueRef.current.shift();
      if (!next) continue;
      // Recomputed each pass so photos added mid-run are counted in the total.
      await processOne(next, { index: done + 1, total: done + 1 + queueRef.current.length });
      done += 1;
    }
    runningRef.current = false;
    setProcessing(false);
    setLoader(null);
  }, [processOne]);

  const enqueue = useCallback(
    (list: BatchItem[]) => {
      if (!list.length) return;
      queueRef.current.push(...list);
      void drain();
    },
    [drain]
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) {
        setError("Please choose image files.");
        return;
      }
      setError(null);
      setPreparing(true);
      setLoader({
        title: "Preparing photos",
        detail: `Reading ${images.length} file${images.length === 1 ? "" : "s"}…`,
        percent: null
      });

      const created: BatchItem[] = [];
      for (const file of images) {
        try {
          const blob = await downscale(file);
          const url = URL.createObjectURL(blob);
          created.push({
            id: crypto.randomUUID(),
            name: `Customer ${itemsRef.current.length + created.length + 1}`,
            originalUrl: url,
            blob,
            imageEl: null,
            status: "pending",
            usedFallback: false,
            bgColor: null,
            zoom: 1,
            offsetX: 0,
            offsetY: 0
          });
        } catch {
          /* skip unreadable file */
        }
      }
      setPreparing(false);

      if (!created.length) {
        setLoader(null);
        setError("None of those files could be read.");
        return;
      }

      setItems((prev) => [...prev, ...created]);
      setActiveId((prev) => prev ?? created[0].id);
      enqueue(created);
    },
    [enqueue]
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) {
        if (target.originalUrl) URL.revokeObjectURL(target.originalUrl);
        const src = target.imageEl?.src;
        if (src && src.startsWith("blob:") && src !== target.originalUrl) URL.revokeObjectURL(src);
      }
      return prev.filter((it) => it.id !== id);
    });
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  const clearAll = useCallback(() => {
    if (
      itemsRef.current.length &&
      !window.confirm("Remove all customers and start over? This can't be undone.")
    ) {
      return;
    }
    itemsRef.current.forEach((it) => {
      if (it.originalUrl) URL.revokeObjectURL(it.originalUrl);
      const src = it.imageEl?.src;
      if (src && src.startsWith("blob:") && src !== it.originalUrl) URL.revokeObjectURL(src);
    });
    queueRef.current = [];
    setItems([]);
    setActiveId(null);
    setError(null);
  }, []);

  const retryFailed = useCallback(() => {
    const failed = itemsRef.current.filter((it) => it.status === "error" || it.status === "pending");
    if (failed.length) {
      setError(null);
      enqueue(failed);
    }
  }, [enqueue]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) void addFiles(files);
  };

  // ---- crop (per customer) ----
  const setActiveCrop = (patch: Partial<Pick<BatchItem, "zoom" | "offsetX" | "offsetY">>) => {
    if (active) updateItem(active.id, patch);
  };
  const resetCrop = () => setActiveCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
  const applyCropToAll = () => {
    if (!active) return;
    const { zoom, offsetX, offsetY } = active;
    setItems((prev) => prev.map((it) => ({ ...it, zoom, offsetX, offsetY })));
  };

  // ---- background colour (batch default, or per-customer override) ----
  const activeBg = active ? active.bgColor ?? bgColor : bgColor;
  const shownBg = colorScope === "active" ? activeBg : bgColor;
  const overrideCount = items.filter((it) => it.bgColor).length;

  const setColour = (value: string) => {
    if (colorScope === "active" && active) {
      updateItem(active.id, { bgColor: value });
    } else {
      setBgColor(value);
    }
  };
  const useBatchColour = () => {
    if (active) updateItem(active.id, { bgColor: null });
  };

  // ---- export ----
  const doneItems = items.filter((it) => it.imageEl);

  const exportActivePng = async () => {
    if (!active) return;
    const canvas = renderItem(active);
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    if (blob) download(blob, `passport-${safeName(active.name, 0)}-A4.png`);
  };

  const exportActivePdf = () => {
    if (!active) return;
    const canvas = renderItem(active);
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    doc.addImage(dataUrl, "PNG", 0, 0, A4.widthMm, A4.heightMm);
    doc.save(`passport-${safeName(active.name, 0)}-A4.pdf`);
  };

  const downloadAllZip = async () => {
    if (!doneItems.length) return;
    const zip = new JSZip();
    for (let i = 0; i < doneItems.length; i++) {
      const canvas = renderItem(doneItems[i]);
      if (!canvas) continue;
      const blob = await canvasToBlob(canvas);
      if (blob) zip.file(`${safeName(doneItems[i].name, i)}-A4.png`, blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    download(out, `passport-sheets-${today()}.zip`);
  };

  const printSheets = (list: BatchItem[]) => {
    const container = printRef.current;
    if (!container || !list.length) return;
    container.innerHTML = "";
    let remaining = list.length;
    list.forEach((item) => {
      const canvas = renderItem(item);
      if (!canvas) {
        if (--remaining === 0) window.print();
        return;
      }
      const img = document.createElement("img");
      img.className = "print-page";
      img.onload = () => {
        if (--remaining === 0) window.print();
      };
      img.onerror = () => {
        if (--remaining === 0) window.print();
      };
      img.src = canvas.toDataURL("image/png");
      container.appendChild(img);
    });
  };

  const totalPhotos = photosPerRow * rows;
  const hasImage = Boolean(active?.imageEl);

  // Stays up for the whole prepare → remove cycle, so it never blinks off
  // in the gap between the two stages.
  const busy = processing || preparing;
  const shown: LoaderState | null = loader ?? (busy ? { title: "Working…", percent: null } : null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▣</span>
          <div>
            <h1>Passport Sheet Studio</h1>
            <p>Remove the background · pick a colour · print N-up on A4</p>
          </div>
        </div>
        <div className="chip ok">
          {items.length > 1 ? `${items.length} customers · ` : ""}runs on this computer · works offline
        </div>
      </header>

      <main className="workspace">
        <section className="panel">
          {/* 1. Photos */}
          <div className="group">
            <h2>
              <span className="step">01</span>Customer photos
            </h2>
            <div
              className={`dropzone ${dragging ? "over" : ""} ${hasImage ? "has-image" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={items.length ? "Add more customer photos" : "Add customer photos"}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={(e) => {
                if (e.target !== fileInputRef.current) fileInputRef.current?.click();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              {hasImage ? (
                <img src={active?.imageEl?.src} alt="subject" />
              ) : (
                <div className="dropzone-empty">
                  <strong>Drop photos here</strong>
                  <span>one or many — click to choose files</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void addFiles(files);
                  e.target.value = "";
                }}
              />
            </div>

            {error && <p className="hint error">{error}</p>}

            {items.length > 0 && (
              <ul className="batch-list">
                {items.map((it, idx) => (
                  <li
                    key={it.id}
                    className={`batch-item ${active?.id === it.id ? "active" : ""}`}
                    aria-current={active?.id === it.id || undefined}
                    onClick={() => setActiveId(it.id)}
                  >
                    <button
                      type="button"
                      className="batch-thumb"
                      aria-pressed={active?.id === it.id}
                      aria-label={`Select ${it.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveId(it.id);
                      }}
                    >
                      {it.imageEl ? <img src={it.imageEl.src} alt="" /> : <span />}
                    </button>
                    <div className="batch-meta">
                      <input
                        className="batch-name"
                        aria-label={`Name for customer ${idx + 1}`}
                        value={it.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateItem(it.id, { name: e.target.value })}
                      />
                      <span className={`batch-status ${it.status}`}>
                        {STATUS_LABEL[it.status]}
                        {it.bgColor && (
                          <span
                            className="batch-color"
                            style={{
                              background: it.bgColor === "transparent" ? "#fff" : it.bgColor
                            }}
                            title="This customer has its own background colour"
                          />
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="batch-remove"
                      aria-label={`Remove ${it.name}`}
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(it.id);
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {items.length > 0 && (
              <div className="batch-actions">
                {items.some((it) => it.status === "error" || it.status === "pending") && (
                  <button onClick={retryFailed} disabled={processing}>
                    Retry failed
                  </button>
                )}
                {items.length > 1 && (
                  <>
                    <button onClick={() => printSheets(doneItems)} disabled={!doneItems.length}>
                      Print all sheets
                    </button>
                    <button onClick={downloadAllZip} disabled={!doneItems.length}>
                      Download all (ZIP)
                    </button>
                  </>
                )}
                <button onClick={clearAll} disabled={processing}>
                  Clear all
                </button>
              </div>
            )}

            {hasImage && (
              <div className="crop">
                <label>
                  <span>Zoom {(active?.zoom ?? 1).toFixed(2)}×</span>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={active?.zoom ?? 1}
                    onChange={(e) => setActiveCrop({ zoom: Number(e.target.value) })}
                  />
                </label>
                <label>
                  <span>Left / right</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={active?.offsetX ?? 0}
                    onChange={(e) => setActiveCrop({ offsetX: Number(e.target.value) })}
                  />
                </label>
                <label>
                  <span>Up / down</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={active?.offsetY ?? 0}
                    onChange={(e) => setActiveCrop({ offsetY: Number(e.target.value) })}
                  />
                </label>
                <div className="crop-buttons">
                  <button className="ghost" onClick={resetCrop}>
                    Reset crop
                  </button>
                  {items.length > 1 && (
                    <button className="ghost" onClick={applyCropToAll}>
                      Apply to all
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 2. Background */}
          <div className="group">
            <div className="group-head">
              <h2>
                <span className="step">02</span>Background colour
              </h2>
              <div className="scope" role="group" aria-label="Colour applies to">
                <button
                  type="button"
                  className={colorScope === "all" ? "on" : ""}
                  aria-pressed={colorScope === "all"}
                  onClick={() => setColorScope("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={colorScope === "active" ? "on" : ""}
                  aria-pressed={colorScope === "active"}
                  disabled={!active}
                  title={active ? `Only ${active.name}` : "Add a customer first"}
                  onClick={() => setColorScope("active")}
                >
                  This one
                </button>
              </div>
            </div>

            <div className="swatches">
              {BG_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`swatch ${shownBg === p.value ? "active" : ""} ${
                    p.value === "transparent" ? "transparent" : ""
                  }`}
                  title={p.name}
                  aria-pressed={shownBg === p.value}
                  style={
                    p.value !== "transparent"
                      ? ({ "--sw": p.value } as React.CSSProperties)
                      : undefined
                  }
                  onClick={() => setColour(p.value)}
                >
                  <span>{p.name}</span>
                </button>
              ))}
            </div>

            <label className="inline">
              <span>Custom</span>
              <input
                type="color"
                value={shownBg === "transparent" ? "#ffffff" : shownBg}
                onChange={(e) => setColour(e.target.value)}
              />
              <code>{shownBg}</code>
            </label>

            {colorScope === "active" && active && (
              <p className="hint">
                {active.bgColor ? (
                  <>
                    {active.name} has its own colour.{" "}
                    <button type="button" className="linkish" onClick={useBatchColour}>
                      Use the batch colour
                    </button>
                  </>
                ) : (
                  `${active.name} is using the batch colour. Pick one to change just this customer.`
                )}
              </p>
            )}
            {colorScope === "all" && overrideCount > 0 && (
              <p className="hint">
                {overrideCount} {overrideCount === 1 ? "customer has" : "customers have"} their own
                colour.
              </p>
            )}
          </div>

          {/* 3. Layout */}
          <div className="group">
            <h2>
              <span className="step">03</span>Sheet layout
            </h2>

            <label className="inline">
              <span>Photos per row</span>
              <input
                type="number"
                min={1}
                max={maxN}
                value={photosPerRow}
                onChange={(e) => setPhotosPerRow(clamp(Number(e.target.value) || 1, 1, maxN))}
              />
              <em className="muted">max {maxN}</em>
            </label>

            <label className="inline">
              <span>Rows</span>
              <select value={rowsMode} onChange={(e) => setRowsMode(e.target.value as RowsMode)}>
                <option value="auto">Fill page ({autoRows})</option>
                <option value="manual">Manual</option>
              </select>
              {rowsMode === "manual" && (
                <>
                  <input
                    type="number"
                    aria-label="Number of rows"
                    min={1}
                    max={autoRows}
                    value={manualRows}
                    onChange={(e) => setManualRows(clamp(Number(e.target.value) || 1, 1, autoRows))}
                  />
                  <em className="muted">max {autoRows}</em>
                </>
              )}
            </label>

            <label className="inline">
              <span>Photo size</span>
              <select
                value={`${photoW}x${photoH}`}
                onChange={(e) => {
                  const preset = PHOTO_PRESETS.find(
                    (p) => `${p.widthMm}x${p.heightMm}` === e.target.value
                  );
                  if (preset) {
                    setPhotoW(preset.widthMm);
                    setPhotoH(preset.heightMm);
                  }
                }}
              >
                {PHOTO_PRESETS.map((p) => (
                  <option key={p.name} value={`${p.widthMm}x${p.heightMm}`}>
                    {p.name}
                  </option>
                ))}
                {!PHOTO_PRESETS.some((p) => p.widthMm === photoW && p.heightMm === photoH) && (
                  <option value={`${photoW}x${photoH}`}>
                    {photoW} × {photoH}
                  </option>
                )}
              </select>
            </label>

            <div className="mini-grid">
              <label className="mini">
                <span>Width (mm)</span>
                <input
                  type="number"
                  min={15}
                  max={100}
                  value={photoW}
                  onChange={(e) => setPhotoW(clamp(Number(e.target.value) || 15, 15, 100))}
                />
              </label>
              <label className="mini">
                <span>Height (mm)</span>
                <input
                  type="number"
                  min={15}
                  max={120}
                  value={photoH}
                  onChange={(e) => setPhotoH(clamp(Number(e.target.value) || 15, 15, 120))}
                />
              </label>
              <label className="mini">
                <span>Margin (mm)</span>
                <input
                  type="number"
                  min={0}
                  max={25}
                  value={marginMm}
                  onChange={(e) => setMarginMm(clamp(Number(e.target.value) || 0, 0, 25))}
                />
              </label>
              <label className="mini">
                <span>Row gap (mm)</span>
                <input
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={gapMm}
                  onChange={(e) => setGapMm(clamp(Number(e.target.value) || 0, 0, 15))}
                />
              </label>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={cutMarks}
                onChange={(e) => setCutMarks(e.target.checked)}
              />
              <span>Print light cutting lines around each photo</span>
            </label>
          </div>
        </section>

        <section className="stage">
          <div className="stage-head">
            <span className="spec">
              A4 · 210×297 mm · 300 dpi{hasImage ? ` · ${photosPerRow}×${rows} grid` : ""}
            </span>
            <span className="count">
              {hasImage ? `${totalPhotos} up${active ? ` · ${active.name}` : ""}` : "no photo yet"}
            </span>
          </div>

          <div className="page-frame">
            {hasImage ? (
              <div className="sheet-wrap">
                <canvas ref={canvasRef} className="sheet" />
              </div>
            ) : (
              <div className="placeholder">
                <p>Your A4 sheet will appear here.</p>
                <small>Upload one or more photos to begin.</small>
              </div>
            )}
            {!hasImage && <canvas ref={canvasRef} hidden />}

            {shown && (
              <div className="loader">
                {/* announces the phase, not every percent tick */}
                <span className="sr-only" role="status">
                  {shown.title}
                </span>
                <div className="loader-card">
                  <div className="loader-ring" aria-hidden="true" />
                  <div className="loader-copy">
                    <p className="loader-title">{shown.title}</p>
                    {shown.detail && <p className="loader-detail">{shown.detail}</p>}
                  </div>
                  <div
                    className={`loader-bar ${shown.percent === null ? "indeterminate" : ""}`}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={shown.percent ?? undefined}
                    aria-label={shown.title}
                  >
                    <span
                      className="loader-fill"
                      style={
                        shown.percent === null ? undefined : { width: `${shown.percent}%` }
                      }
                    />
                  </div>
                  {shown.percent !== null && <span className="loader-pct">{shown.percent}%</span>}
                </div>
              </div>
            )}
          </div>

          <div className="actions">
            <button className="primary" disabled={!hasImage} onClick={() => active && printSheets([active])}>
              Print
            </button>
            <button disabled={!hasImage} onClick={exportActivePng}>
              Download PNG
            </button>
            <button disabled={!hasImage} onClick={exportActivePdf}>
              Download PDF
            </button>
          </div>
          <p className="footnote">
            Print at 100% / “Actual size” on A4 — do not use “Fit to page”, or the printed size
            will shift. In batch, “Print all sheets” sends one A4 page per customer.
          </p>
        </section>
      </main>

      {/* Populated on demand, only visible when printing */}
      <div ref={printRef} className="print-only" />
    </div>
  );
}
