# Design Token & Aesthetic Architecture System

To achieve "replica fidelity", a web application must move far beyond superficial styling. It requires a rigorous, token-driven CSS architecture that mimics the visual identity, typography rhythm, and micro-interactions of the target platform.

---

## 1. Universal Design Token Architecture (`tokens.css`)

Every replica must establish a centralized CSS custom properties file defining the token hierarchy:

```css
:root {
  /* ==========================================================================
     1. Brand & Semantic Color Tokens
     ========================================================================== */
  --brand-primary: #131921;
  --brand-primary-light: #232f3e;
  --brand-accent: #febd69;
  --brand-accent-hover: #f08804;
  --brand-cta-primary: #ffd814;
  --brand-cta-primary-hover: #f7ca00;
  --brand-cta-secondary: #ffa41c;
  --brand-cta-secondary-hover: #fa8900;
  
  /* Status & Alerts */
  --status-danger: #b12704;
  --status-deal: #cc0c39;
  --status-success: #067d62;
  --status-info: #007185;

  /* Surfaces & Backgrounds */
  --surface-canvas: #eaeded;
  --surface-card: #ffffff;
  --surface-hover: #f7fafa;
  --surface-subtle: #f3f3f3;
  --surface-overlay: rgba(0, 0, 0, 0.65);

  /* Typography Colors */
  --text-primary: #0f1111;
  --text-secondary: #565959;
  --text-muted: #767676;
  --text-link: #007185;
  --text-link-hover: #c7511f;
  --text-inverse: #ffffff;

  /* Borders & Dividers */
  --border-light: #d5d9d9;
  --border-medium: #888c8c;
  --border-focus: #e77600;
  --ring-focus: rgba(228, 121, 17, 0.5);

  /* ==========================================================================
     2. Typography Scales
     ========================================================================== */
  --font-family-sans: "Amazon Ember", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-family-serif: "Bookerly", Georgia, serif;
  --font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --text-2xs: 0.6875rem; /* 11px */
  --text-xs:  0.75rem;   /* 12px */
  --text-sm:  0.875rem;  /* 14px */
  --text-base: 1rem;     /* 16px */
  --text-lg:  1.125rem;  /* 18px */
  --text-xl:  1.25rem;   /* 20px */
  --text-2xl: 1.5rem;    /* 24px */
  --text-3xl: 1.875rem;  /* 30px */
  --text-4xl: 2.25rem;   /* 36px */

  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  --leading-none: 1;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;

  /* ==========================================================================
     3. Spatial Grid & Radius Tokens (4px / 8px scale)
     ========================================================================== */
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.25rem;  /* 20px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-10: 2.5rem;  /* 40px */
  --space-12: 3rem;    /* 48px */

  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* ==========================================================================
     4. Elevation & Multi-layer Shadows
     ========================================================================== */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-card: 0 2px 5px 0 rgba(213, 217, 217, 0.5);
  --shadow-hover: 0 4px 12px 0 rgba(0, 0, 0, 0.12);
  --shadow-dropdown: 0 4px 16px 0 rgba(0, 0, 0, 0.18);
  --shadow-modal: 0 10px 30px 0 rgba(0, 0, 0, 0.3);

  /* ==========================================================================
     5. Transitions & Physics
     ========================================================================== */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-decelerate: cubic-bezier(0.0, 0, 0.2, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
  
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;

  /* ==========================================================================
     6. Z-Index Layering Hierarchy
     ========================================================================== */
  --z-base: 1;
  --z-sticky: 100;
  --z-dropdown: 200;
  --z-overlay: 500;
  --z-drawer: 600;
  --z-modal: 1000;
  --z-toast: 2000;
}
```

---

## 2. Responsive Breakpoint Matrix

The replica layout must respond fluidly across four standardized viewports:

| Viewport | Min Width | Layout Adjustments |
| :--- | :--- | :--- |
| **Mobile (`xs`/`sm`)** | `320px` - `767px` | Search collapses into full-width bar; hamburger drawer takes over; bottom cart bar or sticky header; single-column product feed. |
| **Tablet (`md`)** | `768px` - `1023px` | Category sidebar condenses to filter pills or modal drawer; 2-3 column card grid; compact subnav. |
| **Desktop (`lg`)** | `1024px` - `1439px` | Full multi-tier header (Deliver to, Search, Language, Account & Lists, Orders, Cart); sticky faceted sidebar; 4-column product grid. |
| **Wide Screen (`xl`)** | `1440px+` | Max-width container (`1500px`), centered canvas, 5-6 column product cards, expanded banner carousels. |

---

## 3. High-Polish Aesthetic Rules (Zero-Default Mandate)

To guarantee the replica looks authentic rather than like a cheap student clone:

1. **Input Focus Precision**:
   Never use browser-default blue outlines. Use target-accurate focus rings (e.g., `outline: 2px solid var(--border-focus); box-shadow: 0 0 0 3px var(--ring-focus);`).
2. **Dynamic Shimmer Skeletons**:
   Implement subtle loading animations on images and data cards using CSS linear gradients with animated `background-position`.
3. **Hero Carousels with Soft Gradient Fades**:
   Amazon and modern e-commerce sites use a subtle vertical gradient mask (`linear-gradient(to bottom, rgba(234,237,237,0) 60%, var(--surface-canvas) 100%)`) over hero carousels to seamlessly blend imagery into the product card deck below.
4. **Authentic Micro-Badges**:
   - Best Seller Badge: `#e67a00` or `#c45500` ribbon with clip-path or angled ribbon shape.
   - Prime Badge: Crisp vector SVG with `#00a8e1` checkmark.
   - Star Ratings: Half-star and full-star SVGs with precise fill percentages.
5. **Interactive Depth & Affordance**:
   Buttons must show tangible feedback: hover brightness shift, `:active` slight scale down (`scale(0.98)`), and cursor pointer.
