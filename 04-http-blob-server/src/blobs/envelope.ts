import type { FileHandle } from 'node:fs/promises';

// A blob is stored as one file: a 4-byte big-endian length, the UTF-8
// metadata JSON it describes, then the raw payload bytes. A length
// prefix rather than a delimiter, because the payload is arbitrary
// binary data that could contain any byte sequence a delimiter might
// pick - a length is unambiguous regardless of what bytes follow it.
// 4 bytes caps the metadata at ~4GB, far beyond what MAX_HEADER_COUNT /
// MAX_HEADER_KEY_LENGTH / MAX_HEADER_VALUE_LENGTH could ever produce.
const LENGTH_PREFIX_BYTES = 4;

export function encodeHeaderPrefix(metaContent: string): Buffer {
  const metaBuf = Buffer.from(metaContent, 'utf8');
  const lengthBuf = Buffer.alloc(LENGTH_PREFIX_BYTES);
  lengthBuf.writeUInt32BE(metaBuf.length, 0);
  return Buffer.concat([lengthBuf, metaBuf]);
}

export interface DecodedHeader {
  headers: Record<string, string>;
  payloadOffset: number;
}

// Reads just the header portion of an already-open blob file. The caller
// owns the file handle's lifecycle and is responsible for reading the
// payload itself, typically via a stream started at payloadOffset.
export async function readHeaderPrefix(fileHandle: FileHandle): Promise<DecodedHeader> {
  const lengthBuf = Buffer.alloc(LENGTH_PREFIX_BYTES);
  await fileHandle.read(lengthBuf, 0, LENGTH_PREFIX_BYTES, 0);
  const metaLength = lengthBuf.readUInt32BE(0);

  const metaBuf = Buffer.alloc(metaLength);
  await fileHandle.read(metaBuf, 0, metaLength, LENGTH_PREFIX_BYTES);
  const { headers } = JSON.parse(metaBuf.toString('utf8')) as { headers: Record<string, string> };

  return { headers, payloadOffset: LENGTH_PREFIX_BYTES + metaLength };
}
