# Passport Sheet Studio

An internal tool that automates the passport-photo production flow:

**upload a customer photo → background removed → pick a background colour → photos tiled N-up on A4 → print.**

It replaces the old manual chain of *removebg.com → CorelDRAW → copy/paste 5 per row*.

---

## How it works

**Everything runs in the employee's browser.** There is no server-side processing.

1. **Upload** — drag & drop or browse for a head-and-shoulders photo.
2. **Background removal** — done on the employee's own computer by a small model that the
   browser downloads **once** (about 44 MB) and then caches. No upload, no third party,
   no per-photo cost, and it keeps working offline afterwards.
3. **Background colour** — pick from presets (white, off-white, greys, blues, cream) or a custom
   colour, or keep it transparent.
4. **Layout** — photos default to **36 × 46 mm** (changeable; 35 × 45 passport is a preset). Choose
   how many go **per row**; the row fills the A4 width and the rows sit from the top. Caps at **30
   per sheet**. Optional light cutting lines.
5. **Output** — the sheet is rendered at **A4, 300 DPI (2480 × 3508 px)**, then you can **Print**,
   **Download PNG**, or **Download PDF**.

Because there is no server code, this can be hosted on any free static host, and your internet
connection is only needed for the one-time model download per computer.

---

## Running it

Requirements: **Node.js 18+**. (No Python, no other setup.)

```bat
npm.cmd install
npm.cmd run dev
```

Then open <http://localhost:4310>.

> On machines where PowerShell scripts are disabled, use `npm.cmd` (not `npm`) in a normal
> Command Prompt / PowerShell window — the `.cmd` shim works around the execution policy.

### The background remover

- The first time someone removes a background, their browser downloads the model (about 44 MB)
  and caches it. After that it is instant and works without internet.
- To change the model, create a `.env.local` file (or set an environment variable) before building:
  ```
  NEXT_PUBLIC_BG_MODEL=isnet_quint8
  ```
  | Value | Size | Notes |
  |---|---|---|
  | `isnet_quint8` | ~10 MB | smallest / slowest quality |
  | `isnet_fp16` | ~44 MB | **default**, good balance |
  | `isnet` | ~88 MB | largest / best quality |

---

## Hosting

There is no backend to run. Any of these work on their free tiers:

- **Render** — deploy as a normal Node web service (`npm.cmd run build`, `npm.cmd run start`), or
  as a **Static Site**. The free 512 MB / 0.1 CPU limits are fine now, because the browser does
  all the heavy work.
- **Vercel / Netlify / Cloudflare Pages / GitHub Pages** — all work.

If you only want flat files, add `output: "export"` to `next.config.mjs`, run `npm.cmd run build`,
and upload the generated `out/` folder to any static host.

---

## Printing correctly

Print at **100% / "Actual size"**, on A4. If the driver uses *"Fit to page"* or *"Shrink to fit"*
the printed size will drift. The PDF export is already exactly A4, so it's the safest option
for the print shop.

---

## Project layout

```
app/
  page.tsx                 entry page
  layout.tsx               app shell / metadata
  globals.css              styles
components/
  PassportStudio.tsx       the whole UI: upload, on-device removal, controls, preview, export
lib/
  constants.ts             A4 size, DPI, colour + size presets
  sheet.ts                 A4 layout maths + canvas rendering
```

## Ideas for a v2

- **Batch mode** — queue several customer photos and generate one sheet per person.
- **Saved presets** — remember the company's favourite colour/size/layout.
- **Auto face framing** — detect the face and centre it automatically instead of manual zoom/pan.
- **Logo / watermark** option in the page margin.
