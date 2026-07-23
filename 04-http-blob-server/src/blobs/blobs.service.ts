import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { BLOB_CONFIG, BlobLimits } from '../config';

export interface StoredBlob {
  data: Buffer;
  headers: Record<string, string>;
}

const VALID_ID = /^[a-zA-Z0-9._-]+$/;

@Injectable()
export class BlobsService {
  constructor(@Inject(BLOB_CONFIG) private readonly limits: BlobLimits) {}

  async put(
    id: string,
    data: Buffer,
    headers: Record<string, string>,
    contentLengthHeader: string | undefined,
  ): Promise<void> {
    this.validateContentLength(contentLengthHeader);
    this.validateId(id);
    this.validateHeaders(headers);

    const dataPath = this.dataPath(id);
    const metaPath = this.metaPath(id);
    const metaContent = JSON.stringify({ headers });

    const isNewBlob = !(await this.pathExists(dataPath));
    if (isNewBlob) {
      const currentCount = await this.countBlobs();
      if (currentCount >= this.limits.maxBlobsTotal) {
        throw new HttpException('storing this blob would exceed MAX_BLOBS_TOTAL', 507);
      }
    }

    const oldSize = (await this.statSize(dataPath)) + (await this.statSize(metaPath));
    const newSize = data.length + Buffer.byteLength(metaContent);
    const currentUsage = await this.currentUsageBytes();
    const prospectiveUsage = currentUsage - oldSize + newSize;
    if (prospectiveUsage > this.limits.maxDiskQuota) {
      throw new HttpException('storing this blob would exceed MAX_DISK_QUOTA', 507);
    }

    await fs.mkdir(this.limits.storageDir, { recursive: true });
    await fs.writeFile(dataPath, data);
    await fs.writeFile(metaPath, metaContent);
  }

  // Level 1 has no RAM/perf constraint, so usage and blob count are just
  // recomputed by scanning storageDir on every write rather than kept as
  // a running total - simplest thing that's correct at this scope. A
  // cached total rebuilt once at startup is the Level 2 upgrade path.
  private async currentUsageBytes(): Promise<number> {
    const names = await this.listStorageEntries();
    let total = 0;
    for (const name of names) {
      total += await this.statSize(path.join(this.limits.storageDir, name));
    }
    return total;
  }

  private async countBlobs(): Promise<number> {
    const names = await this.listStorageEntries();
    return names.filter((name) => name.endsWith('.data')).length;
  }

  private async listStorageEntries(): Promise<string[]> {
    try {
      return await fs.readdir(this.limits.storageDir);
    } catch {
      return [];
    }
  }

  private async statSize(p: string): Promise<number> {
    try {
      return (await fs.stat(p)).size;
    } catch {
      return 0;
    }
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private validateContentLength(contentLengthHeader: string | undefined): void {
    if (contentLengthHeader === undefined) {
      throw new BadRequestException('Content-Length header is required');
    }
    const contentLength = Number(contentLengthHeader);
    if (!Number.isInteger(contentLength) || contentLength < 0) {
      throw new BadRequestException('Content-Length header is invalid');
    }
    if (contentLength > this.limits.maxPayloadLength) {
      throw new PayloadTooLargeException('Payload exceeds MAX_PAYLOAD_LENGTH');
    }
  }

  private validateId(id: string): void {
    if (id.length > this.limits.maxIdLength) {
      throw new BadRequestException('id exceeds MAX_ID_LENGTH');
    }
    if (!VALID_ID.test(id)) {
      throw new BadRequestException('id contains invalid characters');
    }
  }

  private validateHeaders(headers: Record<string, string>): void {
    const entries = Object.entries(headers);
    if (entries.length > this.limits.maxHeaderCount) {
      throw new BadRequestException('stored header count exceeds MAX_HEADER_COUNT');
    }
    for (const [key, value] of entries) {
      if (key.length > this.limits.maxHeaderKeyLength) {
        throw new BadRequestException(`header key exceeds MAX_HEADER_KEY_LENGTH: ${key}`);
      }
      if (value.length > this.limits.maxHeaderValueLength) {
        throw new BadRequestException(`header value exceeds MAX_HEADER_VALUE_LENGTH for key: ${key}`);
      }
    }
  }

  async get(id: string): Promise<StoredBlob | null> {
    let data: Buffer;
    try {
      data = await fs.readFile(this.dataPath(id));
    } catch {
      return null;
    }
    const metaRaw = await fs.readFile(this.metaPath(id), 'utf8');
    const { headers } = JSON.parse(metaRaw) as { headers: Record<string, string> };
    return { data, headers };
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.dataPath(id), { force: true });
    await fs.rm(this.metaPath(id), { force: true });
  }

  private dataPath(id: string): string {
    return path.join(this.limits.storageDir, `${id}.data`);
  }

  private metaPath(id: string): string {
    return path.join(this.limits.storageDir, `${id}.meta.json`);
  }
}
