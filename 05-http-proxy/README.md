# HTTP Proxy

A generic HTTP forward proxy that supports only `GET` requests.

Implements **Level 1** (mandatory) and **Level 2** (streaming the response).

## Approach

- **Server ([`src/index.ts`](src/index.ts), [`src/proxy.ts`](src/proxy.ts))**: plain Node `http.createServer`, no framework. A forward proxy's request target isn't a path to route on - it's a full destination URL that's different on every request (e.g. `GET http://httpbin.org/uuid HTTP/1.1`, sent because the client's TCP connection is to the proxy, not the destination, so it can't imply one). There's nothing for a router to match against, so `req.url` is parsed directly with `new URL()` to pull out host/port/path.
- **Header forwarding ([`src/headers.ts`](src/headers.ts))**: every header is forwarded except the assignment's fixed list (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`). These describe one specific connection (client↔proxy or proxy↔origin), not the resource being requested, so relaying them onto a different connection is either meaningless or an outright leak - e.g. `proxy-authorization` is the client's credentials for *this proxy*, not for the destination server.
- **Streaming ([`src/proxy.ts`](src/proxy.ts))**: the origin's response is piped straight into the client response via `stream/promises`' `pipeline()` - headers are written as soon as the origin's arrive, and body chunks flow through as they're received rather than being buffered in memory first. `content-length` is forwarded as-is from the origin (untouched, since the body isn't transformed); if the origin has none (a chunked response, with `Transfer-Encoding` already stripped), Node falls back to its own chunked framing automatically. `pipeline()` over a raw `.pipe()` also means both streams get torn down if either side errors mid-transfer, instead of leaking a dangling connection. The trade-off: since headers commit before the body is known to have finished, an origin error partway through can no longer become a clean error status - the client's connection is just destroyed at that point.
- **Method restriction**: only `GET` is handled; anything else gets `405`.
- **Errors**: a destination that can't be reached (bad host, connection refused, non-2xx) still gets relayed or turned into `502` - a single failed request doesn't crash the server or hang the client.
- **HTTP only**: only `http://` targets are supported (all the assignment's test URLs are plain HTTP). HTTPS through a forward proxy needs the `CONNECT` tunneling method, a different mechanism the assignment doesn't ask for.

## Running it

Requires Node.js >= 18.

```bash
cd 05-http-proxy
npm install
npm run build
npm start
```

Listens on `127.0.0.1:43210` by default (override with the `PORT` env var).

```bash
curl "http://httpbin.org/uuid" -x 127.0.0.1:43210
curl "http://httpbin.org/image/png" -x 127.0.0.1:43210 -o image.png
```

### Docker

```bash
docker build -t http-proxy .
docker run --rm -p 43210:43210 http-proxy
```

## Status / known gaps

- **HTTPS destinations aren't supported** - no `CONNECT` tunneling, out of scope per the assignment.
