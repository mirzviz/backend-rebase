-- See ../docs/design.md for the reasoning behind this schema.

CREATE TABLE IF NOT EXISTS page_view_raw (
  id          BIGSERIAL PRIMARY KEY,
  page        TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Speeds up the cleaner's "inserted_at <= cutoff" scan/delete, which
-- otherwise has no index to use and would fall back to a full table scan.
CREATE INDEX IF NOT EXISTS page_view_raw_inserted_at_idx ON page_view_raw (inserted_at);

CREATE TABLE IF NOT EXISTS page_view_hourly (
  page        TEXT NOT NULL,
  hour_bucket TIMESTAMPTZ NOT NULL,
  views       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (page, hour_bucket)
);
