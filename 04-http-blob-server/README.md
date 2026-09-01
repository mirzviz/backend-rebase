# HTTP Blob Server

An HTTP server for storing, retrieving, and deleting binary blobs - plus a restricted set of headers - on the local filesystem: `POST /blobs/{id}`, `GET /blobs/{id}`, `DELETE /blobs/{id}`.

Implements **Level 1** (mandatory), **Level 2** (streaming + crash consistency), and **Level 3** (folder sharding), plus the [06-load-balancer](../06-load-balancer/) assignment's optional **auto-registration** (self-announce to a load balancer on startup).

## Approach

- **Framework**: NestJS + Express - allowed explicitly by the assignment, at the cost of real runtime dependencies (unlike the other exercises in this repo, which ship zero `node_modules`).
- **Storage ([`blobs.service.ts`](src/blobs/blobs.service.ts), [`sharding.ts`](src/blobs/sharding.ts))**: each blob is a single file, `<id>.blob`, inside a shard folder computed as `sha256(id).slice(0, 3)`, e.g. `storage/734/hello.txt.blob`. The `id` is used directly as the filename - already restricted to `a-zA-Z0-9._-` - so no separate index is needed anywhere, including for sharding: every read/write/delete recomputes the same shard path from `id` alone.
- **Envelope format ([`envelope.ts`](src/blobs/envelope.ts))**: `<id>.blob` is a 4-byte big-endian length, the UTF-8 metadata JSON (stored headers) that length describes, then the raw payload bytes. A length prefix rather than a delimiter, because the payload is arbitrary binary data that could contain any byte sequence a delimiter might pick - a length is unambiguous no matter what bytes follow, and lets GET seek straight to the payload offset (`fs.createReadStream(path, { start })`) with no scan through the file. One file means one `rename()` commits the whole envelope atomically: unlike an earlier two-file design (`<id>.data` + `<id>.meta.json`), there's no window where a crash lands new data paired with old or missing headers, and no window where a partial failure could roll back the in-memory quota/count reservation while an orphaned data file was already on disk.
- **Sharding math (Level 3 / `MAX_BLOBS_IN_FOLDER`)**: 3 hex digits = 4096 shard folders. At `MAX_BLOBS_TOTAL` = 1,000,000, mean occupancy per folder is ~244, about 48 standard deviations below the 1000 cap under a uniform hash - real-world variance across folders is a non-issue. The prefix length is derived from fixed literals in `sharding.ts`, not from the (env-overridable) `BlobLimits`: since there's no index, changing the bucket count while blobs already exist under the old one would silently orphan them (lookups would recompute a different path and simply not find the file). Shard folders are created lazily on first write (`mkdir(shardDir, { recursive: true })`), not pre-created at startup - matches the existing lazy `mkdir` pattern and avoids cluttering a fresh `storage/` with 4096 empty folders.
- **Headers ([`blobs.controller.ts`](src/blobs/blobs.controller.ts))**: only `Content-Type` and `x-rebase-*` (case-insensitive) are extracted and stored; everything else is dropped before validation or storage.
- **Validation ([`blobs.service.ts`](src/blobs/blobs.service.ts))**: `Content-Length`, payload size, id, and header rules are all enforced in `BlobsService.put()`.
- **Quota & count**: kept as in-memory running totals, seeded once at startup by scanning `storageDir` (the assignment's "warm up" phase) and updated incrementally on every write/delete rather than rescanned per request. Overwrites correctly account for the size they're *replacing*, not just the size they add.
- **Concurrency**: the quota/count check-and-reserve happens as one synchronous step (no `await` inside it), so two concurrent uploads to different ids can never both pass against the same stale number. A failed write rolls its reservation back.
- **New vs. overwrite**: `MAX_BLOBS_TOTAL`/`MAX_DISK_QUOTA` only ever block *new* blobs, never an overwrite of an existing id. Both return `507 Insufficient Storage` (not specified by the assignment).
- **Content-Type on GET**: stored value wins; otherwise inferred from the id via `mime-types`, falling back to `application/octet-stream`.
- **Config ([`config.ts`](src/config.ts))**: every limit is env-var overridable with the assignment's defaults, injected via NestJS DI - lets tests use tiny limits instead of writing gigabytes of data.
- **Streaming**: POST/GET pipe the request/response body directly (`pipeline()`) instead of buffering it in memory, so memory use doesn't scale with blob size.
- **Crash consistency**: uploads are written to a `.tmp/` staging directory (same filesystem as `storage/`, so the commit is an atomic `rename()`) and only take their real name once fully written. A broken upload or a killed process never leaves a partial blob visible; `.tmp/` is excluded from all quota/count scans, and wiped at startup to clear any leftovers from a crash.
- **Auto-registration ([`autoRegistration.ts`](src/autoRegistration.ts))**: optional, opt-in via `MASTER_NODE_ADDRESS`. On startup, after the HTTP server is listening, the process `POST`s `{destination, name}` to the load balancer's `/internal/nodes`. It's fire-and-forget - the blob server is fully usable standalone, so a missing, slow, or misconfigured load balancer never blocks startup or crashes the process. A refused connection or a per-attempt timeout means "the load balancer isn't up yet"; those are retried for `SELF_REGISTRATION_RETRY_SECONDS` (spec: 30) before giving up. A `4xx` (bad payload, or the registration window already closed) is *not* retried - it can't succeed on a repeat. The registration client is a plain async function taking an injectable logger and (in tests) `fetch`, so it's exercised against a throwaway fake load balancer without Nest or real timers.

## Auto-registration

Set `MASTER_NODE_ADDRESS` to have this server announce itself to a running [load balancer](../06-load-balancer/) instead of being registered by hand. All four vars are unused unless `MASTER_NODE_ADDRESS` is set.

| Env var | Default | Notes |
| --- | --- | --- |
| `MASTER_NODE_ADDRESS` | unset | `host:port` of the load balancer's internal API. Setting it turns the feature on. An `http://` prefix is tolerated. |
| `ADVERTISED_HOST` | `localhost` | The host the load balancer should use to reach this server. The load balancer only accepts `a-zA-Z0-9_-` (≤50 chars), so this must be a bare name (`localhost`, a docker service name), never a dotted IP. |
| `NODE_NAME` | unset | Optional `name` for the node. Same character rules as `ADVERTISED_HOST`. |
| `SELF_REGISTRATION_RETRY_SECONDS` | `30` | Total budget for retrying while the load balancer isn't answering. |

The advertised port is always `PORT` (the port the server actually listens on), so it's never configured separately.

```bash
# terminal 1 - the load balancer, 20s registration window
cd 06-load-balancer && PORT=3000 node dist/src/main.js

# terminal 2 - a blob server that registers itself within that window
cd 04-http-blob-server && PORT=4100 MASTER_NODE_ADDRESS=localhost:3000 NODE_NAME=blob-1 node dist/main.js

# terminal 3 - once the window closes, route a blob through the load balancer
curl -X POST localhost:3000/blobs/hello --data-binary 'world'
curl localhost:3000/blobs/hello   # -> world, served from the blob server on :4100
```

## Running it

Requires Node.js >= 18.

```bash
cd 04-http-blob-server
npm install
npm run build
node dist/main.js
```

### Tests

`node:test` against a real NestJS testing module, with a throwaway temp directory per test. Covers the full request/validation surface, streaming behavior, crash consistency, startup warm-up, concurrency safety, and auto-registration (against a fake load balancer: success, retry-then-succeed, per-attempt timeout, give-up after the budget, and no-retry on `4xx`).

```bash
npm test
```

### Docker

Two-stage build: TypeScript compiles in a `build` stage; the runtime stage installs only production dependencies and copies in the compiled `dist/`.

```bash
docker build -t http-blob-server .
docker run --rm -p 3000:3000 -v "$(pwd)/storage:/app/storage" http-blob-server
```

The bind mount is what makes blobs persist across container restarts - the container itself is disposable, `./storage` on the host is not.

## Status / known gaps

- **Upgrading an existing pre-Level-3 `storage/` in place isn't handled.** Blobs written before sharding or the single-file envelope were added sit as flat `<id>.data`/`<id>.meta.json` pairs directly under `storage/`; the warm-up scan now expects every top-level entry (other than `.tmp`) to be a shard folder of `<id>.blob` files, so old-format blobs would neither be found nor counted. Not required by the assignment, and `storage/` is gitignored scratch data in this repo anyway.
- **`507` for quota/count violations is a judgment call** - the assignment doesn't specify a status code for these errors.
