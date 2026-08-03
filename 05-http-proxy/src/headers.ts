import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';

/**
 * These describe one specific connection between two adjacent parties
 * (client<->proxy, or proxy<->origin), not the resource being requested -
 * forwarding them across a hop changes their meaning or leaks information
 * meant for a different party (e.g. Proxy-Authorization is the client's
 * credentials for this proxy, not for the origin server).
 */
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
