import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { startDigestWorker } from './digest.worker';

async function bootstrap() {
  await NestFactory.createApplicationContext(AppModule);
  startDigestWorker({ host: process.env.REDIS_HOST ?? 'localhost', port: 6379 });
}

bootstrap();
