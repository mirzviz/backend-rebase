import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { BlobsController } from './blobs.controller';
import { BlobsService } from './blobs.service';

@Module({
  imports: [SharedModule],
  controllers: [BlobsController],
  providers: [BlobsService],
})
export class BlobsModule {}
