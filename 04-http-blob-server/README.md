# HTTP Blob Server

An HTTP server for storing, retrieving, and deleting binary blobs - plus a restricted set of headers - on the local filesystem: `POST /blobs/{id}`, `GET /blobs/{id}`, `DELETE /blobs/{id}`.

Implements **Level 1** (mandatory) and **Level 2** (streaming + crash consistency). Level 3 (folder sharding) is not implemented - see Status below.

## Approach

- **Framework**: NestJS + Express - allowed explicitly by the assignment, at the cost of real runtime dependencies (unlike the other exercises in this repo, which ship zero `node_modules`).
- **Storage ([`blobs.service.ts`](src/blobs/blobs.service.ts))**: each blob is two sibling files under `storage/`: `<id>.data` (raw bytes) and `<id>.meta.json` (stored headers). The `id` is used directly as the filename - already restricted to `a-zA-Z0-9._-`, so no separate index is needed.
- **Headers ([`blobs.controller.ts`](src/blobs/blobs.controller.ts))**: only `Content-Type` and `x-rebase-*` (case-insensitive) are extracted and stored; everything else is dropped before validation or storage.
- **Validation ([`blobs.service.ts`](src/blobs/blobs.service.ts))**: `Content-Length`, payload size, id, and header rules are all enforced in `BlobsService.put()`.
- **Quota & count**: kept as in-memory running totals, seeded once at startup by scanning `storageDir` (the assignment's "warm up" phase) and updated incrementally on every write/delete rather than rescanned per request. Overwrites correctly account for the size they're *replacing*, not just the size they add.
- **Concurrency**: the quota/count check-and-reserve happens as one synchronous step (no `await` inside it), so two concurrent uploads to different ids can never both pass against the same stale number. A failed write rolls its reservation back.
- **New vs. overwrite**: `MAX_BLOBS_TOTAL`/`MAX_DISK_QUOTA` only ever block *new* blobs, never an overwrite of an existing id. Both return `507 Insufficient Storage` (not specified by the assignment).
- **Content-Type on GET**: stored value wins; otherwise inferred from the id via `mime-types`, falling back to `application/octet-stream`.
- **Config ([`config.ts`](src/config.ts))**: every limit is env-var overridable with the assignment's defaults, injected via NestJS DI - lets tests use tiny limits instead of writing gigabytes of data.
- **Streaming**: POST/GET pipe the request/response body directly (`pipeline()`) instead of buffering it in memory, so memory use doesn't scale with blob size.
- **Crash consistency**: uploads are written to a `.tmp/` staging directory (same filesystem as `storage/`, so the commit is an atomic `rename()`) and only take their real name once fully written. A broken upload or a killed process never leaves a partial blob visible; `.tmp/` is excluded from all quota/count scans, and wiped at startup to clear any leftovers from a crash.

## Running it

Requires Node.js >= 18.

```bash
cd 04-http-blob-server
npm install
npm run build
node dist/main.js
```

### Tests

`node:test` against a real NestJS testing module, with a throwaway temp directory per test. Covers the full request/validation surface, streaming behavior, crash consistency, startup warm-up, and concurrency safety.

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

- **Level 3 (folder sharding) is not implemented.** Would add a hash-of-id shard subdirectory under `MAX_BLOBS_IN_FOLDER`, computed the same deterministic way on every read/write/delete.
- **Overwrites commit via two separate renames** (data, then headers), not one - a crash in the narrow window between them could pair new data with old headers. Accepted trade-off, given that window sits after the much larger data-streaming window this design already protects.
- **`507` for quota/count violations is a judgment call** - the assignment doesn't specify a status code for these errors.
