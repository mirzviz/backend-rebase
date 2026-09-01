import { Module } from '@nestjs/common';
import { BlobsController } from './blobs.controller';
import { BlobsService } from './blobs.service';

// BLOB_CONFIG and LOGGER come from the @Global() SharedModule.
@Module({
  controllers: [BlobsController],
  providers: [BlobsService],
  exports: [BlobsService],
})
export class BlobsModule {}
