// Hash routes -> { view, params }. Views: home, category, detail, basket.
//   ''  '#/'  '#/page/N'                     -> home     { page }
//   '#/category/<slug>'  '.../page/N'         -> category { slug, page }   (slug "books" = all books)
//   '#/book/<id>'                             -> detail   { id }
//   '#/basket'                                -> basket   {}
export const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parse(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = n => Math.max(1, parseInt(n, 10) || 1);
  if (parts[0] === 'page') return { view: 'home', params: { page: page(parts[1]) } };
  if (parts[0] === 'category' && parts[1]) return { view: 'category', params: { slug: parts[1], page: parts[2] === 'page' ? page(parts[3]) : 1 } };
  if (parts[0] === 'book' && parts[1]) return { view: 'detail', params: { id: decodeURIComponent(parts[1]) } };
  if (parts[0] === 'basket') return { view: 'basket', params: {} };
  return { view: 'home', params: { page: 1 } };
}

const listeners = new Set();
let route = parse(location.hash);
window.addEventListener('hashchange', () => {
  route = parse(location.hash);
  window.scrollTo(0, 0);
  listeners.forEach(fn => fn(route));
});

export const router = {
  current: () => route,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  go(hash) { location.hash = hash; }
};
