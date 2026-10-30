import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: { package: 'inventory', protoPath: join(__dirname, 'inventory.proto'), url: '0.0.0.0:5000' },
  });
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: { client: { brokers: [process.env.KAFKA_BROKER ?? 'localhost:9092'] }, consumer: { groupId: 'inventory' } },
  });
  await app.startAllMicroservices();
  await app.init();
}

bootstrap();
