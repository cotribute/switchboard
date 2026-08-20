---
name: cotribute-brand
description: Apply Cotribute's brand identity (logo, colors, typography, tagline) to any deliverable created on the company's behalf, such as slide decks, one-pagers, proposals, HTML pages, dashboards, or documents. Use whenever a task asks for something "branded," "on-brand," a Cotribute deck/doc/site, a customer-facing deliverable, or when logo files or brand colors are needed. Source: Cotribute Brand Guidelines 1.0 (Mar 2022) plus the 2026 refreshed logo set.
---

# Cotribute Brand Guidelines

Use this skill any time you are producing something that represents Cotribute externally or in a polished internal deliverable: slide decks, PDFs, HTML pages/dashboards, proposals, one-pagers, email templates, or similar. It is not needed for casual internal notes or plain-text answers.

## Wordmark and logo

The current wordmark is **cotribute** (all lowercase). The 2022 guidelines show an earlier stylized version, **co.tribute**, with a period and small accent dot — that version is legacy; default to the plain **cotribute** wordmark from the 2026 logo set unless the user asks for the legacy mark.

Tagline: **"The Work You Do is Meaningful"** (™). Use it sparingly, in Proxima Nova, only where the brand guidelines specifically call for it (title slides, closing slides) — do not stamp it on every page.

Logo files are in `assets/logos/`. Pick the variant based on background:

- `Cotribute_Dark.png` — full color icon + dark gray wordmark. Default choice for light/white backgrounds.
- `Cotribute_Dark_Trimmed.png` — same as above, tighter-cropped bounding box. Prefer this one when vertical space is tight (headers, footers, favicons-adjacent placements).
- `Cotribute_Color_White.png` — full color icon + white wordmark. Use on dark or brand-color backgrounds where the icon should stay in color.
- `Cotribute_White_White.png` — fully white icon + wordmark. Use on dark or saturated color backgrounds when a single-color knockout mark is needed.
- `Cotribute_monochrome.png` — single dark gray icon + wordmark. Use for one-color-only contexts (e.g. letterhead, fax cover, engraving, single-color print).

Never recolor the icon (the four-triangle mark) outside of these approved variants, never stretch the logo disproportionately, and always leave clear space around it roughly equal to the height of the icon.

## Color palette

Primary palette (use these as the categorical/accent colors in any chart, UI, or layout):

| Name | Hex | RGB |
|---|---|---|
| Teal | #52C1B2 | 83, 193, 178 |
| Green | #8DC756 | 141, 200, 86 |
| Orange | #F99E1B | 249, 159, 28 |
| Pink/Red | #EE6E7D | 239, 111, 126 |

Neutrals:

| Name | Hex | RGB |
|---|---|---|
| Charcoal (near-black) | #262F2C | 38, 47, 44 |
| Warm gray | #BAC9C7 | 186, 201, 199 |
| Off-white | #EDF2F2 | 237, 242, 242 |

Use Charcoal (#262F2C) instead of pure black for text and dark backgrounds — it reads as part of the brand rather than generic black. Use Off-white (#EDF2F2) instead of pure white for light section backgrounds when a softer look is wanted.

If you are also loading the `dataviz` skill for a chart, treat these four brand colors as the categorical seed palette and Charcoal/Warm gray/Off-white as the neutral scale, adapting dataviz's contrast/accessibility rules on top of them rather than substituting a generic palette.

## Typography

- **Headers**: Calluna Regular, 54pt in the original deck (scale proportionally elsewhere). Serif, editorial feel. Alternatives if Calluna is unavailable: Arnhem, Ehrhardt, Libre Baskerville (Canva only), Georgia (email/blog only).
- **Subheaders**: Proxima Nova Semibold, 26pt. Alternatives: Gotham, Montserrat.
- **Body copy**: Proxima Nova Regular, 16pt (also the tagline font).
- **Detail/labels**: Proxima Nova Bold, 8pt, typically in a brand accent color (teal in the source deck), often small-caps or letter-spaced.
- Web/email fallback stack when Proxima Nova isn't licensed on the target platform: Gotham, Montserrat, or Verdana.

For HTML/web deliverables, pair a serif Google Font resembling Calluna (e.g. "Fraunces" or "Lora") for headers with a geometric sans (e.g. "Montserrat" or system sans) for body text, since Calluna and Proxima Nova are not freely web-licensed.

## Applying this to deliverables

- Slide decks (pptx skill): use `Cotribute_Dark.png` or `_Trimmed` on light title/section slides, `Cotribute_White_White.png` or `Cotribute_Color_White.png` on dark/color slides. Pull the accent colors above for chart series and callouts. Set headline type in a Calluna-like serif and body in a Proxima-Nova-like sans per the fallback stack.
- Documents (docx skill): same logo placement logic in headers/cover pages; body text in the sans fallback, headings in the serif fallback.
- Web pages / dashboards (dataviz skill, HTML artifacts): use the palette table above as the brand color tokens (CSS variables), Charcoal for text/dark surfaces, Off-white for light surfaces, and the four accent hues for categorical data or UI accents.
- Always confirm which logo variant fits the actual background color being used rather than defaulting to one variant everywhere.
