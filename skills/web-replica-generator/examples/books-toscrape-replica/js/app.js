// Renders the active view, empties the others (no duplicate data-testids), keeps the header basket count live.
import * as data from './data.js';
import { store, basketCount } from './store.js';
import { router } from './router.js';
import { render as renderCatalog } from './views/catalog.js';
import { render as renderDetail } from './views/detail.js';
import { render as renderBasket } from './views/basket.js';

const VIEWS = { home: renderCatalog, category: renderCatalog, detail: renderDetail, basket: renderBasket };
const sections = Object.fromEntries([...document.querySelectorAll('[data-view]')].map(el => [el.dataset.view, el]));

function draw() {
  const route = router.current();
  for (const [view, el] of Object.entries(sections)) {
    const active = view === route.view;
    el.hidden = !active;
    if (active) VIEWS[view](el, { route, store, data, router });
    else if (el.firstChild) el.replaceChildren();
  }
  document.querySelector('[data-testid=basket-count]').textContent = basketCount();
}

// Swap any image that fails to load for an inline SVG (the checker still reports the original 404).
const FALLBACK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#f3f3f3"/>' +
  '<rect x="60" y="80" width="180" height="240" rx="4" fill="#d5d9d9"/><path d="M90 130h120M90 160h90" stroke="#b0b5b5" stroke-width="10"/></svg>')}`;
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.src !== FALLBACK) {
    img.src = FALLBACK;
    img.classList.add('img-fallback');
  }
}, true);

router.subscribe(draw);
store.subscribe(draw);
draw();
