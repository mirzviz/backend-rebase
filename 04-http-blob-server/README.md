# HTTP Blob Server

Solution for the course's HTTP file server assignment: an HTTP server exposing `POST /blobs/{id}`, `GET /blobs/{id}`, and `DELETE /blobs/{id}` for storing/retrieving/deleting binary blobs plus a restricted set of headers, backed by the local filesystem.

This is **Level 1** only (mandatory, no RAM/streaming or crash-consistency constraints). Levels 2 and 3 are not implemented - see Status below.

## Approach

- **Framework**: NestJS + Express, chosen over hand-rolling routing since the assignment explicitly allows an HTTP framework of your choice. This is a deliberate departure from the other exercises in this repo, which stick to zero runtime dependencies - here NestJS and `mime-types` are real runtime dependencies, not just dev-time tools (see the Dockerfile for the trade-off that creates: the runtime image needs `node_modules`, unlike the other exercises' bare-`dist` images).
- **Storage layout ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts))**: each blob is two flat sibling files under `storage/`: `<id>.data` (raw bytes) and `<id>.meta.json` (stored headers as JSON). The blob's `id` is used directly as the filename - since ids are already restricted to `a-zA-Z0-9._-`, they're filesystem-safe as-is, so there's no separate id-to-filename index to build or persist.
- **Header filtering ([`src/blobs/blobs.controller.ts`](src/blobs/blobs.controller.ts))**: only `Content-Type` and any `x-rebase-*` header (matched case-insensitively) are extracted from the incoming request and handed to the service; everything else is dropped before it ever reaches storage or the count/length limit checks.
- **Content-Length / payload size / id / header validation ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts))**: centralized in `BlobsService.put()`, which is the single place that decides whether an upsert is allowed, rather than spreading checks across the controller.
- **Disk quota & blob count ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts))**: recomputed by scanning `storageDir` on every `POST` rather than kept as a running total. Level 1 has no RAM/perf constraint, so this is the simplest thing that's correct at this scope - a cached total rebuilt once at startup (and kept in memory afterward) is the natural Level 2 upgrade once streaming and large blob counts are in play. Overwriting an existing blob correctly subtracts that blob's *old* size before checking the new prospective total, so shrinking an overwrite near the quota isn't incorrectly rejected.
- **`MAX_BLOBS_TOTAL` vs `MAX_DISK_QUOTA`**: neither blocks an overwrite of an *existing* id, only genuinely new blobs, per the spec ("if this is a new blob, total number of blobs should not exceed..."). Both violations return `507 Insufficient Storage` (not specified by the assignment; chosen as the closest standard HTTP status).
- **Content-Type on GET**: if not stored, falls back to inference via the `mime-types` package based on the blob's `id` (e.g. `photo.png` → `image/png`), and to `application/octet-stream` if nothing can be inferred - the latter actually comes for free from Express's own default behavior for `res.send(buffer)`.
- **Config ([`src/config.ts`](src/config.ts))**: every limit is env-var-overridable with defaults matching the assignment's stated constants, and is injected via NestJS DI (`BLOB_CONFIG` token) rather than imported as a singleton - this is what lets tests inject tiny limits (e.g. a 40-byte quota) instead of writing gigabytes of data to exercise the error paths.

## Running it

Requires Node.js >= 18.

```bash
cd 04-http-blob-server
npm install
npm run build
node dist/main.js
```

### Tests

Built with `node:test` (no separate test framework dependency) against a real NestJS testing module and a throwaway temp directory per test, written test-first (each behavior below was red before it was green): basic round-trip, `Content-Length`/payload-size/id validation, header storage rules, upsert + count/quota limits, GET fallback content-type, and DELETE.

```bash
npm test
```

### Docker

Two-stage build: TypeScript compiles in a `build` stage; the runtime stage installs only production dependencies and copies in the compiled `dist/`. Unlike the other exercises here, the runtime image does carry `node_modules` (NestJS/mime-types are real runtime deps for this one).

```bash
docker build -t http-blob-server .
docker run --rm -p 3000:3000 -v "$(pwd)/storage:/app/storage" http-blob-server
```

The bind mount is what makes blobs survive a container restart/rebuild - the container itself is disposable, `./storage` on the host is not. Verified manually against a running container: `POST` (204), `GET` (200, correct body + headers), `DELETE` (204), and `GET` after delete (404).

## Status / known gaps

- **Level 2 (streaming + crash consistency) and Level 3 (folder sharding) are not implemented.** This was a scoped decision for this pass, not an oversight - see the design discussion in this session for how they'd layer on: streaming via `pipeline(req, fs.createWriteStream(...))`, upserts made crash-safe via write-to-temp-then-atomic-rename, and `MAX_BLOBS_IN_FOLDER` via a hash-of-id shard subdirectory.
- **Content-Length is trusted, not cross-checked against actual bytes received.** The declared header value is validated against `MAX_PAYLOAD_LENGTH` and used to reject before storing, but the code doesn't independently verify the actual stream byte count matches it. Hardening that (and failing fast *before* reading the body when the declared length already exceeds the limit) is a natural Level 2 pairing with streaming, since right now the whole body is buffered in memory regardless.
- **507 status code for quota/count violations is a judgment call**, not specified by the assignment - flagging it explicitly rather than presenting it as the one correct answer.
