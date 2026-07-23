import { Module } from '@nestjs/common';
import { BlobsModule } from './blobs/blobs.module';

@Module({
  imports: [BlobsModule],
})
export class AppModule {}
