# Target Reconnaissance & Research Playbook

This playbook provides actionable procedures for an autonomous AI agent to dissect, analyze, and profile any target URL or web concept prior to code generation.

---

## 1. Reconnaissance Objectives

Before writing code, the agent must extract four critical dimensions from the target:
1. **Visual & Design Tokens**: Color palette, typography scale, spacing units, elevation/shadows, radii.
2. **Structural Anatomy**: Layout grids, flex structures, sticky elements, z-index layering, responsive breakpoints.
3. **Interactive Mechanics**: Micro-interactions, transitions, modals, drawers, carousels, hover states, client state stores.
4. **Data & Schema Topology**: Information architecture, card schemas, badge types, pricing structures, facet categories.

---

## 2. Multi-Modal Inspection Workflow

When investigating a live URL (e.g., `https://www.amazon.com/`):

### Step 1: Initial Health & Access Check
Use `read_url_content` or a quick headless curl via `run_command`:
```bash
curl -s -I -L "https://www.amazon.com/" -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
```
- If HTTP 200 OK: proceed to browser inspection.
- If HTTP 403, 429, or CAPTCHA detected: immediately trigger the **Anti-Bot Mitigation Protocol** (Section 4).

### Step 2: Visual & DOM Capture via `browser_subagent`
Deploy a browser subagent with a structured inspection prompt:
```text
Task: Navigate to <TARGET_URL>. Inspect the homepage and primary navigation.
1. Capture screenshots at 1440px (Desktop), 768px (Tablet), and 375px (Mobile).
2. Inspect the global header: identify search bar, location picker, flyout menus, and cart badge.
3. Open any primary dropdown/drawer (e.g. "All" menu or category selector) and record its open state DOM.
4. Locate the primary card grid or product showcase section and extract the HTML snippet of a single card.
5. Report the dominant colors, fonts, and interactive elements.
```

### Step 3: Automated Computed Token Extraction
When browser access is active, run this diagnostic script in the browser context (or via `scripts/extract_tokens.js`) to harvest exact computed values:

```javascript
(() => {
  const getComputedTokens = () => {
    const elements = Array.from(document.querySelectorAll('*'));
    const colors = new Set();
    const bgColors = new Set();
    const fonts = new Set();
    const fontSizes = new Set();
    const borderRadii = new Set();

    elements.slice(0, 1000).forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.color && style.color !== 'rgba(0, 0, 0, 0)') colors.add(style.color);
      if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') bgColors.add(style.backgroundColor);
      if (style.fontFamily) fonts.add(style.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
      if (style.fontSize) fontSizes.add(style.fontSize);
      if (style.borderRadius && style.borderRadius !== '0px') borderRadii.add(style.borderRadius);
    });

    return {
      textColors: Array.from(colors).slice(0, 15),
      backgrounds: Array.from(bgColors).slice(0, 15),
      fonts: Array.from(fonts).slice(0, 8),
      fontSizes: Array.from(fontSizes).sort((a,b) => parseFloat(a) - parseFloat(b)),
      borderRadii: Array.from(borderRadii).slice(0, 10),
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  };
  return JSON.stringify(getComputedTokens(), null, 2);
})();
```

---

## 3. Component Hierarchy Decomposition

Deconstruct the target into a 5-tier architectural taxonomy:

| Tier | Component Type | Target Examples (e.g., Amazon) |
| :--- | :--- | :--- |
| **Atoms** | Primitives & controls | Buttons (`#f0c14b`), Badges ("Best Seller", "Prime"), Price Tags, Star Ratings, Inputs, Quantity Selectors |
| **Molecules** | Compound units | Search Bar with category dropdown, Product Card with rating/price/Prime tag, Delivery Estimator line |
| **Organisms** | Functional sections | Global Header with accounts/cart, Hero Carousel with gradient scrim, Faceted Filter Sidebar, Product Detail Buy Box |
| **Templates** | Page shell & layout | Sticky Header + Subnav Banner + Main Grid + Slide-over Drawer + Multi-column Footer |
| **Pages / Views** | Full interactive views | Homepage, Search Results / Catalog, Product Detail Page (PDP), Slide-over Cart Drawer |

---

## 4. Anti-Bot & Obstacle Mitigation Protocol

High-traffic targets (Amazon, Walmart, LinkedIn, Twitter/X) frequently block automated headless browsers with Cloudflare Turnstile, AWS WAF, or PerimeterX. 

When scraping is blocked:
1. **Never stall or fail the task**. Switch immediately to **Synthetic Design System Reconstruction**.
2. **Query Public Documentation & Design Specs**:
   - Amazon: Uses the **AUI (Amazon User Interface)** and Ember design system.
   - Core colors:
     - Dark Navy Header: `#131921` (Nav base), `#232f3e` (Subnav)
     - Accent Yellow/Orange: `#febd69` (Search focus/accent), `#f08804` (CTA hover), `#ffd814` (Buy Now / Cart yellow), `#ffa41c` (Secondary CTA)
     - Price Red/Deal: `#cc0c39` (Deal of the day / discount badge)
     - Background / Page Canvas: `#e3e6e6` (Warm Amazon gray gradient canvas)
     - Text Primary: `#0f1111`
     - Link Accent: `#007185` (Amazon Teal link)
     - Star Rating: `#de7921` / `#ffa41c`
   - Typography: `"Amazon Ember", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
3. **Fetch Open API Schemas or Web Snapshots**:
   - Use `search_web` to inspect publicly indexed product data, UI breakdowns, or open-source clones for verification of DOM patterns.
4. **Synthetic Data Engine**: Generate rich, highly realistic seed records containing realistic product names, ASINs, reviews, prices, Prime badges, discount calculations, and category facets.

---

## 5. Output Deliverable: Target Reconnaissance Report

At the conclusion of Phase 1, the agent must document findings in a structured Reconnaissance Matrix:
- **Target URL / Concept**: URL or PRD definition.
- **Brand Identity & Color Tokens**: Hex codes for header, accents, surfaces, CTAs, alerts.
- **Typography Scale**: Base size, heading steps, font families.
- **Key Interactivity Targets**: List of every interactive widget to implement (e.g., live cart counter, search debounce, filter checkboxes, carousel, Buy Box).
- **Core User Journey**: Exactly which 3-4 connected views/flows will be fully interactive.
