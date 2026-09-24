---
name: web-replica-generator
description: >-
  Use this skill to research, architect, generate, and self-validate high-fidelity,
  production-grade interactive web replicas from a target concept or URL (e.g.,
  amazon.com, stripe.com, airbnb.com). Enforces autonomous multi-modal reconnaissance,
  design token extraction, rich synthetic data generation, interactive state engineering,
  and programmatic self-validation with zero console error tolerance.
---

# Web Replica Generator Skill Specification

An autonomous execution protocol instructing an AI coding agent to systematically clone, architect, implement, and self-validate pixel-precise, highly interactive web applications from a target URL or product concept.

---

## 1. Skill Overview & Core Principles

A high-fidelity replica is **not** a static mockup or a generic template. It is a fully responsive, interactive application that captures the aesthetic nuances, design tokens, component hierarchies, state machines, and micro-interactions of the target platform.

### Core Tenets
1. **Zero Generic Defaults**: Never use unstyled inputs, standard browser focus outlines, or unformatted text. Every control must reflect the target’s specific styling.
2. **Zero Missing Assets**: Never leave broken `<img>` tags (`src=""`, `src="#"`, or missing assets). Use high-resolution verified CDN images (Unsplash) or precise inline SVGs.
3. **Deterministic State**: Carts, search filters, modal drawers, and pagination must be powered by a reactive client-side store and persisted in `localStorage`.
4. **Autonomous Self-Validation**: The agent must launch the local dev server, run programmatic layout checks, and inspect the application using a browser subagent before completing the task.

---

## 2. Directory Structure of this Skill

```text
skills/web-replica-generator/
├── SKILL.md                              # This authoritative operational specification
├── scripts/
│   ├── audit_replica.js                  # Automated QA verification script
│   └── extract_tokens.js                 # CSS token and color palette harvester
├── references/
│   ├── reconnaissance-playbook.md        # URL scraping, DOM analysis, and anti-bot bypass
│   ├── design-token-system.md            # CSS variable conventions, typography, and elevation
│   ├── state-and-synthetic-data.md       # Data schemas, mock catalog, and state stores
│   ├── media-and-asset-pipeline.md       # Multi-tier image, video, SVG, and resilience engine
│   └── qa-validation-protocol.md         # 5-gate self-validation and browser testing rules
└── examples/
    └── amazon-clone-walkthrough.md       # Comprehensive case study cloning Amazon.com
```

---

## 3. Autonomous Execution Workflow

The agent must execute the replica workflow in six sequential phases:

```
[Phase 1: Reconnaissance] ➔ [Phase 2: Architecture] ➔ [Phase 3: Design Tokens]
           │
           ▼
[Phase 4: Synthetic Data & State] ➔ [Phase 5: Synthesis] ➔ [Phase 6: Self-Validation]
```

---

### Phase 1: Target Reconnaissance & Research

**Goal**: Extract the target's design system, layout anatomy, interactive widgets, and data contract.

1. **Access Assessment**:
   - Inspect the target URL using `read_url_content` or a headless `curl` request.
   - If blocked by WAF, CAPTCHA, or rate limits (e.g. HTTP 403/429), activate the **Synthetic Design System Reconstruction** protocol described in [reconnaissance-playbook.md](./references/reconnaissance-playbook.md).
2. **Visual & DOM Extraction**:
   - Deploy `browser_subagent` to capture desktop (1440px), tablet (768px), and mobile (375px) views.
   - Harvest computed styles (colors, font families, font sizes, margins, border radii) using `scripts/extract_tokens.js`.
3. **Component Inventory**:
   - Deconstruct the UI into:
     - **Shell & Navigation**: Mega-menus, search bar with category picker, location selector, user profile flyout, cart counter.
     - **Main Content**: Dynamic carousels, category grid cards, product feeds.
     - **Faceted Catalog**: Sidebar filters (brands, price, rating, badges), sort controls.
     - **Detail Views (PDP)**: Multi-angle thumbnail galleries, specs tables, reviews, Buy Box.
     - **Slide-Over Drawers / Overlays**: Shopping cart drawer, mobile navigation drawer.
4. **Deliverable**: Create a concise Reconnaissance Plan artifact documenting colors, fonts, layout grids, and the primary interactive flows.

---

### Phase 2: System Architecture & Technical Stack

**Goal**: Structure a scalable, zero-friction project directory.

1. **Stack Selection**:
   - **Default Modern Modular Architecture**: Clean HTML5, modular CSS (`tokens.css`, `components.css`, `layout.css`), and modern ES modules (`store.js`, `search.js`, `app.js`).
   - If a modern framework is requested or required, initialize via `npx -y vite@latest ./ --template react-ts` or standard tooling.
2. **File Organization**:
   ```text
   replica-project/
   ├── index.html              # Semantic HTML5 shell with ARIA dialogs & landmarks
   ├── css/
   │   ├── tokens.css          # Design tokens (colors, typography, spacing, shadows)
   │   ├── base.css            # Resets, typography, and page container
   │   ├── components.css      # Buttons, badges, star ratings, cards, inputs
   │   ├── header.css          # Multi-tier sticky header, search bar, dropdowns
   │   ├── catalog.css         # Faceted filters, product grid, deal tags
   │   ├── pdp.css             # Product detail view, gallery, buy box
   │   └── drawer.css          # Cart slide-over drawer, backdrop overlays
   └── js/
       ├── data.js             # 25+ rich synthetic records with realistic attributes
       ├── store.js            # Reactive store with localStorage persistence
       ├── search.js           # Instant faceted search, filter, and sort algorithms
       ├── router.js           # Lightweight view/hash switcher (home, search, pdp, cart)
       └── app.js              # DOM bindings, event handlers, micro-interactions
   ```

---

### Phase 3: Design Tokens & Layout Foundations

**Goal**: Establish a pixel-accurate design token foundation before writing component markup.

1. **Establish Tokens**:
   - Define all custom properties in `css/tokens.css` following [design-token-system.md](./references/design-token-system.md).
   - Configure semantic colors, typography scale (`--font-family-sans`, fluid font sizes), 4px/8px spacing grid, multi-layered elevation shadows, and transition curves.
2. **Responsive Grid Foundations**:
   - Establish CSS Grid and Flexbox layouts supporting:
     - Desktop (`1024px` - `1440px+`): Multi-column card grids, sticky sidebar filters.
     - Tablet (`768px` - `1023px`): Collapsed sidebar, 2-3 column grids.
     - Mobile (`320px` - `767px`): Single-column feed, full-width search, slide-in navigation drawer.

---

### Phase 4: Synthetic Data & Reactive State Engine

**Goal**: Populate the application with authentic-feeling data and a responsive state store.

1. **Synthetic Data Engine**:
   - Implement `js/data.js` according to [state-and-synthetic-data.md](./references/state-and-synthetic-data.md).
   - Include at least 20-30 products across 4-5 categories with:
     - Unique IDs (e.g. ASINs).
     - Realistic product titles and brand names.
     - Fractional star ratings (e.g. 4.6) and high review counts.
     - Dual pricing (List Price strikethrough, Current Price, Savings percentage).
     - Status badges ("Best Seller", "Prime", "Limited Time Deal").
     - High-resolution verified image URLs and multi-image galleries (following [media-and-asset-pipeline.md](./references/media-and-asset-pipeline.md)).
2. **Reactive State Store**:
   - Implement `js/store.js` managing:
     - `cart`: Array of `{ product, quantity }` saved to `localStorage`.
     - `searchQuery` and `selectedCategory`.
     - `activeFilters`: Brands array, price range, Prime only, minimum rating.
     - `activeView`: Dynamic switcher between Home, Catalog/Search, and Product Detail.
     - `drawerOpen`: Boolean controlling cart drawer visibility.
3. **Instant Search & Filter Pipeline**:
   - Implement multi-criteria client-side filtering with debounced search input (150ms).

---

### Phase 5: Synthesis & Component Assembly (The Build Loop)

**Goal**: Implement the user interface and bind reactive behaviors.

1. **Global Header & Navigation Shell**:
   - Sticky header with logo, dynamic location selector, category select dropdown, search input, clear button, and search submit button.
   - User account & lists flyout trigger.
   - Interactive cart icon with live counter badge connected to `store.getCartCount()`.
   - Subnav banner with "All" department menu trigger.
2. **Hero Carousel & Showcase Grids**:
   - Multi-slide banner carousel with forward/backward arrow buttons and bottom vertical gradient scrim fading seamlessly into the canvas.
   - Quad-card and single-card product decks ("Deals in Electronics", "Top Categories", "Continue Shopping").
3. **Faceted Search Catalog View**:
   - Interactive sidebar filters with checkboxes for Brand, Prime, Rating, and Price.
   - Real-time catalog re-rendering upon filter toggling.
   - Sort dropdown (Featured, Price: Low to High, Price: High to Low, Customer Reviews).
4. **Product Detail Page (PDP)**:
   - High-fidelity multi-image gallery with hover/click thumbnail switcher.
   - Rating summary with star breakdown popover.
   - Authentic Buy Box with stock indicator ("Only 3 left in stock - order soon"), shipping countdown, quantity dropdown, "Add to Cart", and "Buy Now".
5. **Slide-Over Dynamic Cart Drawer**:
   - Smooth slide-in drawer from the right edge with backdrop blur overlay.
   - Real-time item listing with thumbnail, title, price, quantity increment/decrement buttons, and delete trigger.
   - Running subtotal and simulated checkout button.

---

### Phase 6: Autonomous Multi-Modal Self-Validation & Visual QA

**Goal**: Prove the replica is functional, responsive, and defect-free before declaring completion.

Follow the 5-Gate Validation Protocol in [qa-validation-protocol.md](./references/qa-validation-protocol.md):

1. **Gate 1: Static & Multi-Layer Asset Verification**:
   - Run `node scripts/audit_replica.js --dir ./ --url http://localhost:5173`
   - Validates semantic landmarks, zero duplicate IDs, and audits images across all three layers (static HTML, JS data fixtures in `js/data.js`, and the post-hydration rendered DOM via Headless Chrome). Confirm zero empty `src` or missing assets.
2. **Gate 2: Dev Server Launch**:
   - Start the HTTP server using `run_command` with `IsDaemon=true`:
     ```bash
     npx serve -l 5173 ./ &
     ```
   - Verify HTTP 200 via `curl -s -I http://localhost:5173/`.
3. **Gate 3: Browser Runtime & Console Audit**:
   - Deploy `browser_subagent` to open `http://localhost:5173/`.
   - Inspect console logs: **Zero uncaught exceptions allowed**.
   - Check that all images load (`naturalWidth > 0`).
4. **Gate 4: Viewport Overflow Sweep**:
   - Execute the horizontal scrollbar diagnostic across 1440px, 768px, and 375px.
   - Enforce: `document.documentElement.scrollWidth <= window.innerWidth`.
5. **Gate 5: End-to-End User Flow Execution**:
   - Search for a keyword -> verify catalog narrows.
   - Toggle "Prime" filter -> verify non-Prime items disappear.
   - Open a product -> verify gallery switching works.
   - Click "Add to Cart" -> verify badge updates and drawer slides in.
   - Increase quantity -> verify subtotal recalculates.
   - Reload page -> verify cart persists.

---

## 4. Self-Healing & Troubleshooting Matrix

| Issue Encountered | Root Cause | Automated Resolution |
| :--- | :--- | :--- |
| **HTTP 403 / CAPTCHA on Target URL** | Target blocks automated scrapers (AWS WAF / Cloudflare). | Switch to Section 4 of [reconnaissance-playbook.md](./references/reconnaissance-playbook.md). Reconstruct design system from public specifications and verified design tokens. |
| **Horizontal Scrollbar on Mobile** | Fixed-width element or unconstrained table/image. | Run the overflow diagnostic in Gate 4. Apply `max-width: 100%; box-sizing: border-box; overflow-x: hidden;` to offending containers. |
| **Broken Image Assets** | Unreliable external image CDN or expired links. | Replace broken URLs with curated Unsplash IDs or scalable inline SVGs with product icon glyphs. |
| **Cart Resets on Refresh** | Missing localStorage synchronization. | Bind `store.notify()` to `localStorage.setItem('replica_cart', ...)` on every mutation. |
| **Search Lag or Stutter** | Search re-filtering DOM on every keystroke without debounce. | Wrap the search input event listener in a 150ms debounce timer. |

---

## 5. Verification Checklist for Completion

Before reporting the task as finished, ensure all checklist items are satisfied:

- [ ] Target reconnaissance completed and design tokens cataloged in `tokens.css`.
- [ ] No placeholder dummy text ("Lorem ipsum") or unstyled browser inputs.
- [ ] Responsive layouts verified across Mobile (375px), Tablet (768px), and Desktop (1440px).
- [ ] Interactive user journey (Search -> Filter -> View Details -> Add to Cart -> Modify Cart) fully operational.
- [ ] Persistent state enabled via `localStorage`.
- [ ] Automated audit script (`scripts/audit_replica.js`) executed and passed with 0 errors.
- [ ] Local dev server tested and zero console errors confirmed.
