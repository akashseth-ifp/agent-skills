// Book detail: breadcrumb, cover + summary, warning, description, product information table.
import { money } from '../store.js';
import { slug } from '../router.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function render(el, { route, data }) {
  const b = data.books.find(x => x.id === route.params.id);
  if (!b) {
    el.innerHTML = `<ul class="breadcrumb" data-testid="breadcrumb"><li><a href="#/">Home</a></li><li class="active">Not found</li></ul>
      <h1>Book not found</h1><p class="detail-missing">We couldn't find that book. <a href="#/">Back to all books</a></p>`;
    return;
  }
  const stock = `In stock (${b.stock} available)`;
  const rows = [
    ['UPC', b.upc], ['Product Type', 'Books'], ['Price (excl. tax)', money(b.price)], ['Price (incl. tax)', money(b.price)],
    ['Tax', money(0)], ['Availability', stock], ['Number of reviews', b.reviewCount]
  ];
  el.innerHTML = `
    <ul class="breadcrumb" data-testid="breadcrumb">
      <li><a href="#/">Home</a></li>
      <li><a href="#/category/books">Books</a></li>
      <li><a href="#/category/${slug(b.category)}" data-testid="breadcrumb-category">${esc(b.category)}</a></li>
      <li class="active">${esc(b.title)}</li>
    </ul>
    <article class="product_page">
      <div class="product_main">
        <div class="product_cover"><img src="${esc(b.image)}" alt="${esc(b.title)}" width="300" height="400"></div>
        <div class="product_summary">
          <h1 data-testid="book-title">${esc(b.title)}</h1>
          <p class="price price_color" data-testid="book-price">${money(b.price)}</p>
          <p class="instock availability" data-testid="book-stock">${stock}</p>
          <p class="stars" role="img" data-rating="${b.rating}" aria-label="${b.rating} out of 5 stars"></p>
          <hr>
          <div class="alert-warning" role="alert"><strong>Warning!</strong> This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.</div>
        </div>
      </div>
      <h2 class="sub-header">Product Description</h2>
      <p class="product_description">${esc(b.description)}</p>
      <h2 class="sub-header">Product Information</h2>
      <table class="product_info" data-testid="book-info-table">
        ${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${esc(v)}</td></tr>`).join('')}
      </table>
      <hr>
    </article>`;
}
