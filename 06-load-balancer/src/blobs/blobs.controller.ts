import { All, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BlobsService } from './blobs.service';

// HTTP glue only: check the method is one we support, ask the service
// which node (if any) this blob id routes to, and either report why not
// or hand off to the proxy. No routing/registration-window logic here.
// Raw @Res() is required (not Nest's automatic response handling) because
// forwarding needs to stream an unknown-in-advance status/headers/body
// straight through from the node.
@Controller('blobs')
export class BlobsController {
  constructor(private readonly blobs: BlobsService) {}

  @Post(':id')
  post(@Param('id') id: string, @Req() req: Request, @Res() res: Response): void {
    this.handle(id, req, res);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request, @Res() res: Response): void {
    this.handle(id, req, res);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: Request, @Res() res: Response): void {
    this.handle(id, req, res);
  }

  // Declared last so POST/GET/DELETE above still match first - this only
  // catches methods the assignment doesn't define on /blobs/{id}.
  @All(':id')
  unsupported(@Res() res: Response): void {
    res.status(405).json({ errorMessage: 'only POST, GET and DELETE are supported on /blobs/{id}' });
  }

  private handle(id: string, req: Request, res: Response): void {
    const result = this.blobs.route(id);
    switch (result.kind) {
      case 'not-ready':
        res.status(503).json({ errorMessage: 'the load balancer is not ready yet - registration period is still open' });
        return;
      case 'no-nodes':
        res.status(503).json({ errorMessage: 'no nodes are registered' });
        return;
      case 'routed': {
        const { search } = new URL(req.url ?? '', 'http://localhost');
        this.blobs.forward(req, res, result.node, id, search);
        return;
      }
    }
  }
}
