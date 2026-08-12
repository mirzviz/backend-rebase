import { Body, Controller, Get, HttpCode, HttpException, Post } from '@nestjs/common';
import { NodesService } from './nodes.service';

@Controller('internal/nodes')
export class NodesController {
  constructor(private readonly nodes: NodesService) {}

  @Post()
  @HttpCode(200) // the spec requires 200 on success; Nest defaults POST to 201
  register(@Body() body: unknown): { id: string } {
    const result = this.nodes.register(body);
    switch (result.kind) {
      case 'registration-closed':
        throw new HttpException(
          { errorMessage: 'the request was rejected because registration period is over' },
          403,
        );
      case 'invalid':
        throw new HttpException({ errorMessage: result.error }, 400);
      case 'registered':
        return { id: result.record.id };
    }
  }

  @Get()
  list() {
    const data = this.nodes.list().map((node) => ({
      id: node.id,
      destination: node.destination,
      name: node.name,
    }));
    return { data };
  }
}
