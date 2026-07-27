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

const VALID_ID = /^[a-zA-Z0-9._-]+$/;

// Staged uploads live in a subdirectory of storageDir (not the OS temp
// dir) so the final commit is a same-filesystem rename, which is what
// keeps it atomic. It's excluded by name everywhere storageDir gets
// scanned, so an in-progress or orphaned upload never counts toward
// quota/blob-count - see listStorageEntries below.
const TMP_DIR_NAME = '.tmp';

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

    const names = await this.listStorageEntries();
    let usage = 0;
    let count = 0;
    for (const name of names) {
      usage += await this.statSize(path.join(this.limits.storageDir, name));
      if (name.endsWith('.data')) {
        count += 1;
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

    const dataPath = this.dataPath(id);
    const metaPath = this.metaPath(id);
    const metaContent = JSON.stringify({ headers });

    const isNewBlob = !(await this.pathExists(dataPath));
    const oldSize = (await this.statSize(dataPath)) + (await this.statSize(metaPath));
    const declaredNewSize = declaredLength + Buffer.byteLength(metaContent);

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
    const tempDataPath = path.join(this.tmpDir(), `${randomUUID()}.data`);
    const tempMetaPath = path.join(this.tmpDir(), `${randomUUID()}.meta.json`);

    try {
      await this.streamToFile(body, tempDataPath);
      await fsp.writeFile(tempMetaPath, metaContent);

      await fsp.mkdir(this.limits.storageDir, { recursive: true });
      // Two renames, not one - a crash landing exactly between them
      // leaves data/headers from different versions. That window is a
      // metadata-only rename (microseconds) sitting after the much
      // larger data-streaming window this try/catch already covers, so
      // it's accepted here rather than closed with a combined envelope
      // file - see the design discussion for the full trade-off.
      await fsp.rename(tempDataPath, dataPath);
      await fsp.rename(tempMetaPath, metaPath);
      // Totals were already reserved above - nothing left to update here.
    } catch (err) {
      await fsp.rm(tempDataPath, { force: true });
      await fsp.rm(tempMetaPath, { force: true });
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

  async getHeaders(id: string): Promise<Record<string, string> | null> {
    if (!(await this.pathExists(this.dataPath(id)))) {
      return null;
    }
    const metaRaw = await fsp.readFile(this.metaPath(id), 'utf8');
    const { headers } = JSON.parse(metaRaw) as { headers: Record<string, string> };
    return headers;
  }

  createReadStream(id: string): fs.ReadStream {
    return fs.createReadStream(this.dataPath(id));
  }

  async remove(id: string): Promise<void> {
    const dataPath = this.dataPath(id);
    const metaPath = this.metaPath(id);
    const existed = await this.pathExists(dataPath);
    const size = existed ? (await this.statSize(dataPath)) + (await this.statSize(metaPath)) : 0;

    await fsp.rm(dataPath, { force: true });
    await fsp.rm(metaPath, { force: true });

    if (existed) {
      this.usageBytes -= size;
      this.blobCount -= 1;
    }
  }

  // Streams the request body straight to disk instead of buffering it in
  // memory first. No independent byte-cap here: validateContentLength
  // already rejected anything over MAX_PAYLOAD_LENGTH before this method
  // is ever called, and Node's HTTP server enforces the declared
  // Content-Length as a hard boundary on what req can ever deliver - so
  // there's no legitimate request that reaches this method carrying more
  // bytes than were already validated. Adding a second check here would
  // be defending against something already proven impossible on the one
  // path that calls this.
  private async streamToFile(body: Readable, dest: string): Promise<void> {
    await pipeline(body, fs.createWriteStream(dest));
  }

  private async listStorageEntries(): Promise<string[]> {
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

  private dataPath(id: string): string {
    return path.join(this.limits.storageDir, `${id}.data`);
  }

  private metaPath(id: string): string {
    return path.join(this.limits.storageDir, `${id}.meta.json`);
  }
}
