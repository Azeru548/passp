# Critique — Passport Sheet Studio

**Mode:** Operate (a tool staff drive at a counter under time pressure).
Priorities invert here: scanability, consistency, error prevention and native
expectations outrank expression. The job is *get a correct sheet out fast*.

**Method:** heuristic review grounded in the implementation —
`components/PassportStudio.tsx`, `app/globals.css`, `lib/sheet.ts` — plus
`PRODUCT.md` and computed WCAG contrast ratios. This is a code-grounded review,
**not** a live browser click-through, so anything dependent on real rendering
(scaling, print dialog) is flagged as a risk rather than a fact.

**Heuristics:** Task flow & IA · Feedback & status · Error prevention & recovery ·
Consistency · Accessibility · Performance · Copy & terminology.

**Severity:** `P0` blocks / wrong output / data loss · `P1` major friction or a
real accessibility barrier · `P2` moderate friction, confusion or lost trust ·
`P3` polish.

---

## Status (updated 2026-10-16)

**Resolved:** FLOW-4 (per-customer colour), ERR-1 (confirm Clear all), ERR-2 (rows
clamped + hard guard in `computeLayout`), A11Y-1/A11Y-2 (keyboard access to upload
and the customer list), A11Y-3 (contrast token `--ink-3` → `#667082`, ≈5:1), A11Y-4
(`aria-pressed` on swatches), A11Y-5 (labelled controls, dead `sr-only` removed),
FB-2 (preparing state now visible).

**Still open:** FLOW-1, FLOW-2, FLOW-3, ERR-3, ERR-4, FB-1, FB-3, PERF-1, COPY-1,
CONS-1.

---

## Findings

| ID | Sev | Area | Finding | Fix |
|----|-----|------|---------|-----|
| **FLOW-4** | **P1** | Product / workflow | One background colour for the *whole* batch. A queue where customers need different colours (e.g. white vs US blue) cannot be produced in one run. | Per-customer colour override that inherits the batch default; or group the batch by colour. |
| **ERR-1** | **P1** | Error prevention | "Clear all" wipes the entire queue and revokes every blob URL with no confirm and no undo (`PassportStudio.tsx:328`). Mid-batch, that's unrecoverable. | Confirm when items exist; keep a session undo snapshot. |
| **A11Y-1** | **P1** | Accessibility | The upload dropzone is a `<div onClick>` (`:449`) — not focusable, no role, no keyboard activation. A keyboard/AT user simply cannot add photos. | Make it a real `<button>` (or `role="button"` + `tabIndex=0` + Enter/Space). |
| **A11Y-2** | **P1** | Accessibility | Customer rows are `<li onClick>` (`:487`) with no keyboard access; you can't select a customer without a mouse. | Make each row a `<button>` or add role + key handling. |
| **FLOW-1** | P2 | Task flow / IA | Two competing print actions: **Print** (stage, active customer only) vs **Print all sheets** (left panel, only when >1). Which one a click does is ambiguous. | One Print with an explicit scope, or "Print this sheet" / "Print all N sheets", co-located. |
| **FLOW-2** | P2 | IA | Output actions are split and mis-parented: "Print all sheets" + "Download all (ZIP)" sit under step **01 Photos**; Print/PNG/PDF sit on the stage. | Group all output under one Output area (a step 04 or the stage). |
| **FLOW-3** | P2 | IA | Steps 02–03 (colour, layout) sit below the queue **and** the crop controls, and the panel scrolls as one column — so every colour change means scrolling past the whole customer list. | Make the three steps collapsible, or pin Background/Layout above the queue. |
| **ERR-2** | P2 | Error prevention | Manual row count is **unclamped** (`:656`). Set Rows=20 at 45 mm and the grid overflows A4 with no warning; cells are silently clipped (`lib/sheet.ts`, `startY`). | Clamp to what fits, or show an inline "won't fit" warning. |
| **ERR-3** | P2 | Error prevention | A customer whose removal **failed** renders the *original* photo and is labelled "original (no removal)" (`:128,235`) — easy to print by mistake. | Make it explicit and blocking: flag the row, and confirm before including it in Print-all. |
| **FB-1** | P2 | Feedback | No overall queue progress ("3 of 10"). The busy line shows only the current item's name + % (`:481`). | Show `Removing background — 3 of 10`. |
| **FB-2** | P2 | Feedback | "Preparing images…" is set but **never visible** — the busy hint renders only while `processing`, which is still `false` during downscaling (`:277` vs `:481`). | Render the preparing state, or set `processing` before the downscale loop. |
| **A11Y-3** | P2 | Accessibility | Low-contrast text: `--ink-3` **#8b93a1 on white = 3.1:1** (AA needs 4.5:1). Used for the tagline, batch statuses, the footnote, mini labels, placeholder and hex code. | Darken to ≈`#6b7684` (≈4.6:1), or reserve it for non-text. |
| **PERF-1** | P2 | Performance | Print-all builds PNG data URLs of *every* A4 sheet (2480×3508) in memory before `window.print()` (`:400`) — heavy on a low-spec counter PC for large batches. | Chunk the print job, or fall back to PDF / one sheet at a time when N is large. |
| **A11Y-4** | P2 | Accessibility | The active colour swatch is signalled by a ring only — no `aria-pressed` (`:599`), so a screen reader can't tell which colour is chosen. | Add `aria-pressed` to swatches. |
| **ERR-4** | P3 | Error prevention | Clicking the photo preview *is* clicking the dropzone, so it opens the file picker and silently adds another customer (`:457`). | Separate "add more" from the preview once populated. |
| **A11Y-5** | P3 | Accessibility | The remove button's accessible name is "×" (title only); `sr-only {idx}` (`:504,514`) is meaningless. | `aria-label="Remove <name>"`; delete the sr-only index. |
| **COPY-1** | P3 | Copy | "30 **up**" is print jargon; "Left / right" and "Up / down" don't say which way `+` goes; the custom row shows the literal word "transparent" next to a white swatch. | "30 photos"; "Move right/left", "Move down/up"; show "no fill". |
| **FB-3** | P3 | Feedback | The one-time ~44 MB model download is announced only as a small line in the left rail; a blank stage meanwhile gives no reassurance. | Surface a one-time "downloads once, then offline" note near the stage on first run. |
| **CONS-1** | P3 | Consistency | The green chip is styled like a live health indicator but is a static claim (`:437`). | Make it neutral, or drive it from a real signal. |

---

## Fix first (highest value per effort)

1. **FLOW-4** — per-customer colour. The one finding that can block a real counter
   transaction outright.
2. **ERR-1** — confirm "Clear all". One guard against losing a whole batch.
3. **A11Y-1 + A11Y-2** — keyboard access to upload and the customer list. Cheap,
   and currently an absolute barrier.
4. **ERR-2** — clamp or warn on overflowing rows (prevents a wrong print).
5. **FLOW-1 + FLOW-2** — one Output area, unambiguous print scope.
6. **A11Y-3** — darken `--ink-3`; a token change that lifts many small labels at once.
7. **FB-1 + FB-2** — "N of M" progress and a visible preparing state.

## Working well (keep)

- Genuine step numbering 01→03 — it maps to the real order of work.
- On-device removal with a live percentage and honest "one time only" copy.
- The A4 spec readout and crop-mark stage make the output feel trustworthy.
- Sensible defaults: 35×45 mm, 5 per row, auto rows, white, cutting lines on.
- `:focus-visible` and `prefers-reduced-motion` are already handled.
- Status colours (queued / removing / ready / fallback) are distinguishable.
