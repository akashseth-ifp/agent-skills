// Shared state + basket actions (used by catalog, detail and basket views). Basket persists across reloads.
const KEY = 'replica_state_v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    return {};
  }
}

export function createStore(initial, persist = []) {
  let state = { ...initial, ...load() };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      try {
        localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(persist.map(k => [k, state[k]]))));
      } catch { /* private mode / quota: keep working in memory */ }
      listeners.forEach(fn => fn(state));
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

// basket: [{ id, qty }]
export const store = createStore({ basket: [] }, ['basket']);
if (!Array.isArray(store.get().basket)) store.set({ basket: [] });

export function addToBasket(id, qty = 1) {
  store.set(s => {
    const line = s.basket.find(l => l.id === id);
    return { basket: line ? s.basket.map(l => (l.id === id ? { ...l, qty: l.qty + qty } : l)) : [...s.basket, { id, qty }] };
  });
}
export function setQty(id, qty) {
  store.set(s => ({ basket: qty > 0 ? s.basket.map(l => (l.id === id ? { ...l, qty } : l)) : s.basket.filter(l => l.id !== id) }));
}
export const removeFromBasket = id => setQty(id, 0);
export const basketCount = () => store.get().basket.reduce((n, l) => n + l.qty, 0);
export const money = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
