import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { PageViewsController } from './page-views.controller';
import { PageViewsService } from './page-views.service';

@Module({
  imports: [SharedModule],
  controllers: [PageViewsController],
  providers: [PageViewsService],
})
export class PageViewsModule {}
