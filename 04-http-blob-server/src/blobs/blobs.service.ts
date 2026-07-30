import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { BLOB_CONFIG, BlobLimits } from '../config';
import { shardFor } from './sharding';
import { encodeHeaderPrefix, readHeaderPrefix } from './envelope';

const VALID_ID = /^[a-zA-Z0-9._-]+$/;

// Staged uploads live in a subdirectory of storageDir (not the OS temp
// dir) so the final commit is a same-filesystem rename, which is what
// keeps it atomic. It's excluded by name everywhere storageDir gets
// scanned, so an in-progress or orphaned upload never counts toward
// quota/blob-count - see listShardNames below.
const TMP_DIR_NAME = '.tmp';

export interface Blob {
  headers: Record<string, string>;
  stream: fs.ReadStream;
}

@Injectable()
export class BlobsService implements OnModuleInit {
  // Running totals, kept in memory and updated incrementally on every
  // write/delete - see onModuleInit below for why scanning storageDir
  // per-request doesn't scale and this replaced it.
  private usageBytes = 0;
  private blobCount = 0;

  constructor(@Inject(BLOB_CONFIG) private readonly limits: BlobLimits) {}

  // Nest runs this once per process, before the app starts listening
  // (app.listen() only happens after all onModuleInit hooks resolve) -
  // this is the "warm up" phase the assignment calls for. It's the only
  // full directory scan the service ever does; every write/delete after
  // this just adjusts the two numbers below instead of rescanning.
  async onModuleInit(): Promise<void> {
    // Anything left in .tmp/ at startup is guaranteed to be garbage from
    // a process crash mid-upload - a successfully committed upload is
    // always moved OUT of .tmp/ by put()'s rename step, so nothing
    // legitimate is ever still sitting here after a clean shutdown.
    await fsp.rm(this.tmpDir(), { recursive: true, force: true });

    let usage = 0;
    let count = 0;
    for (const shardName of await this.listShardNames()) {
      const shardPath = path.join(this.limits.storageDir, shardName);
      for (const fileName of await fsp.readdir(shardPath)) {
        usage += await this.statSize(path.join(shardPath, fileName));
        if (fileName.endsWith('.blob')) {
          count += 1;
        }
      }
    }
    this.usageBytes = usage;
    this.blobCount = count;
  }

  async put(
    id: string,
    body: Readable,
    headers: Record<string, string>,
    contentLengthHeader: string | undefined,
  ): Promise<void> {
    const declaredLength = this.validateContentLength(contentLengthHeader);
    this.validateId(id);
    this.validateHeaders(headers);

    const blobPath = this.blobPath(id);
    const metaContent = JSON.stringify({ headers });
    const headerPrefix = encodeHeaderPrefix(metaContent);

    const isNewBlob = !(await this.pathExists(blobPath));
    const oldSize = await this.statSize(blobPath);
    const declaredNewSize = headerPrefix.length + declaredLength;

    // Check-and-reserve as one synchronous stretch, with no `await` in
    // between: a concurrent put() for a *different* id can only ever run
    // between two `await`s, never in the middle of one. Since nothing
    // here yields, no other call can read blobCount/usageBytes after we
    // check them but before we update them - closing the exact race
    // where two uploads both pass the check against the same stale
    // number. If the write below ultimately fails, the reservation is
    // rolled back in the catch block.
    if (isNewBlob && this.blobCount >= this.limits.maxBlobsTotal) {
      throw new HttpException('storing this blob would exceed MAX_BLOBS_TOTAL', 507);
    }
    if (this.usageBytes - oldSize + declaredNewSize > this.limits.maxDiskQuota) {
      throw new HttpException('storing this blob would exceed MAX_DISK_QUOTA', 507);
    }
    this.usageBytes += declaredNewSize - oldSize;
    if (isNewBlob) {
      this.blobCount += 1;
    }

    await fsp.mkdir(this.tmpDir(), { recursive: true });
    const tempPath = path.join(this.tmpDir(), `${randomUUID()}.blob`);

    try {
      await this.streamToFile(headerPrefix, body, tempPath);
      await fsp.mkdir(this.shardDir(id), { recursive: true });
      // A single rename commits the whole envelope (headers + payload)
      // atomically - unlike a data-file/meta-file pair, there is no
      // window where a crash can leave new data paired with old or
      // missing headers. It either lands completely or not at all.
      await fsp.rename(tempPath, blobPath);
      // Totals were already reserved above - nothing left to update here.
    } catch (err) {
      await fsp.rm(tempPath, { force: true });
      // The write never actually landed - give back the reservation.
      // This is a fixed-amount correction, not a fresh check-then-act
      // against the current value, so it's safe regardless of what any
      // other concurrent put() has done to these fields in the meantime.
      this.usageBytes -= declaredNewSize - oldSize;
      if (isNewBlob) {
        this.blobCount -= 1;
      }
      throw err;
    }
  }

  async getBlob(id: string): Promise<Blob | null> {
    const blobPath = this.blobPath(id);
    if (!(await this.pathExists(blobPath))) {
      return null;
    }

    const fileHandle = await fsp.open(blobPath, 'r');
    let headers: Record<string, string>;
    let payloadOffset: number;
    try {
      ({ headers, payloadOffset } = await readHeaderPrefix(fileHandle));
    } finally {
      await fileHandle.close();
    }

    return { headers, stream: fs.createReadStream(blobPath, { start: payloadOffset }) };
  }

  async remove(id: string): Promise<void> {
    const blobPath = this.blobPath(id);
    const existed = await this.pathExists(blobPath);
    const size = existed ? await this.statSize(blobPath) : 0;

    await fsp.rm(blobPath, { force: true });

    if (existed) {
      this.usageBytes -= size;
      this.blobCount -= 1;
    }
  }

  // Streams the request body straight to disk instead of buffering it in
  // memory first, right behind the small header prefix written ahead of
  // it. No independent byte-cap on the body here: validateContentLength
  // already rejected anything over MAX_PAYLOAD_LENGTH before this method
  // is ever called, and Node's HTTP server enforces the declared
  // Content-Length as a hard boundary on what req can ever deliver - so
  // there's no legitimate request that reaches this method carrying more
  // bytes than were already validated. Adding a second check here would
  // be defending against something already proven impossible on the one
  // path that calls this.
  private async streamToFile(headerPrefix: Buffer, body: Readable, dest: string): Promise<void> {
    const writeStream = fs.createWriteStream(dest);
    writeStream.write(headerPrefix);
    await pipeline(body, writeStream);
  }

  private async listShardNames(): Promise<string[]> {
    try {
      const names = await fsp.readdir(this.limits.storageDir);
      return names.filter((name) => name !== TMP_DIR_NAME);
    } catch {
      return [];
    }
  }

  private tmpDir(): string {
    return path.join(this.limits.storageDir, TMP_DIR_NAME);
  }

  private async statSize(p: string): Promise<number> {
    try {
      return (await fsp.stat(p)).size;
    } catch {
      return 0;
    }
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private validateContentLength(contentLengthHeader: string | undefined): number {
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
    return contentLength;
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

  // MAX_BLOBS_IN_FOLDER (level 3): blobs are bucketed into a shard folder
  // derived purely from `id`, so every read/write/delete recomputes the
  // same path with no index to maintain. See sharding.ts for why the
  // bucket count is fixed rather than tied to overridable config.
  private shardDir(id: string): string {
    return path.join(this.limits.storageDir, shardFor(id));
  }

  private blobPath(id: string): string {
    return path.join(this.shardDir(id), `${id}.blob`);
  }
}
