import { createHash } from 'node:crypto';
import { IncomingHttpHeaders, OutgoingHttpHeaders, IncomingMessage, ServerResponse, request as httpRequest } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { Config } from '../config';
import { Logger } from '../logging';
import { NodeRecord, NodeRegistry } from '../nodeRegistry';
import { isRegistrationOpen } from '../registrationWindow';
import { LB_CONFIG, LOGGER, REGISTRATION_STARTED_AT } from '../shared/shared.module';

export type RouteBlobResult =
  | { kind: 'not-ready' }
  | { kind: 'no-nodes' }
  | { kind: 'routed'; node: NodeRecord };

// These describe one specific connection between two adjacent parties
// (client<->LB, or LB<->node), not the resource being requested -
// forwarding them across a hop changes their meaning or leaks information
// meant for a different party.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function stripHopByHopHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const filtered: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      filtered[name] = value;
    }
  }
  return filtered;
}

// Nodes aren't a replicated cluster - each one only has what was actually
// POSTed to it - so a later GET/DELETE for a blob id must land on the
// exact node its POST did. That rules out round-robin; routing has to be a
// pure function of (blob id, current node set). Sorting by id first makes
// the result independent of registration order, and hashing with sha256
// mirrors the same id -> bucket trick 04-http-blob-server uses for shards.
export function pickNode(nodes: NodeRecord[], blobId: string): NodeRecord | undefined {
  if (nodes.length === 0) return undefined;

  const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const digest = createHash('sha256').update(blobId).digest();
  const index = digest.readUInt32BE(0) % sorted.length;
  return sorted[index];
}

@Injectable()
export class BlobsService {
  constructor(
    private readonly registry: NodeRegistry,
    @Inject(LB_CONFIG) private readonly config: Config,
    @Inject(REGISTRATION_STARTED_AT) private readonly startedAt: number,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  // Plain data in, plain data out - deciding which node a blob id belongs
  // to doesn't need an HTTP request/response to reason about.
  route(blobId: string): RouteBlobResult {
    if (isRegistrationOpen({ startedAt: this.startedAt, registrationDurationSeconds: this.config.registrationDurationSeconds })) {
      return { kind: 'not-ready' };
    }

    const node = pickNode(this.registry.list(), blobId);
    if (!node) {
      return { kind: 'no-nodes' };
    }

    return { kind: 'routed', node };
  }

  // Infrastructure, not a business rule: once a node is chosen, this is
  // "forward the request there and stream the response back," the same
  // technique 05-http-proxy uses.
  forward(req: IncomingMessage, res: ServerResponse, node: NodeRecord, blobId: string, search: string): void {
    const upstreamReq = httpRequest(
      {
        hostname: node.destination.host,
        port: node.destination.port,
        path: `/blobs/${encodeURIComponent(blobId)}${search}`,
        method: req.method,
        headers: stripHopByHopHeaders(req.headers),
      },
      (upstreamRes) => {
        const status = upstreamRes.statusCode ?? 502;
        this.logger.log('info', 'blob request routed', { method: req.method, node: node.id, blobId, status });
        res.writeHead(status, stripHopByHopHeaders(upstreamRes.headers));
        pipeline(upstreamRes, res).catch(() => res.destroy());
      },
    );

    upstreamReq.on('error', (err) => {
      this.logger.log('error', 'upstream node request failed', { node: node.id, blobId, error: String(err) });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ errorMessage: 'bad gateway: the routed node could not be reached' }));
    });

    pipeline(req, upstreamReq).catch(() => {
      // A failed upload from the client, or a failed upstream connection,
      // both surface through upstreamReq's own 'error' listener above.
    });
  }
}
