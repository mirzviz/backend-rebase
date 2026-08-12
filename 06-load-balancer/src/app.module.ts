import { Module } from '@nestjs/common';
import { BlobsModule } from './blobs/blobs.module';
import { NodesModule } from './nodes/nodes.module';

@Module({
  imports: [NodesModule, BlobsModule],
})
export class AppModule {}
