import { IncomingMessage, ServerResponse, request as httpRequest } from 'http';
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
    (upstreamRes) => {
      const chunks: Buffer[] = [];
      upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      upstreamRes.on('end', () => {
        const body = Buffer.concat(chunks);
        const responseHeaders = stripHopByHopHeaders(upstreamRes.headers);
        // Recomputed rather than trusted as-is: the origin's own value may be
        // absent (chunked responses carry no Content-Length) now that we've
        // stripped Transfer-Encoding, or simply stale for any other reason -
        // but since Level 1 buffers the whole body, the true length is free.
        responseHeaders['content-length'] = String(body.length);
        clientRes.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
        clientRes.end(body);
      });
    },
  );

  upstreamReq.on('error', (err) => {
    clientRes.writeHead(502, { 'content-type': 'text/plain' });
    clientRes.end(`Bad gateway: ${err.message}\n`);
  });

  upstreamReq.end();
}
