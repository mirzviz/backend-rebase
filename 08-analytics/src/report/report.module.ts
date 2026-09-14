import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [SharedModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
