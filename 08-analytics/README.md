# Analytics (Part 1)

A page-view analytics system: two increment endpoints record raw/aggregated
views, a report endpoint returns the last 24 hours split by round hour, and
a standalone cleaner process folds raw events into hourly aggregates in the
background.

See [docs/design.md](docs/design.md) for the full design writeup - table
design, the two-table + cleaner architecture ("Option B") and why it beats
a single upsert-only aggregate table under concurrent writes, and the
`inserted_at`-vs-`id` snapshot-boundary decision for the cleaner. This
section summarizes it.

## Approach

- **Framework**: NestJS, matching this repo's convention for HTTP-server
  exercises (see [06-load-balancer](../06-load-balancer/)). The cleaner is
  a separate, non-HTTP process and stays plain TypeScript - no framework
  needed for a loop that runs one SQL statement pair every 10 seconds.
- **Two tables, not one** ([migrations/001_init.sql](migrations/001_init.sql)):
  `page_view_raw` is an append-only log every increment writes to
  (lock-free, no contention between concurrent writers); `page_view_hourly`
  is the aggregate the report reads from. A cleaner process folds one into
  the other off the write path. This trades a small, explicitly-accepted
  eventual-consistency window for lock-free writes under concurrent load -
  see design.md for why a direct upsert-per-increment doesn't scale the
  same way.
- **No explicit transactions anywhere**: every write is exactly one SQL
  statement (Postgres's own implicit per-statement transaction is the only
  atomicity this system uses), per the assignment's restriction. The one
  place this has a real cost is the cleaner's aggregate-then-delete, which
  is two statements - see "Known limitations" below.
- **Increments** ([src/page-views/](src/page-views/)): `single` does one
  `INSERT`; `multi` does one bulk `INSERT ... ON CONFLICT DO UPDATE SET
  views = views + EXCLUDED.views` for the whole payload, since multi's
  values are deltas that must accumulate across repeated batches for the
  same page/hour, not overwrite.
- **Cleaner** ([src/cleaner/](src/cleaner/)): a supervised loop (its own
  docker-compose service, not a cron job or DB trigger), not a request
  path. Every ~10s it aggregates `page_view_raw` rows with `inserted_at <=
  now() - 5s` into `page_view_hourly`, then deletes those same rows in
  ~5000-row batches. The boundary is `inserted_at` with a grace period,
  not `id` - a `BIGSERIAL` is assigned when a transaction *starts*, not
  when it commits, so bounding by id risks deleting a row whose slow
  transaction commits after the aggregate step ran but before the delete
  did, silently undercounting it. `inserted_at`'s grace period sidesteps
  that: anything still in flight when the cutoff is taken just isn't old
  enough yet, and gets picked up on the next cycle. Single instance, no
  advisory lock - safe only because Compose stops the old container before
  starting a new one, and graceful `SIGTERM` handling lets an in-flight
  cycle finish before the process exits.
- **Report** ([src/report/](src/report/)): one query per request -
  `generate_series` over the 24-hour window `LEFT JOIN`ed to
  `page_view_hourly`, so hours with nothing aggregated yet come back as
  `v: 0` instead of being silently dropped. `order`/`take` are applied in
  that same query (`ORDER BY ... LIMIT`), so `take` is always "after
  ordering" as required - `take=5&order=desc` is the 5 most recent hours,
  `take=5&order=asc` is the 5 oldest in the window. `h` is the UTC
  hour-of-day, for a result independent of the server's local timezone.
- **Validation** ([src/page-views/validation.ts](src/page-views/validation.ts),
  [src/report/validation.ts](src/report/validation.ts)): `zod` schemas
  rather than hand-rolled checks, matching this repo's convention once
  real dependencies are already in play (see
  [04-http-blob-server](../04-http-blob-server/)). Errors come back as
  `{errorMessage}` with `400`, mirroring 06's shape.

## Known limitations (accepted tradeoffs, not bugs)

- **Crash between the cleaner's aggregate and delete steps** re-aggregates
  (double-counts) that batch on the next cycle. Fixing it needs a
  transaction spanning both statements, which the assignment disallows.
  Frequent, short cycles bound the blast radius to at most one cycle's
  rows per crash - see design.md for the full reasoning.
- **Report staleness**: a view only shows up in `/report` once the cleaner
  has processed it - up to roughly 15 seconds after the fact (10s cycle
  interval + 5s grace period), by design (the assignment explicitly allows
  imperfect consistency).

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | api only |
| `DATABASE_URL` | *(required)* | e.g. `postgres://postgres:postgres@db:5432/analytics` |

## Running it

Requires Docker and Docker Compose.

```bash
cd 08-analytics
docker compose up --build
```

This starts Postgres, the api (`POST /page-views/single/`,
`POST /page-views/multi/`, `GET /report/:page`) on `http://localhost:3000`,
and the cleaner loop. Schema migrations ([migrations/](migrations/)) run
automatically on boot for both the api and the cleaner, so no separate
migration step is needed.

### Running without Docker

```bash
cd 08-analytics
npm install
cp .env.example .env   # point DATABASE_URL at a Postgres you started yourself
npm run build
npm start               # api
npm run start:cleaner   # cleaner, in a separate terminal
```

### Tests

Tests run against a real Postgres (the same `db` service docker-compose
defines - a mocked database would test nothing meaningful here, since the
logic under test *is* the SQL: `ON CONFLICT` accumulation,
`generate_series` zero-fill, batched deletes). Every test picks its own
random page name instead of resetting tables between tests, so the suite
runs safely against a shared, never-truncated database - including
concurrently with itself.

```bash
docker compose up -d db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/analytics npm test
```

(`DATABASE_URL` defaults to that same value in [test/testHelpers.ts](test/testHelpers.ts)
if unset, so plain `npm test` works too as long as `db` is reachable on
`localhost:5432`.)

Coverage: increments (single happy path, N concurrent requests to the same
page landing as N rows, multi accumulation across repeated batches,
multi-page/multi-hour payloads), report (zero-fill, midnight rollover,
`order`, `take` clamping including out-of-range values), and the cleaner
(multi-row aggregation, batched delete boundaries, an "in-flight" row
correctly excluded by `inserted_at` regardless of its event time or
insertion order, and a repeated cycle being a no-op).
