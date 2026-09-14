# Design note

Written before any code, per the assignment's own "design your table(s)
first" instruction.

## Constraints this design has to satisfy

- Postgres only, no other datastore.
- No explicit transactions anywhere - only the implicit one-statement
  transaction Postgres gives every individual SQL statement.
- Increment traffic is concurrent and must not lose writes or serialize
  behind lock contention.
- 100% consistency is explicitly *not* required - the assignment allows
  reporting delay/staleness.

## Schema

```sql
page_view_raw (
  id           BIGSERIAL PRIMARY KEY,
  page         TEXT NOT NULL,
  ts           TIMESTAMPTZ NOT NULL,        -- event time; determines the
                                             -- hour bucket a view counts
                                             -- toward
  inserted_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
                                             -- server-assigned; used ONLY
                                             -- by the cleaner to decide
                                             -- what's safe to aggregate
                                             -- (see below) - never used
                                             -- for hour-bucket math
)

page_view_hourly (
  page        TEXT NOT NULL,
  hour_bucket TIMESTAMPTZ NOT NULL,   -- always truncated to the hour
  views       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (page, hour_bucket)
)
```

`id` is a plain `BIGSERIAL`, not a UUID. It is never exposed externally,
this is a single Postgres instance with no sharded or independent
writers, and a monotonic sequence always appends at the rightmost edge of
the primary key's index (good insert locality) at half the storage cost
of a UUID. `id` is *not* used as the cleaner's snapshot boundary (see
below) - here it exists only to make each raw row uniquely addressable.

## Architecture: two tables + a standalone cleaner ("Option B")

The tempting alternative is a single hourly aggregate table, with every
increment doing `INSERT ... ON CONFLICT DO UPDATE SET views = views + 1`
directly against it. That's correct, but it serializes all concurrent
writes to the same page/hour: each increment takes an exclusive row lock
on that one aggregate row, so a popular page under heavy concurrent
traffic turns every increment into a queue.

Option B decouples the two concerns:
- **Ingestion** (`page_view_raw`) is a cheap, lock-free `INSERT` - every
  request appends a new row; nothing is read, nothing is locked against
  another writer's row.
- **Aggregation** (`page_view_hourly`) happens off the write path, in
  batches, by a separate cleaner process.

The cost is a small, explicitly-accepted eventual-consistency window
between when a view is recorded and when it shows up in the hourly
aggregate/report. The assignment explicitly allows this ("consistency is
sometimes not 100%, and we're ok with it"), so trading a bounded staleness
window for lock-free writes is the right trade for this system.

## Increments API

- `POST /page-views/single/` - one `INSERT INTO page_view_raw (page, ts)`.
  No read-before-write, no transaction beyond the statement itself.
  `inserted_at` is left to its `DEFAULT clock_timestamp()` rather than set
  by the application, so the cleaner boundary below stays meaningful.
- `POST /page-views/multi/` - the payload is pre-aggregated *deltas* (a
  client may send multiple batches for the same page/hour across that
  hour's lifetime), so they must accumulate rather than overwrite. This
  goes straight into `page_view_hourly` (it's already aggregated, no
  reason to route it through the raw table) as **one bulk statement**
  covering every page/hour pair in the payload:

  ```sql
  INSERT INTO page_view_hourly (page, hour_bucket, views)
  VALUES (...), (...), ...
  ON CONFLICT (page, hour_bucket)
  DO UPDATE SET views = page_view_hourly.views + EXCLUDED.views;
  ```

## Cleaner service

A separate long-running Node process (its own docker-compose service),
not a cron job and not a DB-native trigger - there's no k8s CronJob
primitive here, OS cron is more infrastructure than this job needs, and a
simple supervised loop is the right shape for "aggregate roughly every 10
seconds forever." It runs a single instance: no advisory lock, no
multi-instance coordination. That's safe only because (a) Docker Compose
stops the old container before starting a replacement on redeploy, and
(b) graceful shutdown (below) guarantees an in-flight cycle finishes
before the process exits, so a fresh cycle never overlaps a dying one.

Each cycle (~every 10s):

1. Pick `cutoff = now() - INTERVAL '5 seconds'` once, in application code,
   and reuse that same value for both steps below.
2. One statement: aggregate `page_view_raw` rows with
   `inserted_at <= cutoff`, grouped by `page` and `date_trunc('hour', ts)`
   (the *event* timestamp, never `inserted_at`), upserted into
   `page_view_hourly` with the same `ON CONFLICT ... DO UPDATE SET views =
   page_view_hourly.views + EXCLUDED.views` accumulation used above.
3. Delete the same `inserted_at <= cutoff` rows from `page_view_raw`, in
   batches (~5000 rows via a subquery-bounded `DELETE ... WHERE id IN
   (SELECT id ... LIMIT 5000)`, since Postgres `DELETE` has no direct
   `LIMIT`), looping until a batch deletes 0 rows.

### Why the boundary is `inserted_at` with a grace period, not `MAX(id)`

A sequence value is assigned when a transaction *starts*, not when it
commits. A slow transaction can therefore claim a smaller `id` than a
fast transaction that starts later but commits first and is already
visible by the time the cleaner takes its snapshot. Bounding by `id`
risks deleting a raw row whose transaction commits *after* the aggregate
step ran but *before* the delete step ran - silently discarding a view
that was never counted (a silent undercount, distinct from the
double-count risk below).

Bounding by `inserted_at` (server-assigned at commit-adjacent time via
`clock_timestamp()`) with a 5-second grace period sidesteps this: any
transaction still in flight when the cutoff is computed is simply too
recent to qualify yet, and gets picked up correctly on a later cycle once
it commits. The grace period only needs to be larger than realistic
transaction latency for a single-statement `INSERT` (milliseconds), so 5
seconds is generous headroom, not a tight tolerance.

### Known, accepted limitation: crash between step 2 and step 3

If the cleaner process crashes after the aggregate upsert (step 2)
commits but before the delete (step 3) commits, the next cycle will
re-aggregate the same raw rows and double-count that batch. This can't be
fixed without a single transaction spanning steps 2 and 3, which the
assignment explicitly disallows. This is a documented tradeoff, not a bug
to engineer around: keeping cycles short and frequent bounds the blast
radius (at most one cycle's worth of rows can be double-counted per
crash), which is an acceptable cost given the assignment's own
consistency allowance.

### Graceful shutdown

On `SIGTERM`, the cleaner stops scheduling new cycles but lets any
in-flight cycle finish before the process exits - a routine
deploy/restart should never abort mid-cycle.

## Report API

- Window: `[floor(now, 1h) - 23h, floor(now, 1h)]`, using the `now` query
  param when given, else server time.
- Zero-fill: `generate_series` over the hour range, `LEFT JOIN`ed to
  `page_view_hourly` for the requested page, so hours with no aggregated
  row yet still come back as `v: 0` instead of being silently omitted.
- `order` (`asc` default / `desc`) and `take` (1-24, clamped) are applied
  in one query: order first, then `LIMIT`, so `take=5&order=desc` returns
  the 5 most recent hours and `take=5&order=asc` returns the 5 oldest.
- `h` is the hour-of-day (0-23) taken in UTC, for a deterministic result
  independent of the server's local timezone.

## No explicit transactions - why every step above is still safe

- Every write endpoint issues exactly one SQL statement. Postgres wraps
  every individual statement in its own implicit transaction, so
  "no explicit transactions" doesn't mean "no atomicity" - it means each
  operation's atomicity boundary is one statement, which every operation
  above is designed to fit inside.
- Concurrent `page_view_raw` inserts never contend with each other (plain
  appends, no shared row).
- Concurrent `page_view_hourly` upserts (from `/page-views/multi/` or the
  cleaner) are safe under Postgres's own `INSERT ... ON CONFLICT` atomicity
  - the row-level lock it takes is a normal, momentary write lock, not a
    cross-statement transaction the assignment disallows.
- The cleaner's aggregate-then-delete is two statements, not one - the
  crash-window limitation above is the explicitly accepted price of not
  wrapping them in a transaction.
