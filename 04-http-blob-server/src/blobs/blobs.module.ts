import { Module } from '@nestjs/common';
import { BLOB_CONFIG, defaultBlobLimits } from '../config';
import { BlobsController } from './blobs.controller';
import { BlobsService } from './blobs.service';

@Module({
  controllers: [BlobsController],
  providers: [
    BlobsService,
    { provide: BLOB_CONFIG, useFactory: defaultBlobLimits },
  ],
  exports: [BlobsService],
})
export class BlobsModule {}
