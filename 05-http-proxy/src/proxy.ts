import { IncomingMessage, ServerResponse, request as httpRequest } from 'http';
import { pipeline } from 'stream/promises';
import { stripHopByHopHeaders } from './headers';

export function handleRequest(clientReq: IncomingMessage, clientRes: ServerResponse): void {
  if (clientReq.method !== 'GET') {
    clientRes.writeHead(405, { 'content-type': 'text/plain' });
    clientRes.end('Only GET requests are supported\n');
    return;
  }

  // A proxy client (curl -x) sends the full destination URL as the request
  // target - e.g. "GET http://httpbin.org/uuid HTTP/1.1" - since the TCP
  // connection is to the proxy, not the destination, so it can't imply one.
  let target: URL;
  try {
    target = new URL(clientReq.url ?? '');
  } catch {
    clientRes.writeHead(400, { 'content-type': 'text/plain' });
    clientRes.end('Expected an absolute URL as the request target\n');
    return;
  }

  if (target.protocol !== 'http:') {
    clientRes.writeHead(502, { 'content-type': 'text/plain' });
    clientRes.end(`Unsupported protocol: ${target.protocol}\n`);
    return;
  }

  const upstreamReq = httpRequest(
    {
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: 'GET',
      headers: stripHopByHopHeaders(clientReq.headers),
    },
    async (upstreamRes) => {
      // Headers are committed as soon as the origin's arrive, before the body
      // is known to have finished - that's what makes streaming possible, but
      // it also means a later origin error can no longer become a clean error
      // status: the client has already been told "200 OK" (or whatever) by then.
      clientRes.writeHead(upstreamRes.statusCode ?? 502, stripHopByHopHeaders(upstreamRes.headers));

      try {
        // Relays chunks as they arrive instead of buffering the whole body,
        // and - unlike a raw .pipe() - tears down both streams if either side
        // errors mid-transfer, instead of leaking a dangling connection.
        await pipeline(upstreamRes, clientRes);
      } catch (err) {
        clientRes.destroy();
      }
    },
  );

  upstreamReq.on('error', (err) => {
    if (clientRes.headersSent) {
      clientRes.destroy();
      return;
    }
    clientRes.writeHead(502, { 'content-type': 'text/plain' });
    clientRes.end(`Bad gateway: ${err.message}\n`);
  });

  upstreamReq.end();
}
