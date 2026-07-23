import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { Request, Response } from 'express';
import * as mime from 'mime-types';
import { BlobsService } from './blobs.service';

// Per the spec: only Content-Type and any x-rebase-* header get persisted,
// matched case-insensitively. Node already lowercases incoming header
// names, so this doubles as the lowercase form we store and return.
function extractStorableHeaders(raw: IncomingHttpHeaders): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'content-type' || lowerKey.startsWith('x-rebase-')) {
      stored[lowerKey] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return stored;
}

@Controller('blobs')
export class BlobsController {
  constructor(private readonly blobs: BlobsService) {}

  @Post(':id')
  @HttpCode(204)
  async upsert(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const data = Buffer.concat(chunks);
    const headers = extractStorableHeaders(req.headers);
    await this.blobs.put(id, data, headers, req.headers['content-length']);
  }

  @Get(':id')
  async fetch(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const blob = await this.blobs.get(id);
    if (!blob) {
      throw new NotFoundException();
    }
    const headers = { ...blob.headers };
    if (!('content-type' in headers)) {
      const inferred = mime.lookup(id);
      if (inferred) {
        headers['content-type'] = inferred;
      }
    }
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    res.status(200).send(blob.data);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.blobs.remove(id);
  }
}
