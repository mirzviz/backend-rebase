import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BlobsModule } from './blobs/blobs.module';
import { RequestLoggingInterceptor } from './logging.interceptor';
import { SharedModule } from './shared.module';

@Module({
  imports: [SharedModule, BlobsModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor }],
})
export class AppModule {}
