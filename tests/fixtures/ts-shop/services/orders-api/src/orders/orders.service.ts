import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { ClientKafka } from '@nestjs/microservices';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { CreateOrderDto, TOPICS } from '@shop/contracts';
import { Order } from './order.entity';
import { InventoryClient } from '../inventory/inventory.client';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly dataSource: DataSource,
    @Inject('KAFKA_CLIENT') private readonly kafka: ClientKafka,
    @InjectQueue('emails') private readonly emails: Queue,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly inventory: InventoryClient,
  ) {}

  list(status?: string) {
    return this.orders.find({ where: status ? { status } : {} });
  }

  async get(id: string) {
    const cached = await this.cache.get<Order>(`order:${id}`);
    if (cached) return cached;
    const order = await this.orders.findOneBy({ id });
    await this.cache.set(`order:${id}`, order, 60000);
    return order;
  }

  async create(dto: CreateOrderDto) {
    await this.inventory.reserve(dto.sku, dto.quantity);
    const order = await this.orders.save({ sku: dto.sku, quantity: dto.quantity, status: 'new' });
    this.kafka.emit('order.created', { id: order.id, sku: dto.sku, quantity: dto.quantity });
    await this.emails.add('order-confirmation', { orderId: order.id, email: dto.email });
    return order;
  }

  async replace(id: string, dto: CreateOrderDto) {
    await this.orders.update(id, { sku: dto.sku, quantity: dto.quantity });
    return this.get(id);
  }

  async setStatus(id: string, status: string) {
    await this.dataSource.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    return this.get(id);
  }

  async cancel(id: string) {
    await this.orders.delete(id);
    this.kafka.emit(TOPICS.ORDER_CANCELLED, { id });
  }

  checkStock(sku: string) {
    return this.kafka.send('inventory.check', { sku });
  }
}
