# Reconnaissance Playbook

Recon records four things about the target:
1. **Visual tokens:** colours, type, spacing, radii and shadows.
2. **Structure:** layout, sticky elements, breakpoints.
3. **Interactions:** menus, drawers, carousels, filters, and state that persists.
4. **Data shape:** what the repeated items contain and how they're worded.

`scripts/capture_target.js` does most of this in one command. The build workflow runs it for you; by hand:

## 1. Capture

```bash
node <skill>/scripts/capture_target.js https://www.example.com --out <replica>/target --pages 3
node <skill>/scripts/capture_target.js <home> <listing-url> <detail-url> --out <replica>/target   # explicit journey
```

The three viewports of a page are captured concurrently, and so are all journey pages after the first (`--concurrency`, default 4 browser contexts). A 3-page capture takes 1–3 minutes. Lower `--concurrency` if the site starts answering 429.

| Output | Use it for |
|---|---|
| `screens/<page>-desktop/tablet/mobile.png` | **Look at these** (Read tool). They are ground truth for layout, hierarchy and breakpoint behaviour. |
| `states/<page>-<n>.png` | Menus and popups opened from the header or nav. Each is a feature to replicate. |
| `capture.json → tokens` | Colour, font, size, radius and shadow frequencies, weighted by painted area or text length. The top entries are the brand. |
| `capture.json → keyElements` | Exact computed styles for header, nav, buttons, inputs and headings, including their box sizes. |
| `capture.json → cardGroups` | Repeated items with real text and image samples. This is the data shape and the card styling. |
| `capture.json → interactive` | Every visible control, with its region. This is the feature checklist. |
| `capture.json → ariaOutline` | The page structure as landmarks, headings, lists and links. |
| `capture.json → links` | Where the journey goes next. Raise `--pages` to follow more. |

If the page you need isn't in the automatic pick (for example search results or a real product page), pass the journey explicitly instead: the home URL followed by each page's URL, in the order a user reaches them. With the workflow, put them in `journey`. To get a real detail URL, capture the listing first and take one from `cardGroups[].samples[].links`.

## 2. Decompose

Map what you see onto the archetype pack ([archetypes/](archetypes/)), and name the pieces at the right level:

| Tier | Examples |
|---|---|
| Atoms | buttons, badges, price tags, star ratings, inputs |
| Molecules | search bar with scope picker, product card, delivery line |
| Organisms | global header, hero carousel, filter sidebar, buy box |
| Views | home, listing/search, detail, cart/checkout drawer |

Each view becomes a `spec.pages` entry (views with the same layout share one `module`). The global header, nav, drawers, popovers and footer belong to `builder:shell`; each organism in them that has behaviour becomes a feature owned by `builder:shell`. Every other organism with behaviour becomes one or more features owned by its view's Builder.

## 3. Blocked targets

`capture.json` says `"blocked": true` when the site returned an error status or its title or content looks like a CAPTCHA or bot wall. Don't try to get around bot protection. Instead:

1. **Try once more** with `--pages 1` on a simpler public page of the same site (for example a help or about page). Those pages often share the header, footer and tokens.
2. **Use public material.** Use `WebSearch` and `WebFetch` to find the site's published design system or brand guidelines, press screenshots, and the Wayback Machine (`https://web.archive.org/web/2025/<url>`). Capture works on Wayback pages too:
   ```bash
   node <skill>/scripts/capture_target.js "https://web.archive.org/web/2025/https://www.example.com/" --out <replica>/target --pages 1
   ```
   Wayback's toolbar appears in the screenshots and in the tokens. Ignore the top ~60 px and its styles.
3. **Record honestly.** Set `"measured": false` in the spec, and note which values came from which source. The final report must say the result is *reconstructed, not measured*.
