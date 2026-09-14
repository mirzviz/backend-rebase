import { Body, Controller, HttpCode, HttpException, Post } from '@nestjs/common';
import { PageViewsService } from './page-views.service';

@Controller('page-views')
export class PageViewsController {
  constructor(private readonly pageViews: PageViewsService) {}

  @Post('single')
  @HttpCode(200)
  async single(@Body() body: unknown): Promise<Record<string, never>> {
    const result = await this.pageViews.recordSingle(body);
    if (result.kind === 'invalid') {
      throw new HttpException({ errorMessage: result.error }, 400);
    }
    return {};
  }

  @Post('multi')
  @HttpCode(200)
  async multi(@Body() body: unknown): Promise<Record<string, never>> {
    const result = await this.pageViews.recordMulti(body);
    if (result.kind === 'invalid') {
      throw new HttpException({ errorMessage: result.error }, 400);
    }
    return {};
  }
}
