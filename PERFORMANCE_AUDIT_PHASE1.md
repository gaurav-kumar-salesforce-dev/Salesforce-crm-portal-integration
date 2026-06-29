# Performance Audit - Phase 1

Generated: 2026-06-29

Scope: instrumentation and measurement only. No optimization or architecture changes were implemented.

## Files Modified

- `server.js`
- `src/perf-audit.js`
- `public/perf-audit.js`
- `public/index.html`
- `perf-audit-server-report.json`
- `perf-audit-browser-report.json`

## Collection Notes

- Instrumented API server was run on `http://localhost:3001` to avoid disturbing the existing app on port 3000.
- API lifecycle was measured with an authenticated system administrator token generated locally from the existing user table.
- Browser lifecycle was measured in headless Chrome via Chrome DevTools Protocol.
- Raw reports:
  - `perf-audit-server-report.json`
  - `perf-audit-browser-report.json`

## Bottleneck Ranking

1. `GET /api/portal/me` took `4371.86 ms`.
   - 15 Supabase query awaits were observed.
   - Supabase accumulated timing was `10660.23 ms` across parallel work.
   - Repeated `user_profile_assignments.select(...).maybeSingle` calls dominated the trace.

2. Metadata loading took `2488.26-3205.34 ms` for object fields.
   - `GET /api/Contact/fields`: `3205.34 ms`.
   - `GET /api/Account/fields`: `2488.26 ms`.
   - Slowest metadata event: Salesforce `GET /sobjects/Account/describe` at `1401.68 ms`.

3. Object list loading took `2134.77-2523.89 ms`.
   - `GET /api/Account`: `2523.89 ms`.
   - `GET /api/Contact`: `2134.77 ms`.
   - Salesforce SOQL `/query` was the primary external wait: `1097.68 ms` for Account and `787.52 ms` for Contact.

4. Record open took `1315.10-1831.30 ms`.
   - First Account record: `1831.30 ms`.
   - Return to previous Account record: `1315.10 ms`.
   - Contact record: `1550.12 ms`.

5. Related list loading took `1539.77-1863.57 ms`.
   - Account related list: `1863.57 ms`.
   - Contact related list: `1539.77 ms`.
   - Account related list made 5 Salesforce calls and 3 Supabase queries.

6. Layout JSON loading took about `1040-1241 ms` per request.
   - `/api/portal/layouts/Account`: `1241.12 ms`.
   - `/api/portal/compact-layouts/Account`: `1089.09 ms`.
   - `/api/portal/record-pages/Account`: `1040.10 ms`.

7. Activity and Chatter were lower but still measurable.
   - Account activity: `906.78 ms`.
   - Account chatter: `939.59 ms`.

## Largest Blocking Functions / Frontend Flows

- `switchObject('Contact')`: `4871.10 ms`, 1 blocking request, 205 DOM nodes created.
- `loadData({ forceRefresh: true })`: `3966.30 ms`, 1 blocking request, 62 DOM nodes created and 62 removed.
- `switchObject('Account')`: `3158.30 ms`, 1 blocking request, 221 DOM nodes created.
- `loadData()` during Contact list flow: `2350.80 ms`.
- DOM mutation totals during browser run: 560 nodes created, 203 nodes removed, 17 mutation batches.

Instrumentation limitation: several render helpers are module-scoped in the browser bundle, so direct render counters were not available for every helper. DOM and request timings still captured the visible lifecycle.

## Slowest API Calls

- `/api/portal/me`: `4378.41 ms` client-observed, `4371.86 ms` server-observed.
- `/api/Contact/fields`: `3208.14 ms`.
- `/api/Account`: `2534.03 ms`.
- `/api/Account/fields`: `2492.90 ms`.
- `/api/Contact`: `2150.14 ms`.
- `/api/Account/{id}/related`: `1864.86 ms`.
- `/api/Account/{id}`: `1833.61 ms`.

## Slowest Database Queries

Observed Supabase hotspots:

- `user_profile_assignments.select(profiles(id, is_system_admin)).eq(user_id,...).maybeSingle`
  - Repeated multiple times in `/api/portal/me`.
  - Individual samples around `1012-1127 ms`.
- `users.select(...).eq(id,...).eq(is_active,true).single`
  - `779.55 ms` inside `/api/portal/me`.
- Layout JSON endpoints were Supabase-bound:
  - Layout route group averaged `1120.17 ms`.

## Slowest Salesforce Calls

- `GET /sobjects/Account/describe`: `1401.68 ms`.
- `GET /query` for Account list: `1097.68 ms`.
- `GET /query` for Contact list: `787.52 ms`.
- Account record open accumulated `1289.00 ms` Salesforce time across 4 calls.
- Contact record open accumulated `1290.82 ms` Salesforce time across 5 calls.

## Duplicate Requests

Browser-observed duplicates:

- `GET /api/Contact`: 2-3 times depending on run.
- `GET /api/Contact/listviews`: 2 times in the first browser run.

Likely eliminable candidates to investigate later:

- Duplicate list fetch after object switching and force-refresh sequence.
- Metadata prefetches that coincide with foreground object loads.
- Repeated permission/profile Supabase lookups during `/api/portal/me`.

## Requests Blocking Rendering

Blocking requests observed in the browser:

- `/api/portal/me`: `3749.30 ms`.
- `/api/Contact`: up to `3921.90 ms`.
- `/api/Contact/listviews`: `2501.30 ms`.
- `/api/Account/listviews`: `1825.30 ms`.
- `/api/Case/fields`: `1635.60 ms`.
- `/api/Account`: `1269.40 ms`.

## Rendering Metrics

- First Paint: `68 ms`.
- First Contentful Paint: `68 ms`.
- LCP: `68 ms`, size `5956`.
- Long tasks:
  - First run observed one `51 ms` long task.
  - Second focused browser run observed no long tasks.
- Current JS heap after run:
  - Used heap: `5.63 MB`.
  - Total heap: `22.61 MB`.
  - Heap limit: `4223.40 MB`.

No garbage collection spike was directly exposed by the browser in this run.

## Layout / Loading Analysis

Synchronous or render-blocking candidates:

- `/api/portal/me` blocks initial authenticated page readiness.
- Object switch waits on list view and list data before the page settles.
- Record open waits on record data plus layout JSON, compact layout JSON, record page JSON, component preload, related list, activity, and chatter.
- Related list loading is triggered after detail render but remains part of the user-visible interactive wait in the current flow.
- Chatter and Activity load with the record page when their panels are present.

Potential lazy-load candidates for a later phase:

- Chatter feed.
- Activity timeline.
- Non-visible tab contents.
- Related lists outside the first visible panel.
- Cross-object metadata prefetches that are not needed for the current view.

## Suggested Optimization Roadmap

No implementation in Phase 1. Suggested next-phase investigation order:

1. Reduce `/api/portal/me` repeated Supabase profile/permission work.
2. Review object field metadata loading and describe-call reuse.
3. Split record-open critical path from secondary panels such as related lists, activity, and chatter.
4. Investigate duplicate Contact list/listview requests during object switching.
5. Review layout JSON request strategy and whether three separate layout calls should block record interactivity.
6. Add deeper render-function counters if the frontend bundle is moved to module exports or explicit `window` hooks for audit builds.
7. Add DB-level query labels or Postgres timing if Supabase-side execution detail is needed beyond client await duration.
