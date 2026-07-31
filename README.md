# Tufted Tales Studio

Marketing site for Tufted Tales Studio — a hands-on rug tufting studio in Columbus, GA.
Grand opening September 2026.

- **Live:** tuftedtalesstudio.com (pending)
- **Founder:** Taiylor Williams
- **Stack:** [Astro](https://astro.build) (static), deployed on Vercel

## Local development

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # static output → ./dist
npm run preview   # preview the built site locally
```

## Project layout

```
src/
  layouts/Layout.astro        # <html>, head, nav, footer wrapper
  components/                 # Nav, Footer, AnnouncementBar, PageHero
  pages/                      # one .astro file per URL
  styles/global.css           # brand tokens (colors, fonts) + base styles
public/
  brand/                      # logo SVGs (badge, wordmark, sticker, vertical)
  fonts/                      # Klibeuth + Hellenic Wide (Mulish loads from Google Fonts)
```

## Brand

Palette (from the logo SVGs):

| Token | Hex |
|---|---|
| `--teal` | `#064946` |
| `--olive-dark` | `#696D45` |
| `--olive` | `#969959` |
| `--sage` | `#B2B267` |
| `--terracotta` | `#B04725` |
| `--cream` | `#EED6BF` |
| `--paper` (bg) | `#FAF4EA` |

Type:
- **Klibeuth** — display script (headlines)
- **Hellenic Wide** — block sans (eyebrows, subtitles)
- **Mulish** — body

## TODOs before launch

- [ ] Swap hero video placeholder on `/` for real footage (`src/pages/index.astro`)
- [ ] Paste Acuity embed URL on `/workshops` (`src/pages/workshops.astro`, look for `TODO`)
- [ ] Replace gallery gradient tiles with real photos (`src/pages/gallery.astro`)
- [ ] Wire up form submissions (see below)
- [ ] Add Google Analytics or Plausible if desired

## Forms

Form markup currently uses Netlify Forms attributes (`data-netlify`). Since we're deploying to Vercel, these attributes are inert — swap in one of these to make forms work:

- **[Formspree](https://formspree.io)** — change each `<form action>` to your endpoint. Free tier is generous.
- **[Basin](https://usebasin.com)** or **[Getform](https://getform.io)** — same drop-in pattern.
- **Vercel Serverless Function** — add an API route under `src/pages/api/` and change form actions.
