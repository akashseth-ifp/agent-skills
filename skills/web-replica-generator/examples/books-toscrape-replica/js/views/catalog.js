// Home + category listing: breadcrumb, sidebar, result count, warning, 20-card grid, pager.
import { addToBasket, money } from '../store.js';
import { slug } from '../router.js';

const PER_PAGE = 20;
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// Site shows titles cut to 4 words ("A Light in the ...").
const short = t => { const w = t.split(/\s+/); return w.length > 4 ? w.slice(0, 4).join(' ') + ' ...' : t; };

export function render(el, { route, data }) {
  const books = data.books || [];
  const cats = data.categories || [...new Set(books.map(b => b.category))];
  const s = route.view === 'category' ? route.params.slug : null;
  const cat = s && s !== 'books' ? cats.find(c => slug(c) === s) : null;
  const title = s && s !== 'books' ? (cat || 'Category not found') : 'All products';
  const list = s && s !== 'books' ? books.filter(b => b.category === cat) : books;
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const page = Math.min(route.params.page || 1, pages);
  const from = (page - 1) * PER_PAGE;
  const shown = list.slice(from, from + PER_PAGE);
  const base = s ? `#/category/${s}` : '';
  const pageHref = n => (s ? (n === 1 ? base : `${base}/page/${n}`) : (n === 1 ? '#/' : `#/page/${n}`));
  document.title = `${title} | Books to Scrape - Sandbox (replica)`;

  const catLink = (name, sl) => `<a href="#/category/${sl}" data-testid="category-link" data-slug="${sl}"${sl === s ? ' class="active" aria-current="page"' : ''}>${esc(name)}</a>`;

  el.innerHTML = `
    <ul class="breadcrumb" data-testid="breadcrumb">
      <li><a href="#/">Home</a></li>
      ${cat ? `<li><a href="#/category/books">Books</a></li>` : ''}
      <li class="active">${esc(title)}</li>
    </ul>
    <div class="catalog">
      <aside class="catalog-sidebar" data-testid="category-sidebar" aria-label="Categories">
        ${catLink('Books', 'books')}
        <ul>${cats.map(c => `<li>${catLink(c, slug(c))}</li>`).join('')}</ul>
      </aside>
      <div class="catalog-main">
        <h1 class="catalog-title" data-testid="page-title">${esc(title)}</h1>
        <p class="result-count" data-testid="result-count">${list.length
          ? `<strong>${list.length}</strong> results - showing <strong>${from + 1}</strong> to <strong>${from + shown.length}</strong>.`
          : '<strong>0</strong> results.'}</p>
        <div class="alert-warning" role="alert"><strong>Warning!</strong> This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.</div>
        ${shown.length ? `<ol class="book-grid">${shown.map(b => `
          <li class="book-card" data-testid="book-card" data-id="${esc(b.id)}" data-category="${esc(b.category)}">
            <a class="book-cover" href="#/book/${encodeURIComponent(b.id)}" tabindex="-1"><img src="${esc(b.image)}" alt="${esc(b.title)}" loading="lazy" width="120" height="160"></a>
            <p class="stars" data-rating="${b.rating}" data-testid="book-card-rating" role="img" aria-label="${b.rating} out of 5 stars"></p>
            <h3><a href="#/book/${encodeURIComponent(b.id)}" data-testid="book-card-title" title="${esc(b.title)}">${esc(short(b.title))}</a></h3>
            <div class="book-buy">
              <p class="price" data-testid="book-card-price">${money(b.price)}</p>
              <p class="instock">In stock</p>
              <button type="button" class="btn-primary btn-block" data-action="add" data-id="${esc(b.id)}" data-testid="book-card-add">Add to basket</button>
            </div>
          </li>`).join('')}</ol>` : '<p class="catalog-empty">No books in this category yet. <a href="#/">Browse all products</a>.</p>'}
        <nav class="pager" aria-label="Pagination">
          ${page > 1 ? `<a class="pager-btn pager-prev" href="${pageHref(page - 1)}" data-testid="pager-prev">previous</a>` : ''}
          <span class="pager-current" data-testid="pager-current">Page ${page} of ${pages}</span>
          ${page < pages ? `<a class="pager-btn pager-next" href="${pageHref(page + 1)}" data-testid="pager-next">next</a>` : ''}
        </nav>
      </div>
    </div>`;

  el.onclick = e => {
    const t = e.target.closest('[data-action="add"]');
    if (t) addToBasket(t.dataset.id);
  };
}
