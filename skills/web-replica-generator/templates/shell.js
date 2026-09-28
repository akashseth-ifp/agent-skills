// Shell behaviour: header, nav, drawers, popovers, footer (owner: builder:shell; this is scaffold's stub).
// Markup lives in index.html between the shell:header / shell:footer comments; keep the data-replica-note line.
// ctx = { route, store, data, router }.

// Once at start: wire up header search, drawers, popovers.
export function mount(ctx) {}

// After every render (route or store change): cart count, active nav item, search box text.
export function update(ctx) {}
