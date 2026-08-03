# HTTP Proxy

A generic HTTP forward proxy that supports only `GET` requests.

Implements **Level 1** (mandatory). Level 2 (streaming the response instead of buffering it) is not implemented yet.

## Approach

- **Server ([`src/index.ts`](src/index.ts), [`src/proxy.ts`](src/proxy.ts))**: plain Node `http.createServer`, no framework. A forward proxy's request target isn't a path to route on - it's a full destination URL that's different on every request (e.g. `GET http://httpbin.org/uuid HTTP/1.1`, sent because the client's TCP connection is to the proxy, not the destination, so it can't imply one). There's nothing for a router to match against, so `req.url` is parsed directly with `new URL()` to pull out host/port/path.
- **Header forwarding ([`src/headers.ts`](src/headers.ts))**: every header is forwarded except the assignment's fixed list (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`). These describe one specific connection (client↔proxy or proxy↔origin), not the resource being requested, so relaying them onto a different connection is either meaningless or an outright leak - e.g. `proxy-authorization` is the client's credentials for *this proxy*, not for the destination server.
- **Level 1 buffering ([`src/proxy.ts`](src/proxy.ts))**: the whole origin response is collected into memory before replying, matching the assignment's ≤10MB assumption. `content-length` is recomputed from the actual buffered body rather than trusted from the origin - Transfer-Encoding is already stripped by then, and the true length is free once the body is fully buffered.
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

- **Level 2 (streaming) not implemented yet** - the origin response is fully buffered before any bytes go back to the client.
- **HTTPS destinations aren't supported** - no `CONNECT` tunneling, out of scope per the assignment.
