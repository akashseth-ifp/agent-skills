# Archetype: SaaS / marketing landing

**Signals in capture:** a large hero heading with 1–2 CTA buttons, alternating feature sections, logo strips, a pricing table with a monthly/yearly toggle, FAQ accordions, and few repeated "data" items. Examples: stripe, linear, notion, vercel.

**Stack:** vanilla. Fidelity here is mostly typography, spacing and motion, so `visual` scores matter more than features. Set `thresholds.visual` to 0.85.

## Typical pages
home · pricing · one product/feature page. A page that is mostly a long scroll counts as one page with many sections.

## Feature checklist

| id | priority | Steps sketch |
|---|---|---|
| `nav-dropdown-<name>` | must | hover `nav-<name>` → expectVisible `nav-<name>-panel` (one per `states/*.png`) |
| `mobile-nav` | must | viewport mobile → click `nav-toggle` → expectVisible `mobile-nav` → press Escape → expectHidden `mobile-nav` |
| `pricing-toggle` | must | click `billing-yearly` → expectText `plan-pro-price` contains the yearly price |
| `faq-accordion` | should | click `faq-q` (first) → expectVisible `faq-a` (first) |
| `tabs` | should | click `feature-tab` (2nd) → expectText `feature-tab-panel` contains that tab's heading |
| `cta-signup` | should | click `hero-cta` → expectVisible `signup-modal` or expectUrl "#/signup". The form is local only, with no real submit. |
| `logo-marquee` | should | expectCount `logo-item` min 6 |

## Data starter

The data here is the page copy. Take the headings, sub-copy, plan names, prices and FAQ questions **from `capture.json` and `ariaOutline`** (they are real text), then paraphrase. Don't replace them with generic SaaS copy.

```jsonc
"module": "js/data.js", "export": "plans", "count": 3,
"fields": {
  "id": { "type": "string", "required": true },
  "name": { "type": "string", "required": true },
  "monthly": { "type": "number", "min": 0 },
  "yearly": { "type": "number", "min": 0 },
  "features": { "type": "array", "required": true },
  "highlighted": { "type": "boolean" }
},
"rules": ["r.yearly == null || r.monthly == null || r.yearly <= r.monthly * 12"]
```

Also export `faqs`, `logos` and `testimonials` when the target has them.
