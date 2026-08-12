import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [SharedModule],
  controllers: [NodesController],
  providers: [NodesService],
})
export class NodesModule {}
