# Synthetic Data Engine & State Architecture

A high-fidelity replica cannot feel authentic if it is populated with "Lorem Ipsum" or static dummy text. It must be powered by a deterministic, rich synthetic data layer and a responsive client-side state store.

---

## 1. Production Synthetic Data Schema (E-commerce / Amazon Pattern)

Every item in the catalog must adhere to a realistic data contract:

```typescript
export interface Product {
  id: string;                    // e.g., "B08N5WRWNW"
  title: string;                 // Realistic product name with model specs
  brand: string;                 // "Apple", "Sony", "Logitech", etc.
  category: string;              // "Electronics", "Computers", "Audio"
  subCategory: string;           // "Headphones", "Laptops", etc.
  rating: number;                // e.g., 4.6 (1.0 - 5.0)
  reviewCount: number;           // e.g., 18452
  price: number;                 // e.g., 199.99
  listPrice?: number;            // e.g., 249.99 (original price)
  currency: string;              // "$"
  isPrime: boolean;              // Prime eligible flag
  isBestSeller?: boolean;        // Best seller badge flag
  isAmazonChoice?: boolean;      // "Amazon's Choice" badge
  dealType?: 'LIGHTNING' | 'LIMITED' | 'BEST_DEAL';
  stockCount: number;            // e.g. 14 (triggers "Only 3 left in stock - order soon")
  deliveryEstimate: string;      // "FREE delivery Tomorrow, 2 PM - 6 PM"
  images: {
    primary: string;             // High-res hero product image
    gallery: string[];           // 3-5 multi-angle / lifestyle shots
  };
  features: string[];            // Bullet points ("About this item")
  specifications: Record<string, string>; // { "Connectivity": "Bluetooth 5.3", ... }
}
```

---

## 2. High-Fidelity Deterministic Data Generator

Generate a seed catalog of at least 20-30 varied products across 4-5 categories using curated, verified asset URLs (e.g. Unsplash tech/hardware assets with specific IDs) and robust SVG fallbacks:

```javascript
// Example deterministic seed generator pattern
export const SAMPLE_PRODUCTS: Product[] = [
  {
    id: "B09V3HMZ8B",
    title: "Sony WH-1000XM5 Wireless Industry Leading Noise Canceling Headphones - Black",
    brand: "Sony",
    category: "Electronics",
    subCategory: "Audio & Headphones",
    rating: 4.7,
    reviewCount: 14230,
    price: 348.00,
    listPrice: 399.99,
    currency: "$",
    isPrime: true,
    isBestSeller: true,
    isAmazonChoice: false,
    dealType: "LIMITED",
    stockCount: 8,
    deliveryEstimate: "FREE delivery Tomorrow, by 10 PM. Order within 4 hrs 12 mins",
    images: {
      primary: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80",
      gallery: [
        "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80",
        "https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&q=80",
        "https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&q=80"
      ]
    },
    features: [
      "Two processors and 8 microphones for unprecedented noise cancellation",
      "Auto NC Optimizer automatically optimizes sound based on wearing conditions",
      "Magnificent sound quality with new Integrated Processor V1",
      "Crystal clear hands-free calling with 4 beamforming microphones"
    ],
    specifications: {
      "Model Name": "WH1000XM5/B",
      "Color": "Black",
      "Headphones Form Factor": "Over Ear",
      "Connectivity": "Wireless, Bluetooth 5.2"
    }
  },
  // Add additional products across Laptops, Smart Home, Wearables, Gaming...
];
```

---

## 3. Client-Side Reactive State Store

Implement a lightweight, zero-dependency reactive state manager (using modern vanilla ES Proxy/Events or Zustand/Context if in React):

```javascript
class ReplicaStore {
  constructor() {
    this.state = {
      cart: JSON.parse(localStorage.getItem('replica_cart') || '[]'),
      searchQuery: '',
      selectedCategory: 'all',
      activeFilters: {
        brands: [],
        minPrice: 0,
        maxPrice: Infinity,
        primeOnly: false,
        minRating: 0
      },
      sortBy: 'featured', // 'featured' | 'price-asc' | 'price-desc' | 'rating'
      activeView: 'home',  // 'home' | 'search' | 'pdp' | 'cart'
      activeProduct: null,
      drawerOpen: false,
      deliveryZip: '98101'
    };
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    localStorage.setItem('replica_cart', JSON.stringify(this.state.cart));
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  // Actions
  addToCart(product, quantity = 1) {
    const existing = this.state.cart.find(item => item.product.id === product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.state.cart.push({ product, quantity });
    }
    this.state.drawerOpen = true; // Slide open cart drawer on add
    this.notify();
  }

  updateQuantity(productId, quantity) {
    if (quantity <= 0) {
      this.removeFromCart(productId);
      return;
    }
    const item = this.state.cart.find(i => i.product.id === productId);
    if (item) {
      item.quantity = quantity;
      this.notify();
    }
  }

  removeFromCart(productId) {
    this.state.cart = this.state.cart.filter(i => i.product.id !== productId);
    this.notify();
  }

  getCartCount() {
    return this.state.cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  getCartSubtotal() {
    return this.state.cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  }

  setSearchQuery(q) {
    this.state.searchQuery = q;
    this.state.activeView = 'search';
    this.notify();
  }

  setFilters(filters) {
    this.state.activeFilters = { ...this.state.activeFilters, ...filters };
    this.notify();
  }

  openProduct(product) {
    this.state.activeProduct = product;
    this.state.activeView = 'pdp';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.notify();
  }
}
```

---

## 4. Live Faceted Search & Filtering Engine

The search and filter pipeline must execute instantly with zero latency:

```javascript
export function filterProducts(products, { query, category, filters, sortBy }) {
  return products.filter(product => {
    // 1. Text Query (Title, Brand, Category)
    if (query && query.trim() !== '') {
      const q = query.toLowerCase();
      const matchTitle = product.title.toLowerCase().includes(q);
      const matchBrand = product.brand.toLowerCase().includes(q);
      const matchCat = product.category.toLowerCase().includes(q);
      if (!matchTitle && !matchBrand && !matchCat) return false;
    }

    // 2. Category
    if (category && category !== 'all' && product.category.toLowerCase() !== category.toLowerCase()) {
      return false;
    }

    // 3. Brand Facets
    if (filters.brands && filters.brands.length > 0) {
      if (!filters.brands.includes(product.brand)) return false;
    }

    // 4. Prime Only
    if (filters.primeOnly && !product.isPrime) {
      return false;
    }

    // 5. Min Rating
    if (filters.minRating && product.rating < filters.minRating) {
      return false;
    }

    // 6. Price Range
    if (product.price < filters.minPrice || product.price > filters.maxPrice) {
      return false;
    }

    return true;
  }).sort((a, b) => {
    if (sortBy === 'price-asc') return a.price - b.price;
    if (sortBy === 'price-desc') return b.price - a.price;
    if (sortBy === 'rating') return b.rating - a.rating;
    if (sortBy === 'reviews') return b.reviewCount - a.reviewCount;
    return 0; // 'featured'
  });
}
```
