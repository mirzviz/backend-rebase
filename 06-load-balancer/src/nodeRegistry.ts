import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface NodeDestination {
  host: string;
  port: number;
}

export interface NodeRecord {
  id: string;
  destination: NodeDestination;
  name: string | null;
}

// A node has no way to tell the load balancer "I'm the same node as before"
// except by re-sending the same destination - the registration payload
// never carries an id (the LB generates that). So destination is the
// natural upsert key: re-registering the same host:port updates the
// existing record's name in place instead of creating a duplicate entry.
function keyFor(destination: NodeDestination): string {
  return `${destination.host}:${destination.port}`;
}

@Injectable()
export class NodeRegistry {
  private readonly nodes = new Map<string, NodeRecord>();

  upsert(destination: NodeDestination, name: string | null): NodeRecord {
    const key = keyFor(destination);
    const existing = this.nodes.get(key);

    const record: NodeRecord = {
      id: existing?.id ?? randomUUID(),
      destination,
      name,
    };

    this.nodes.set(key, record);
    return record;
  }

  list(): NodeRecord[] {
    return Array.from(this.nodes.values());
  }
}
