import { Controller, Get, HttpException, Param, Query } from '@nestjs/common';
import { ReportRow, ReportService } from './report.service';

@Controller('report')
export class ReportController {
  constructor(private readonly report: ReportService) {}

  @Get(':page')
  async get(@Param('page') page: string, @Query() query: unknown): Promise<{ data: ReportRow[] }> {
    const result = await this.report.getReport(page, query);
    if (result.kind === 'invalid') {
      throw new HttpException({ errorMessage: result.error }, 400);
    }
    return { data: result.data };
  }
}
