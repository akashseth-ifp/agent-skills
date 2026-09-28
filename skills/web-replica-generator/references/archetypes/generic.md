# Archetype: generic (fallback)

Use this pack when no other one fits, for example a news site, social feed, booking site, docs site or portfolio. Borrow individual rows from the other packs where the target has the same widget. For example, a booking site's search-and-results flow follows [ecommerce.md](ecommerce.md), and its date pickers follow [dashboard.md](dashboard.md).

## How to build the spec without a pack

1. **Pages:** one per captured page the user journey passes through.
2. **Features:** one per item in `capture.json → interactive` that changes something visible, plus one per `states/*.png`, plus a `*-persists` feature for any state a user would expect to survive a reload (likes, saved items, preferences).
3. **Data:** the most-repeated `cardGroups` entry is the main entity. Its sample text tells you the fields. For example, a feed post has author, handle, time, body, likes and replies. Add rules that keep counters and timestamps plausible.
4. **Must-haves for every site:** header nav works, mobile nav opens and closes, no overflow at 375 px, and each page route loads with no console errors.

If you notice the same kind of site coming up repeatedly, write a new pack for it in this folder, using the same structure as the others.
