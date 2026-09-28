# Archetype: e-commerce

**Signals in capture:** cardGroups with prices and "Add to cart/basket", a cart/basket icon with a count, search with a category scope, filter sidebars, and star ratings. Examples: amazon, flipkart, walmart, etsy, books.toscrape.

**Stack:** vanilla. It becomes React only when there are more than 5 views, such as account, orders and checkout steps.

## Typical pages
home (merchandised rows) · listing/search (grid + filters + sort) · detail (gallery + buy box) · cart (page or drawer)

## Feature checklist

Keep only the features the target actually shows. Example step shapes and testids:

| id | priority | Steps sketch |
|---|---|---|
| `search` | must | fill `search-input` "headphones" → press Enter → expectCount `product-card` min 1 → expectText `result-count` contains a number |
| `search-empty` | should | fill `search-input` "zzzzqqq" → Enter → expectVisible `empty-state` |
| `category-scope` | should | select `search-scope` a category → Enter → every card is in that category (expectCount on `css=[data-category="X"]`) |
| `filter-facet` | must | click `filter-<facet>-<value>` → expectCount `product-card` fewer than before (`max`) |
| `sort` | should | select `sort-select` "price:asc" → expectText `product-card-price` (first) contains the lowest price |
| `open-detail` | must | click `product-card` → expectUrl "#/product/" → expectVisible `pdp-title` |
| `gallery` | should | click `pdp-thumb` (2nd, via `css=[data-testid=pdp-thumb]:nth-of-type(2)`) → expectVisible `pdp-main-image` |
| `add-to-cart` | must | click `add-to-cart` → expectText `cart-count` contains "1" → expectVisible `cart-drawer` |
| `cart-quantity` | must | … → click `cart-qty-inc` → expectText `cart-subtotal` contains 2× price |
| `cart-remove` | should | … → click `cart-remove` → expectVisible `cart-empty` |
| `cart-persists` | must | add → reload → expectText `cart-count` contains "1" |
| `drawer-escape` | should | open drawer → press Escape → expectHidden `cart-drawer` |
| `menu-<name>` | should | one per `states/*.png`: hover/click trigger → expectVisible the panel |
| `mobile-nav` | should | viewport mobile → click `nav-toggle` → expectVisible `mobile-nav` |

## Data starter

Rename fields to the target's vocabulary. For example, "basket" instead of "cart", or no `prime` on non-Amazon sites.

```jsonc
"fields": {
  "id": { "type": "string", "required": true },
  "title": { "type": "string", "required": true },
  "brand": { "type": "string" },
  "category": { "type": "string", "required": true, "enum": ["…from the target's nav…"] },
  "price": { "type": "number", "required": true, "min": 0 },
  "listPrice": { "type": "number" },
  "rating": { "type": "number", "min": 1, "max": 5 },
  "reviewCount": { "type": "number", "min": 0 },
  "badge": { "type": "string", "enum": ["…badge wording seen in samples…"] },
  "stock": { "type": "number", "min": 0 },
  "image": { "type": "string", "required": true },
  "gallery": { "type": "array" },
  "imageSource": { "type": "string" }
},
"rules": [
  "r.listPrice == null || r.listPrice > r.price",
  "!r.gallery || r.gallery.length >= 2",
  "r.reviewCount === 0 ? r.rating == null : r.rating != null"
]
```

Detail pages need more than the card shows: bullet features, a specs table, and reviews. Generate them in the same style as whatever the detail-page capture shows.
