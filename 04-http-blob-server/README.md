# HTTP Blob Server

Solution for the course's HTTP file server assignment: an HTTP server exposing `POST /blobs/{id}`, `GET /blobs/{id}`, and `DELETE /blobs/{id}` for storing/retrieving/deleting binary blobs plus a restricted set of headers, backed by the local filesystem.

This covers **Level 1** (mandatory) and **Level 2** (streaming + crash consistency). Level 3 (folder sharding) is not implemented - see Status below.

## Approach

- **Framework**: NestJS + Express, chosen over hand-rolling routing since the assignment explicitly allows an HTTP framework of your choice. This is a deliberate departure from the other exercises in this repo, which stick to zero runtime dependencies - here NestJS and `mime-types` are real runtime dependencies, not just dev-time tools (see the Dockerfile for the trade-off that creates: the runtime image needs `node_modules`, unlike the other exercises' bare-`dist` images).
- **Storage layout ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts))**: each blob is two flat sibling files under `storage/`: `<id>.data` (raw bytes) and `<id>.meta.json` (stored headers as JSON). The blob's `id` is used directly as the filename - since ids are already restricted to `a-zA-Z0-9._-`, they're filesystem-safe as-is, so there's no separate id-to-filename index to build or persist.
- **Header filtering ([`src/blobs/blobs.controller.ts`](src/blobs/blobs.controller.ts))**: only `Content-Type` and any `x-rebase-*` header (matched case-insensitively) are extracted from the incoming request and handed to the service; everything else is dropped before it ever reaches storage or the count/length limit checks.
- **Content-Length / payload size / id / header validation ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts))**: centralized in `BlobsService.put()`, which is the single place that decides whether an upsert is allowed, rather than spreading checks across the controller.
- **Disk quota & blob count ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts))**: kept as running totals in memory (`usageBytes`, `blobCount`), seeded once by a full directory scan in `onModuleInit` - the "warm up" phase the assignment calls for, which Nest runs before the app starts listening - and updated incrementally (`+`/`-`) on every successful write or delete after that. This replaced an earlier version that rescanned the whole directory, including a `stat()` per existing file, on *every single POST* - correct, but O(N) per write against however many blobs already existed, which would have made the server slower with every blob added rather than staying flat. Overwriting an existing blob correctly subtracts that blob's *old* size before adding the new one, so shrinking an overwrite near the quota isn't incorrectly rejected. The quota check itself uses the *declared* `Content-Length`, checked before any streaming starts.
- **Concurrency on `usageBytes`/`blobCount`**: the check against `MAX_BLOBS_TOTAL`/`MAX_DISK_QUOTA` and the reservation of that space happen in one synchronous stretch with no `await` in between, so two concurrent uploads for two *different* ids can never both read the same stale number and both pass - whichever reaches that stretch first commits its reservation before the other's check can run. The reservation happens *before* the slow disk I/O (streaming, renames), optimistically, and gets rolled back in the `catch` block if the write ultimately fails - a rollback is just a fixed-amount correction, not a fresh read-then-decide, so unlike the reservation itself it doesn't need the same protection. An earlier version reserved space only *after* a successful write, which left a real window where two concurrent uploads could both pass the check before either had reserved anything - caught by firing two genuinely concurrent requests (`Promise.all`, not sequential awaits) against a `maxBlobsTotal: 1` server and watching both get `204`.
- **`MAX_BLOBS_TOTAL` vs `MAX_DISK_QUOTA`**: neither blocks an overwrite of an *existing* id, only genuinely new blobs, per the spec ("if this is a new blob, total number of blobs should not exceed..."). Both violations return `507 Insufficient Storage` (not specified by the assignment; chosen as the closest standard HTTP status).
- **Content-Type on GET**: if not stored, falls back to inference via the `mime-types` package based on the blob's `id` (e.g. `photo.png` → `image/png`), and to `application/octet-stream` if nothing can be inferred. This is set explicitly rather than relying on Express's `res.send()` default, since GET now streams the response body directly and never calls `res.send()`.
- **Config ([`src/config.ts`](src/config.ts))**: every limit is env-var-overridable with defaults matching the assignment's stated constants, and is injected via NestJS DI (`BLOB_CONFIG` token) rather than imported as a singleton - this is what lets tests inject tiny limits (e.g. a 40-byte quota) instead of writing gigabytes of data to exercise the error paths.
- **Streaming ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts), [`src/blobs/blobs.controller.ts`](src/blobs/blobs.controller.ts))**: POST pipes the request body (`req` itself, a Readable stream) straight to disk via `pipeline()` instead of buffering it into a `Buffer` first; GET pipes the stored file straight into the response the same way. Memory use stays bounded by the stream's internal buffer size regardless of blob size, rather than scaling with it.
- **Crash consistency ([`src/blobs/blobs.service.ts`](src/blobs/blobs.service.ts))**: uploads are written to a `.tmp/` staging subdirectory *inside* `storageDir` (same filesystem, so the commit step is a genuinely atomic `rename()`) and only renamed into their real `<id>.data`/`<id>.meta.json` names once the full body has streamed successfully. Anything that goes wrong mid-upload - the client disconnects, the payload cap is hit - lands in a `catch` block that deletes the temp files and re-throws; the real files are never touched until the write is known-good. `.tmp/` is excluded by name everywhere `storageDir` gets scanned, so an in-progress or orphaned upload is structurally invisible to the `MAX_DISK_QUOTA`/`MAX_BLOBS_TOTAL` counters - there's no separate "recovery" logic needed, because a half-written upload was never counted in the first place. That covers correctness if the whole *process* dies mid-upload (not just the client disconnecting), but disk hygiene doesn't come for free in that case - a killed process never runs the `catch` block's cleanup, so a crash can leave a genuinely orphaned temp file sitting in `.tmp/` forever (a fresh random name every upload means it will never get overwritten by a later attempt). `onModuleInit` closes that gap by wiping `.tmp/` entirely before it scans - anything still there at startup is, by construction, garbage from an interrupted upload, since a successful one is always moved out by the commit renames. One accepted gap: an overwrite commits via *two* separate renames (data, then headers), not one - a crash landing in the sliver of time between them could leave new data paired with old headers. That window is metadata-only rename work (near-instant) sitting after the much larger data-streaming window this design already protects, so it's left as a known, documented trade-off rather than closed with a combined single-file format - see the design discussion for the alternative.

## Running it

Requires Node.js >= 18.

```bash
cd 04-http-blob-server
npm install
npm run build
node dist/main.js
```

### Tests

Built with `node:test` (no separate test framework dependency) against a real NestJS testing module and a throwaway temp directory per test, written test-first (each behavior below was red before it was green): basic round-trip, `Content-Length`/payload-size/id validation, header storage rules, upsert + count/quota limits, GET fallback content-type, DELETE, proof of actual streaming behavior (a partial temp file is observably on disk mid-upload, before the real file exists), crash consistency (a hard-aborted connection - not a clean disconnect - leaves no partial blob, cleans up its temp files, leaves an in-progress overwrite's original blob untouched, and doesn't corrupt quota/count accounting), warm-up seeding (a fresh instance pointed at a directory populated by a previous run correctly restores `MAX_BLOBS_TOTAL`/`MAX_DISK_QUOTA` accounting from what's actually on disk, and wipes any stale `.tmp/` garbage a crash left behind - the one behavior a fresh empty test directory could never have caught), and concurrency (two genuinely concurrent uploads to different new ids - fired via `Promise.all`, not sequential awaits - can never both slip past `MAX_BLOBS_TOTAL`).

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

- **Level 3 (folder sharding) is not implemented.** Scoped decision, not an oversight - see the design discussion in this session for how it'd layer on: `MAX_BLOBS_IN_FOLDER` via a hash-of-id shard subdirectory, computed the same deterministic way on every read/write/delete so no separate index is needed.
- **The two-rename overwrite window described above** (data and headers commit via separate renames, not one) is the one accepted gap in Level 2's crash consistency - see the Approach section for why it's small enough to leave as-is at this scope.
- **507 status code for quota/count violations is a judgment call**, not specified by the assignment - flagging it explicitly rather than presenting it as the one correct answer.
- **A "Content-Length is trusted, not cross-checked" gap was flagged here in an earlier pass and has since been shown not to be a real gap**: Node's own HTTP server enforces `Content-Length` as protocol-level framing, so the request body stream can never deliver more bytes than declared - verified empirically, not assumed. Combined with the pre-check that already rejects any declared length over `MAX_PAYLOAD_LENGTH` before streaming starts, there's no legitimate way to get more than `MAX_PAYLOAD_LENGTH` bytes into the write path. A defensive byte-counting cap is still in `streamToFile` as cheap insurance, but there's no meaningful test for it, because there's no legitimate request that reaches it.
