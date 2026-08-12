# Load Balancer

A simplified load balancer that routes blob requests (`POST/GET/DELETE /blobs/{id}`) to a set of backend nodes registered through an internal API, instead of storing anything itself. A "node" is a running instance of [04-http-blob-server](../04-http-blob-server/).

Implements the mandatory parts of the assignment only - no circuit breaker, no auto-registration.

## Approach

- **Framework**: NestJS, matching [04-http-blob-server](../04-http-blob-server/)'s convention in this repo (rather than 01/02/03/05's zero-dependency style) - decorator-based routing and dependency injection instead of hand-rolled path matching and manually threading shared state through every handler.
- **Feature modules ([nodes/](src/nodes/), [blobs/](src/blobs/))**: each feature is a **controller** (HTTP glue: read the request, call the service, translate its result into a response) plus a **service** (business rules only, plain data in and out - no `IncomingMessage`/`ServerResponse` anywhere). Unlike 04, each service here is intentionally the *only* file for its feature's logic - registration-window checks, routing, header-stripping, and upstream forwarding all live in `blobs.service.ts` rather than being split across several one-function files, since that fragmentation made an earlier version of this exercise hard to follow without much benefit.
- **`SharedModule` ([shared/shared.module.ts](src/shared/shared.module.ts))**: `NodesModule` and `BlobsModule` both need the *same* `NodeRegistry` instance - a node registered via `/internal/nodes` has to be visible to `/blobs/*` routing in the same process - so it's provided once here and imported by both, rather than each feature getting its own. Also provides `LB_CONFIG` (mirrors 04's `BLOB_CONFIG` token pattern, overridable in tests) and `REGISTRATION_STARTED_AT` (captured fresh per app/test instance, also overridable - lets a test simulate "the window already closed" by backdating a number instead of waiting on a real timer).
- **Node registry ([nodeRegistry.ts](src/nodeRegistry.ts))**: the registration payload never carries an id - only `destination` and `name` - so a node has no way to say "I'm the same node as before" except by resending the same `destination`. Upsert is therefore keyed by `host:port`: re-registering the same destination updates the existing record's `name` in place and keeps its previously generated id, instead of creating a duplicate entry.
- **Routing (`pickNode` in [blobs.service.ts](src/blobs/blobs.service.ts))**: nodes aren't a replicated cluster - each one only has what was actually POSTed to it - so a later GET/DELETE for a blob id must land on the exact node its POST did, or the blob won't be found. That rules out round-robin or any load-aware strategy; routing has to be a pure function of `(blob id, current node set)`. It sorts registered nodes by id (so the result doesn't depend on registration order) and picks one via `sha256(blobId) mod node count`, mirroring the same id→bucket trick 04 already uses for shard folders.
- **Validation ([validation.ts](src/validation.ts))**: a `zod` schema against the spec's exact rules (`a-zA-Z0-9_-` only, 50-character caps, port 0-65535 inclusive), rather than hand-rolled `if`/`typeof` checks - `safeParse()` returns either the narrowed, validated value or a list of issues, and the first issue's message becomes the `400` response's `errorMessage`. `name: ""`/`null`/missing are all normalized to `null` via `z.preprocess()` before the nullable check, matching the spec's "null and \"\" are equivalent to missing" rule. One consequence worth flagging regardless of validation approach: since dots aren't in the allowed character set, `destination.host` can never be a literal IPv4 address (`127.0.0.1`) or a dotted DNS name (`node1.example.com`) - only bare names like `localhost` or `node-1` validate. Tests register fake nodes as `localhost`, not `127.0.0.1`, for exactly this reason.
- **JSON body parsing ([configureApp.ts](src/configureApp.ts))**: `bodyParser` stays off app-wide, because blob bodies genuinely can't go through it - they're opaque bytes streamed straight to a node, and Express's body-parser would consume that stream before the blobs controller ever saw it. `/internal/nodes` doesn't have that constraint, so it gets `express.json()` scoped to just that route (`type: () => true` so it parses regardless of Content-Type, since the spec never requires clients to send one). `NodesController` then just uses `@Body()` like any normal Nest route. `configureApp()` is a separate function both `main.ts` and the test harness call, since Nest's testing module builds its own application instance rather than running through `main.ts`'s bootstrap - without that, the two could silently drift apart (and did, briefly, while building this). One tradeoff worth knowing: malformed-JSON and over-size-limit (`413`, 100kb cap) responses come back in Nest's own default error shape (`{statusCode, message, error}`), not this API's usual `{errorMessage}` - those two come from `express.json()` itself, not our own validation, and normalizing them would need an exception filter that wasn't worth adding.
- **Registration window**: gated by real elapsed wall-clock time from server startup (`Date.now() - startedAt`), not a request counter. `POST /internal/nodes` returns `403` with the spec's exact rejection message once it's closed (note: `@HttpCode(200)` is needed on success too, since Nest defaults `@Post()` to `201`); `GET /internal/nodes` is never gated. The app-level `/blobs/*` API returns `503` until the window closes, and `503` again afterward if it closed with zero nodes registered.
- **Proxying (`forward` in [blobs.service.ts](src/blobs/blobs.service.ts))**: same technique as [05-http-proxy](../05-http-proxy/) - strip hop-by-hop headers, stream the request/response bodies in both directions via `pipeline()` so memory use doesn't scale with blob size. Needs raw `@Res()` in the controller (Nest's automatic response handling can't stream an unknown-in-advance status/body through). An unreachable node returns `502`; `blobs.controller.ts` uses a trailing `@All(':id')` route (matched only if POST/GET/DELETE don't) to return `405` for any other method.
- **Logging ([logging.ts](src/logging.ts))**: every log call always prints locally (so anyone running the server can see what it's doing without a Logz.io account) and, if `LOGZIO_TOKEN` is set, also ships to Logz.io. Shipping is fire-and-forget and wrapped in a try/catch - a Logz.io outage or misconfiguration degrades to "we lost some log lines," never a broken or slowed-down request. `LOGZIO_TOKEN` is optional at boot; without it the server just runs console-only.

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `REGISTRATION_DURATION_SECONDS` | `20` | Per the assignment spec |
| `LOGZIO_TOKEN` | unset | Logz.io shipping token. Omit to run console-only |
| `LOGZIO_TYPE` | `load-balancer` | |
| `LOGZIO_PROTOCOL` | `https` | |
| `LOGZIO_PORT` | `8071` | |
| `LOGZIO_HOST` | `listener.logz.io` | Override per account region, e.g. `listener-eu.logz.io` |

## Running it

Requires Node.js >= 18.

```bash
cd 06-load-balancer
npm install
cp .env.example .env   # fill in LOGZIO_TOKEN/LOGZIO_HOST if you want Logz.io shipping
npm run build
node dist/src/main.js
```

`main.ts` loads `.env` via `dotenv` before anything else runs. `.env` is gitignored - never commit real values, only `.env.example` (placeholders) is tracked.

### Tests

`src/` holds implementation only, organized by feature (`nodes/`, `blobs/`, `shared/`); `test/` mirrors that layout plus the shared test harness (`testHelpers.ts`). Two layers of coverage:
- **Service tests** (`nodes/nodes.service.test.ts`, `blobs/blobs.service.test.ts`, `registrationWindow.test.ts`) instantiate the `@Injectable()` classes directly with `new` - Nest's DI is metadata, not a requirement - and call the business logic with plain data. No HTTP server, no waiting on real timers.
- **Controller tests** (`nodes/nodes.controller.test.ts`, `blobs/blobs.controller.test.ts`) use `@nestjs/testing`'s `Test.createTestingModule` + `overrideProvider` (same pattern as 04) to spin up the real app on an ephemeral port, plus fake HTTP servers standing in for nodes, exercising the actual request/response cycle end to end. No real network calls to Logz.io.

```bash
npm test
```

## Status / known gaps

- **No circuit breaker.** A node that's down or timing out is retried on every request; there's no per-node failure tracking or cooldown.
- **No auto-registration.** 04-http-blob-server doesn't read `MASTER_NODE_ADDRESS` or self-register; nodes must be registered manually via `POST /internal/nodes` during the registration window.
