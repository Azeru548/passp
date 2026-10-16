# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary:** staff (employees) at a single photo / print shop. They sit at a
counter computer beside the printer with a customer's head-and-shoulders photo
and produce a print-ready passport photo sheet on demand. They also process
batches in one sitting (a queue of walk-in customers, or one client's staff), so
the tool has to serve both a single person and a run of them. The customer does
not operate the tool; the employee does.

## Product Purpose

Turn a customer head-and-shoulders photo into a print-ready A4 sheet of
correctly sized passport photos in a few clicks. It exists to replace a manual
chain — *removebg.com → CorelDRAW → copy/paste 5 per row* — which was slow,
cost money per photo, and exposed the customer's photo to a third party.

**Success:** an accurate sheet produced in seconds, printed at 100% / "Actual
size", at zero per-photo cost, with the photo never leaving the shop's computer.

## Positioning

**Fully client-side passport-sheet production.** Background removal runs in the
employee's own browser via a small model downloaded once (~44 MB) and then
cached; from then on it is instant and works offline. There is no server, no
third-party upload, and no per-photo fee.

A remove.bg-style SaaS cannot truthfully claim *"the customer's photo never
leaves the computer"* — that promise is the mechanism a neighbouring product
could not copy without giving up its own architecture.

## Operating Context

- **Physical print workflow.** A4 (210 × 297 mm) paper at 300 DPI
  (2480 × 3508 px), printed at **100% / "Actual size"** — never "Fit to page",
  which drifts the stated millimetre size. Browser print is the primary output;
  PDF is the safest hand-off to a print shop.
- **Batch is a real mode.** One A4 page per customer; "Print all sheets" and
  "Download all (ZIP)" exist for runs, and each customer carries a name and a
  status.
- **Colour and size are authority-driven.** Background colour is chosen to match
  what the customer or issuing authority requires; photo size is a regulation
  figure. The default is **35 × 45 mm**, repeated as the canonical passport size
  in the UI copy, with presets for US 2 × 2 in, 33 × 48 mm, and 40 × 50 mm.
- Employees run this at the machine, so latency and clarity during a live
  counter interaction matter more than exploration.

## Capabilities and Constraints

**Confirmed functionality**

- On-device background removal; model selectable via `NEXT_PUBLIC_BG_MODEL`
  (`isnet_quint8` ~10 MB / `isnet_fp16` ~44 MB *default* / `isnet` ~88 MB).
- Multi-photo batch with per-customer name, thumbnail, and status; retry-failed;
  clear-all.
- Background presets (white, off-white, light grey, sky blue, light blue, deep
  blue, red, cream, transparent) plus a custom colour picker.
- Per-photo crop: zoom (1–3×), pan left/right and up/down, reset crop, apply crop
  to all.
- Layout: photos per row (up to a computed maximum), rows (auto fill-page or
  manual), photo-size presets and custom width/height, margin (mm), spacing (mm),
  and optional light cutting lines.
- Export: Print, Download PNG, Download PDF per customer; Print-all and
  Download-all (ZIP) for batch.

**Technical constraints**

- **No backend / no server-side processing.** All work happens in the browser.
- Static-hostable: Render (service or static site), Vercel, Netlify, Cloudflare
  Pages, GitHub Pages, or flat files via `output: "export"`. Only a one-time
  model download per computer needs the network.
- Dev/build requires **Node.js 18+**. On machines with PowerShell execution
  policy restrictions, the documented invocation is `npm.cmd`.

**Terminology:** "sheet", "N-up", "photos per row", "rows", "cutting lines",
"background colour", "customers".

**Open / undecided:** no product-specific accessibility requirement has been
established (see Accessibility section, omitted).

## Evidence on Hand

- A working implementation: `app/` (entry shell, `globals.css`), `components/PassportStudio.tsx`
  (the whole UI and flow), `lib/constants.ts` (A4, DPI, colour + size presets),
  `lib/sheet.ts` (A4 layout maths and canvas rendering).
- `README.md` documenting the flow, the background-remover model options, hosting
  targets, and the correct-printing note.
- The **real replaced workflow** — removebg.com → CorelDRAW → copy/paste 5 per
  row — as stated in the README.

**Absences future work must not fabricate:** there are no testimonials,
customers, case studies, benchmarks, pricing, press, logos, or brand assets.
Nothing of that kind exists, and none should be invented.

## Product Principles

1. **No photo leaves the machine.** On-device processing is the core promise —
   never add a feature that requires uploading a customer's photo.
2. **Output is print-truthful.** 300 DPI, exact A4, 35 × 45 mm by default.
   Anything that risks size drift at print is a defect, not a preference.
3. **Zero marginal cost, offline-capable.** No per-photo fees and no server; the
   one-time model download is the only thing that needs the network.
4. **Counter-speed for one, throughput for a batch.** The same tool must serve a
   single walk-in quickly and a queue without friction.
5. **Replace the manual chain step-for-step.** Every action in the old
   remove.bg / CorelDRAW workflow should map to one obvious control here.
