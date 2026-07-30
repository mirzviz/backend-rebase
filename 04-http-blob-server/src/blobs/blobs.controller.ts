import type { IncomingHttpHeaders } from 'node:http';
import { pipeline } from 'node:stream/promises';
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
    const headers = extractStorableHeaders(req.headers);
    // req is the raw request stream itself - the service pipes it
    // straight to disk rather than us buffering it into memory here.
    await this.blobs.put(id, req, headers, req.headers['content-length']);
  }

  @Get(':id')
  async fetch(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const blob = await this.blobs.getBlob(id);
    if (blob === null) {
      throw new NotFoundException();
    }
    const responseHeaders = { ...blob.headers };
    if (!('content-type' in responseHeaders)) {
      // Streaming via pipeline() writes the body directly, so we lose
      // Express's res.send(buffer) side effect of defaulting Content-Type
      // to application/octet-stream - that fallback has to be explicit now.
      responseHeaders['content-type'] = mime.lookup(id) || 'application/octet-stream';
    }
    for (const [key, value] of Object.entries(responseHeaders)) {
      res.setHeader(key, value);
    }
    res.status(200);
    await pipeline(blob.stream, res);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.blobs.remove(id);
  }
}
