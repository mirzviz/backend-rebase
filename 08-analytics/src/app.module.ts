import { Module } from '@nestjs/common';
import { PageViewsModule } from './page-views/page-views.module';
import { ReportModule } from './report/report.module';

@Module({
  imports: [PageViewsModule, ReportModule],
})
export class AppModule {}
