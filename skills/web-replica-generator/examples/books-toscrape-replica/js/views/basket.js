// Basket: one line per book with qty -/+, remove, and a grand total; empty state otherwise.
import { money, setQty, removeFromBasket } from '../store.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function render(el, { store, data }) {
  const lines = store.get().basket
    .map(l => ({ ...l, book: data.books.find(b => b.id === l.id) }))
    .filter(l => l.book);
  const crumb = `<ul class="breadcrumb" data-testid="breadcrumb"><li><a href="#/">Home</a></li><li class="active">Basket</li></ul><h1>Basket</h1>`;
  if (!lines.length) {
    el.innerHTML = `${crumb}<div class="basket-empty" data-testid="basket-empty"><p>Your basket is empty.</p>
      <a class="btn-primary" href="#/">Continue shopping</a></div>`;
    el.onclick = null;
    return;
  }
  const total = lines.reduce((n, l) => n + l.qty * l.book.price, 0);
  el.innerHTML = `${crumb}
    <table class="basket-table">
      <thead><tr><th scope="col">Item</th><th scope="col">Price</th><th scope="col">Quantity</th><th scope="col">Total</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
      <tbody>${lines.map(({ id, qty, book: b }) => `
        <tr data-testid="basket-line" data-id="${esc(id)}">
          <td class="basket-item"><img src="${esc(b.image)}" alt="${esc(b.title)}" width="45" height="60">
            <a href="#/book/${encodeURIComponent(id)}">${esc(b.title)}</a></td>
          <td class="basket-price" data-label="Price">${money(b.price)}</td>
          <td data-label="Quantity"><div class="qty">
            <button type="button" data-action="dec" data-testid="basket-qty-dec" aria-label="Decrease quantity of ${esc(b.title)}">−</button>
            <span data-testid="basket-qty" aria-live="polite">${qty}</span>
            <button type="button" data-action="inc" data-testid="basket-qty-inc" aria-label="Increase quantity of ${esc(b.title)}">+</button>
          </div></td>
          <td class="basket-subtotal" data-label="Total">${money(qty * b.price)}</td>
          <td><button type="button" class="basket-remove" data-action="remove" data-testid="basket-remove" aria-label="Remove ${esc(b.title)}">Remove</button></td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><th scope="row" colspan="3">Basket total</th><td class="price" data-testid="basket-total" colspan="2">${money(total)}</td></tr></tfoot>
    </table>
    <p class="basket-actions"><a href="#/">Continue shopping</a></p>`;
  el.onclick = e => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const id = t.closest('[data-id]').dataset.id;
    const qty = lines.find(l => l.id === id).qty;
    if (t.dataset.action === 'inc') setQty(id, qty + 1);
    else if (t.dataset.action === 'dec') setQty(id, qty - 1);
    else removeFromBasket(id);
  };
}
