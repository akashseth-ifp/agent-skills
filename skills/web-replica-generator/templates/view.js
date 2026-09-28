// View for pages: __PAGES__ (owner: __OWNER__; this is scaffold's stub). ctx.route.page says which page is showing,
// ctx.route.params holds its params. Render only into `el`; app.js empties it when another page is active.
import { esc } from '__UI__';

export function render(el, ctx) {
  el.innerHTML = `<h1>${esc(ctx.route.page)}</h1><pre class="stub-params">${esc(JSON.stringify(ctx.route.params))}</pre>`;
}
