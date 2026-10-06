# Illustrations needed for the launch

_Milestone 30, Phase 1. Owner action: commission, license or draw these, then drop the files into
`frontend/src/assets/illustrations/` with exactly these names and rebuild. No code change is needed —
`components/Illustration.tsx` finds a file by name at build time and uses it in place of its placeholder._

## The rules for every file

- **Licensed or commissioned only.** Never hotlinked, never taken from a search result, never the
  AI-generated mockup art itself — its lettering is garbled (the book spines read "MATYEMATICS",
  "LOUIC", "PRACTICE" with errors; a framed print reads "Good Math Brighter Futures") and must not be
  reproduced.
- **No text in the art.** Words belong in the page, where they can be read aloud, translated and
  corrected. Art with words in it is also why the mockup's art is unusable.
- **Transparent background**, so it sits on both the light page and the dark theme's black page.
- **Formats:** an `.svg` for flat vector art (preferred — one file, any size). For painted or 3D-style
  art like the mockups', WebP at 1× and 2× — `name.webp` and `name@2x.webp` — and optionally AVIF
  (`name.avif`, `name@2x.avif`), which the page will prefer where the browser supports it.
- **Display size** below is the box the page reserves; supply 1× at that size and 2× at double.
  Keep each 1× WebP under ~60 kB (the hero under ~120 kB) — most students are on mid-range phones
  over mobile data.
- **People:** the mockups show children. If commissioned art shows a student, it must be a drawn
  character, never a photograph of a real child.

## The list

| File name | Where it appears | Display size (px) | What it shows |
|---|---|---|---|
| `hero-student` | Homepage hero, right of the headline | 520 × 520 | A student holding maths books, looking up and to the right; light doodles (π, a triangle, a cube) around them. **This is likely the LCP image** — make it the lightest file you can. |
| `maths-doodles` | Homepage hero background, behind the headline | 480 × 360 | Faint line doodles — a protractor, a cube, a graph, π, √ — in brand blue at low contrast. SVG ideal. |
| `light-bulb` | "Can you crack this?" card and the dashboard's Daily Quiz card, beside "Think · Analyse · Solve · Grow" | 160 × 140 | A line-drawn light bulb with a few rays. SVG ideal. |
| `paper-plane` | "How it works" — the plane at the end of the dashed path | 120 × 80 | A line-drawn paper plane. SVG ideal. |
| `journey-enrolled` | Journey (homepage + dashboard), step 1 "Enrolled" | 120 × 104 | A student signing up — a badge or a name card. |
| `journey-verified` | Journey, step 2 "Email verified" | 120 × 104 | An envelope with a tick. |
| `journey-first-practice` | Journey, step 3 "First practice" | 120 × 104 | A target with an arrow in it. |
| `journey-first-quiz` | Journey, step 4 "First Daily Quiz" | 120 × 104 | A lightning bolt over a question card. |
| `journey-habit` | Journey, step 5 "Three days running" | 120 × 104 | A small flame — a streak. |
| `journey-first-mock` | Journey, step 6 "First mock test" | 120 × 104 | A test paper on a clipboard. |
| `journey-level-3` | Journey, step 7 "Level 3" | 120 × 104 | Steps or a rising arrow. |
| `journey-seasoned` | Journey, step 8 "Ten practice sessions" | 120 × 104 | A short stack of books. **No titles on the spines.** |
| `journey-olympiad-ready` | Journey, step 9 "Olympiad ready" | 120 × 104 | A medal or a podium. |
| `trophy` | Sunday Math Boss Battle card (only if the Boss Battle is approved — PLAN.md Q6) | 220 × 220 | A gold trophy with a little sparkle. |
| `gift-box` | Month-End Booster card and the Rewards section's Daily Quiz Champion card | 200 × 200 | A wrapped gift box with confetti. |
| `book-stack` | Dashboard welcome banner, right side | 360 × 220 | A desk with a stack of books and a pencil cup. **No titles on the spines.** |
| `plant` | Dashboard "Today's maths thought" card | 120 × 140 | A small potted sprout. |
| `mountain-climber` | Homepage final call to action, and the dashboard's motivational card | 360 × 260 | A student with a backpack planting a flag on a summit. |

The owner chose (2026-10-04, PLAN.md Q7) to show the platform's own **nine journey milestones** rather
than the mockup's six themed months, so the journey files are named after those milestones. They are
shown on the homepage now, with placeholders until the art arrives.

## What the page shows until a file exists

A soft brand-tint gradient with one line icon for the subject (a graduation cap, a book, a trophy, a
gift…), at the same size, so nothing shifts when the real art arrives. You can see every placeholder
together at `/dev/ui` (development only) under **Illustration**.

## Also needed (not illustrations)

| Asset | Where | Notes |
|---|---|---|
| Social share image | `og:image` for links shared on WhatsApp and social media | ✅ **Generated in Phase 6** — `frontend/public/og-image.jpg` (1200 × 630, 94 kB): the emblem, "A.M.I.T. Olympiad", the full form and the year, in the brand font. Replace it with your own art at the same name and size if you like — nothing else changes. |
| Apple touch icon and a full favicon set | Browser tabs and phone home screens | ✅ **Generated in Phase 6** from the emblem in `logo.png` — `favicon.ico` (16/32/48), `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`, all in `frontend/public/`. To regenerate after changing the logo: `node scripts/make-brand-images.ts` in `frontend/` (needs Edge). |
