# End-to-End Case Study: High-Fidelity Amazon.com Replica

This reference document illustrates an end-to-end execution of the **web-replica-generator** skill targeting `https://www.amazon.com/`.

---

## 1. Phase 1: Target Reconnaissance & Profiling

### Target Profile
- **Target URL**: `https://www.amazon.com/`
- **Archetype**: Global multi-category e-commerce marketplace.
- **Design System Reference**: Amazon User Interface (AUI) / Ember styling.
- **Key Brand Tokens Identified**:
  - Main Header: `#131921`
  - Subnav Bar: `#232f3e`
  - Search Input Border Focus: `#ff9900` / `#e77600` with amber glow
  - Primary CTA ("Add to Cart"): `#ffd814` (hover: `#f7ca00`)
  - Secondary CTA ("Buy Now"): `#ffa41c` (hover: `#fa8900`)
  - Link Teal: `#007185` (hover: `#c7511f`)
  - Deal Badge Red: `#cc0c39`
  - Star Ratings: `#de7921`
  - Canvas Background: `#e3e6e6` to `#ffffff` gradient.

### Scope & Interactive Journey Definition
1. **Global Header & Navigation Shell**:
   - Location selector with postal code tooltip ("Deliver to New York 10001").
   - Integrated search bar with category dropdown (`All Departments`, `Electronics`, `Computers`, etc.) and debounced live search.
   - Account & Lists dropdown preview.
   - Returns & Orders trigger.
   - Interactive Cart icon with real-time numeric badge counter.
   - Secondary navigation strip with "All" hamburger drawer button.
2. **Dynamic Hero Carousel**:
   - Multi-slide banner rotator with slide arrows and bottom gradient mask fading into cards.
3. **Multi-Card Category Showcase Deck**:
   - Quad-cards ("Top categories in tech", "Deals on wireless headphones", "Keep shopping for").
4. **Faceted Catalog Search View**:
   - Filter sidebar with live checkboxes: Brands (Sony, Apple, Bose, Logitech), Prime eligibility toggle, Customer Review rating stars, Price range slider.
   - Real-time product sorting (Featured, Price: Low to High, Price: High to Low, Avg Customer Review).
5. **Product Detail Page (PDP)**:
   - High-res multi-image gallery with thumbnail hover-switching.
   - Dynamic price badge with list price strike-through and percentage savings.
   - Stock availability status ("Only 4 left in stock - order soon").
   - Buy Box with Ships from / Sold by Amazon, delivery countdown timer, quantity selector.
6. **Slide-Over Dynamic Cart Drawer**:
   - Appears immediately upon clicking "Add to Cart".
   - Displays subtotal, free shipping qualifier bar, quantity modification, and item removal with smooth animation.
   - State persisted in `localStorage`.

---

## 2. Phase 2: Technical Architecture

```text
amazon-replica/
├── index.html              # Single-page shell with semantic layout & ARIA dialogs
├── css/
│   ├── tokens.css          # AUI color, typography, spacing, and shadow tokens
│   ├── base.css            # CSS reset, body background gradient, typography rules
│   ├── components.css      # Buttons, badges, star ratings, cards, search bar
│   ├── header.css          # Two-tier Amazon header, location picker, subnav
│   ├── catalog.css         # Faceted sidebar, product grid, deal tags
│   ├── pdp.css             # Product detail layout, gallery, buy box
│   └── drawer.css          # Cart slide-over drawer, overlays, animations
└── js/
    ├── data.js             # 25+ realistic products with rich specs & imagery
    ├── store.js            # Reactive proxy state store with localStorage persistence
    ├── search.js           # Live faceted search, debounce, and filter engine
    ├── router.js           # Hash-based view switcher (home, search, pdp, cart)
    └── app.js              # DOM bindings, event listeners, drawer controls
```

---

## 3. Key Implementation Highlights

### The Amazon Search Bar Component
```html
<form class="nav-search-bar" id="navSearchBar" role="search">
  <div class="nav-search-facade">
    <div class="nav-search-scope">
      <select id="searchCategorySelect" aria-label="Select Category">
        <option value="all">All</option>
        <option value="Electronics">Electronics</option>
        <option value="Computers">Computers</option>
        <option value="Audio">Audio</option>
      </select>
      <span class="nav-scope-arrow"></span>
    </div>
    <input 
      type="text" 
      id="navSearchInput" 
      placeholder="Search Amazon" 
      autocomplete="off" 
      spellcheck="false"
      aria-label="Search Amazon"
    />
    <button type="submit" class="nav-search-submit" aria-label="Submit Search">
      <svg class="search-icon" viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
    </button>
  </div>
</form>
```

### The Buy Box Mechanism
```javascript
function renderBuyBox(product) {
  return `
    <div class="buy-box-card" role="region" aria-label="Purchase Options">
      <div class="buy-box-price">$${product.price.toFixed(2)}</div>
      <div class="buy-box-delivery">
        <span class="prime-free">FREE Prime delivery</span> 
        <span class="delivery-time">${product.deliveryEstimate}</span>
      </div>
      <div class="buy-box-stock ${product.stockCount <= 5 ? 'stock-low' : 'stock-ok'}">
        ${product.stockCount <= 5 ? `Only ${product.stockCount} left in stock - order soon.` : 'In Stock'}
      </div>
      <div class="buy-box-qty">
        <label for="pdpQtySelect">Quantity:</label>
        <select id="pdpQtySelect">
          ${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n}</option>`).join('')}
        </select>
      </div>
      <button class="btn-buy-box btn-cart" id="btnAddToCart" data-id="${product.id}">
        Add to Cart
      </button>
      <button class="btn-buy-box btn-buy-now" id="btnBuyNow" data-id="${product.id}">
        Buy Now
      </button>
      <div class="buy-box-meta">
        <div class="meta-row"><span>Ships from</span><span>Amazon.com</span></div>
        <div class="meta-row"><span>Sold by</span><span>${product.brand} Official</span></div>
        <div class="meta-row"><span>Returns</span><span>Eligible for Return within 30 days</span></div>
      </div>
    </div>
  `;
}
```

---

## 4. Self-Validation & Verification Transcript

During execution, the autonomous agent executes the self-validation cycle:
1. **Server Launch**: Started HTTP server at `http://localhost:5173`. Confirmed HTTP 200.
2. **Programmatic Multi-Layer Audit**: Ran `node scripts/audit_replica.js --dir ./ --url http://localhost:5173`.
   - Verified 28 total product/hero images across `js/data.js` and post-hydration rendered DOM via Headless Chrome.
   - Confirmed 0 duplicate element IDs, 0 empty `src` attributes, and 100% `alt` tag compliance.
3. **Browser Subagent Inspection**:
   - Validated header sticky behavior during page scroll.
   - Tested search bar typing `"Sony"` -> observed catalog results narrowing from 24 items to 3 items.
   - Checked Prime checkbox -> verified non-Prime items hidden.
   - Clicked on `"Sony WH-1000XM5"` -> PDP rendered with thumbnail gallery.
   - Clicked `"Add to Cart"` -> Cart badge transitioned from `0` to `1`; Cart Drawer slid in from right.
   - Reloaded page -> Cart count remained `1`.
4. **Layout Overflow Check**: Executed `scrollWidth <= clientWidth` across 1440px, 768px, and 375px viewports. Result: 0px overflow.
5. **Console Log Audit**: 0 uncaught errors, 0 404 images.
