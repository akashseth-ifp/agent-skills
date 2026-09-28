# Walkthrough: replicating books.toscrape.com (a real v2 run)

> History: these runs used v2 (orchestrator-written foundation, fixed ports). The current workflow is SKILL.md §1. Where a lesson says what SKILL.md or a template "now" says, v2.1 has since replaced it (self-serving checker, scaffold, seed data from minute 0).

This is a full run of the skill against `https://books.toscrape.com/`, a public sandbox store built for scraping practice. The output is in [books-toscrape-replica/](books-toscrape-replica/), including its `spec.json` and final `report.json`. Run it with `npx serve examples/books-toscrape-replica` and open `/`.

## Result

| | |
|---|---|
| Checks | **0 errors**, 5 warnings |
| Features | **14 / 14** passing (9 must, 5 should) |
| Fidelity (avg of 9 page × viewport scores) | **0.856** (0.779 after build → 0.809 → 0.856 after 2 heal rounds) |
| Agents | 6: Analyst, 2 Builders, Data, 2 Fixers. Data and one Fixer were resumed for follow-ups. |
| Wall clock | about 33 min |
| Subagent tokens | about 395k |

| Page | Desktop | Tablet | Mobile |
|---|---|---|---|
| home | 0.879 | 0.859 | 0.825 |
| category | 0.879 | 0.859 | 0.825 |
| detail | 0.915 | 0.866 | 0.795 ⚠ |

**Known gaps (reported, not hidden):**
- Detail on mobile is 0.005 under the 0.8 threshold. The biggest remaining red area is the cover image: a dark mock cover where the target's is mostly white.
- There are axe `color-contrast` warnings on the green prices, green stock text and blue links. Those are the target's own measured colours. Darkening them would pass axe but lower fidelity, so this is a decision for the user.
- The basket has no target screenshot, because the real site's basket doesn't work. Its design follows the site's visual language.

## What happened, step by step

**1. Capture (35 s).** `capture_target.js` followed two links: the "books_1" listing and a detail page. It found 20 product cards with real samples (`A Light in the ...`, `£51.77`, `In stock`), Bootstrap's `rgb(66, 139, 202)` button with a 4px radius, the Helvetica Neue stack, and the 50-item category sidebar.

Amazon was captured the same way for comparison. It returned HTTP 202 and real content (8 card groups, 2 menu states), not a CAPTCHA, so the old "Amazon always blocks, use memorised colours" assumption was wrong.

**2. Spec (Analyst, 2 min).** The spec had an ecommerce archetype, a vanilla stack, 4 pages (home, category, detail, basket), 2 Builder owners, 14 features with `data-testid` steps, a 60-record data schema in GBP / en-GB, and 8 data rules. The orchestrator's review added `imageSource` and fixed the view contract (see lesson 1).

**3. Foundation (orchestrator).**
- `tokens.css` was generated mechanically from `spec.tokens`.
- `base.css` holds the shell and shared atoms: breadcrumb, alert, button, stars, price.
- `store.js` holds the persisted basket and the basket actions.
- `router.js` maps hash routes to `{ view, params }`.
- `app.js` renders the active view, empties the others and installs the image fallback.

**4. Build (3 agents in parallel, about 12 min).** Builder catalog did home and category. Builder detail did detail and basket. The Data agent wrote 60 books, with covers from `find_images.js` (Wikimedia Commons). Each Builder self-checked on its own port, and no file was written by two agents.

**5. Verify.** The first full run reported 21 errors, and every page returned 404. The cause was that another process already held port 5173, and `serve` quietly moved to a different one. The checker now refuses to run unless the URL serves this replica's `index.html` (lesson 2). On a free port the result was 0 errors, 14/14 features, fidelity 0.779, and 3 mobile visual warnings.

**6. Heal.**
- **Round 1 (orchestrator + Data):**
  - The sidebar had 12 categories against the target's 50, making the mobile page about 800px shorter. The spec now lists all 50 measured categories, and the data grew to 105 books so that every category has at least one.
  - Descriptions were about 300 characters against the real site's roughly 1,100, so they were lengthened.
  - The orchestrator's own mobile header CSS had been guessed (a smaller logo, 15px padding). It was re-measured from the mobile screenshot.
  - Fidelity rose from 0.779 to 0.809.
- **Round 2 (2 Fixers in parallel + orchestrator):**
  - The catalog Fixer measured the target's mobile grid (150px columns, 160px cover box, 410px card pitch). Its first attempt dropped desktop from 0.865 to 0.83, which the orchestrator caught; the Fixer then limited the change to screens up to 991px wide. It also rendered the sidebar from `data.categories`, which keeps the target's order.
  - The detail Fixer removed an "Add to basket" button the target doesn't have, and matched the section spacing to within 4px.
  - The orchestrator aligned the mobile header to x=45 and made the footer compact.
  - Fidelity rose from 0.809 to 0.856.
- It stopped after 2 rounds, because the remaining gap is a data choice (cover colour) rather than a layout bug.

## Lessons folded back into the skill

1. **Hidden views leave duplicate `data-testid`s behind.** Home and category share one module, so if both stayed rendered, tests would find hidden cards. The contract is now `render(el, ctx)` for the active view only, and `app.js` empties the other sections (SKILL.md step 3).
2. **Busy ports.** The checker has a preflight, and SKILL.md says to pick a free port and check it.
3. **Favicon 404.** Every page logged a 404 for `/favicon.ico`, which failed the smoke check. The shell now includes `<link rel="icon" href="data:,">`.
4. **The orchestrator's guesses cost the most fidelity.** The biggest early losses came from unmeasured shell CSS and a shortened nav list, not from the Builders. SKILL.md now says to measure the shell at every viewport. The Analyst template says to keep navigation lists at full length, and the Data template says to match text length.
5. **Wikimedia rate limits (HTTP 429).** They affected about 10% of candidate images. The Data agent now pauses between calls, and the media doc explains how to download images locally if 429s appear during checks.
6. **Ambiguous output.** `features:1` meant 100% coverage, but a Fixer read it as "1 feature ran". The checker now prints `features:14/14`.

---

# Second run: amazon.com (2026-09-28)

This run was built into `./amazon-replica` (gitignored). The replica has 4 views (home, search, detail and cart), 69 products and 322 local images totalling 13 MB.

| | |
|---|---|
| Checks | **0 errors**, 4 warnings (visual) |
| Features | **22 / 22** (17 must, 5 should; 7 of them in the orchestrator's shell) |
| Fidelity | **0.711** avg, up from 0.662 after build. Search 0.756 ×3; detail 0.744 / 0.753 / 0.766; home 0.61–0.63 |
| Agents / time | 7 (Analyst, 3 Builders, Data, 2 Fixers), 1 heal round, about 95 min |

**Measured vs reconstructed.** Amazon geolocated the capture machine to India. It showed "Deliver to India", hid most prices, and replaced the buy box with "cannot be shipped". The layout, tokens, header, nav, All drawer, location popover and footer are measured. The prices, buy box, cart page and US ZIP modal are reconstructed in Amazon's measured visual language, and they're listed in `spec.reconstructed`. Amazon did **not** block capture.

**Known gap.** Home scores about 0.62 because the photo content differs. Mock images are used by design, and even switching them to white-background studio shots didn't move the score.

## New lessons folded into the skill

1. **Mobile capture needs a phone user agent.** With a desktop UA at 375px, Amazon served its desktop site, so the "mobile truth" was a cut-off desktop page. `capture_target.js` now uses an iPhone UA with `isMobile` at mobile width.
2. **Lazy loading made the first capture incomplete.** Mobile home had only 5 of its cards when captured, so a faithful replica was penalized. `scrollThrough` now keeps scrolling until the page stops growing. That revealed the mobile home is an endless feed, so it's scored with `visualMaxHeight`. The screenshot cap was raised to 12000px.
3. **Explicit journey URLs.** Auto-picked links landed on side pages such as Amazon Music. Capture now accepts `<home> <listing> <detail>` directly.
4. **`pages[].visualMaxHeight`** scores only the part a replica is meant to match: the top of a product page before the brand's marketing images, or the start of an endless feed.
5. **Sites localize by IP.** Check what was served, reconstruct what's hidden, and declare it in `spec.reconstructed`.
6. **Logos drawn as CSS sprites** are now detected by capture. The aria outline cap was raised from 30k to 120k characters, because the old cap cut Amazon's page off before its later cards.
7. **The Data agent is the critical path.** It took more than 20 minutes to produce anything while all 3 Builders waited. The template now says to ship `data.js` in about 10 minutes, do the image downloads second, and swap the file atomically only after every referenced file exists.
8. **A checker bug:** `expectText` truncated the element's text to 120 characters *before* matching, so long drawers failed. It now matches on the full text.
9. **Shared-atom bugs surface in parallel builds.** Duplicate SVG gradient IDs made stars render empty, and the hidden text in `priceHtml` escaped scroll containers and caused sideways overflow. Both were fixed in the shared files. The Fixer template now forbids compensating for a shared-file problem inside a view: one Fixer had offset the mobile header in the home view, which would have left every other page wrong.
