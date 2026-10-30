import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { HttpModule } from '@nestjs/axios';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { Order } from './orders/order.entity';
import { OrdersController } from './orders/orders.controller';
import { OrdersResolver } from './orders/orders.resolver';
import { OrdersGateway } from './orders/orders.gateway';
import { OrdersService } from './orders/orders.service';
import { InventoryClient } from './inventory/inventory.client';
import { PricingClient } from './pricing/pricing.client';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({ type: 'postgres', url: process.env.DATABASE_URL, entities: [Order] }),
    TypeOrmModule.forFeature([Order]),
    BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
    BullModule.registerQueue({ name: 'emails' }),
    CacheModule.register(),
    HttpModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({ driver: ApolloDriver, autoSchemaFile: true }),
    ClientsModule.register([
      { name: 'KAFKA_CLIENT', transport: Transport.KAFKA, options: { client: { brokers: ['localhost:9092'] } } },
      {
        name: 'INVENTORY_PACKAGE',
        transport: Transport.GRPC,
        options: { package: 'inventory', protoPath: join(__dirname, 'inventory.proto'), url: 'inventory:5000' },
      },
    ]),
  ],
  controllers: [OrdersController, HealthController],
  providers: [OrdersService, OrdersResolver, OrdersGateway, InventoryClient, PricingClient],
})
export class AppModule {}
