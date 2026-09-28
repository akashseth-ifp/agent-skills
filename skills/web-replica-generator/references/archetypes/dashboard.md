# Archetype: dashboard / admin app

**Signals in capture:** a left sidebar nav, a top bar with search and avatar, KPI tiles, charts, data tables with sorting and pagination, and tabs. The target is often behind a login, so capture only works on a public demo (for example a vendor's demo or template site). Otherwise take the blocked path.

**Stack:** consider **React** here. Dashboards usually have more than 5 views that reuse the same widgets (tile, table, chart card). Put each widget in one component file owned by one Builder, and give the views to other Builders.

## Typical pages
overview (KPIs + charts) · list (table) · detail (record + activity) · settings (forms)

## Feature checklist

| id | priority | Steps sketch |
|---|---|---|
| `sidebar-nav` | must | click `nav-<section>` → expectUrl "#/<section>" → expectVisible `page-title` |
| `sidebar-collapse` | should | click `sidebar-toggle` → expectHidden `css=[data-testid=sidebar] .label` |
| `table-sort` | must | click `th-<col>` → expectText `row-<col>` (first) contains the smallest value |
| `table-filter` | must | fill `table-search` "acme" → expectCount `table-row` max N |
| `pagination` | must | click `page-next` → expectText `page-indicator` contains "2" |
| `row-detail` | should | click `table-row` → expectVisible `detail-panel` |
| `date-range` | should | select `range-select` "7d" → expectText `kpi-revenue` changes (compare with the expected value from data) |
| `settings-persist` | should | click `toggle-dark` → reload → expectVisible `css=html[data-theme=dark]` |

Charts: use inline SVG or `<canvas>` drawn from the data, and give each chart a `data-testid`. Don't add a charting library unless the target's charts can't be matched without one.

## Data starter

Time series and records must be generated together so the numbers agree: KPI totals equal the table sums, and chart points equal the per-day aggregates.

```jsonc
"module": "js/data.js", "export": "records", "count": 120,
"fields": {
  "id": { "type": "string", "required": true },
  "name": { "type": "string", "required": true },
  "status": { "type": "string", "enum": ["…statuses seen in the target…"] },
  "amount": { "type": "number", "min": 0 },
  "createdAt": { "type": "string", "required": true },
  "owner": { "type": "string" }
},
"rules": ["!isNaN(Date.parse(r.createdAt))", "Date.parse(r.createdAt) <= Date.now()"]
```

Also export a `series` array for the charts (a date plus a value per metric), built from `records` so that the totals agree.
