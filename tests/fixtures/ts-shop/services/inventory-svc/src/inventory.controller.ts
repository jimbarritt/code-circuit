import { Controller } from '@nestjs/common';
import { EventPattern, GrpcMethod, MessagePattern, Payload } from '@nestjs/microservices';
import { OrderCreatedEvent, OrderTopic, TOPICS } from '@shop/contracts';
import { StockService } from './stock.service';

@Controller()
export class InventoryController {
  constructor(private readonly stock: StockService) {}

  @GrpcMethod('InventoryService', 'ReserveStock')
  reserveStock(data: { sku: string; quantity: number }) {
    return this.stock.reserve(data.sku, data.quantity);
  }

  @EventPattern(TOPICS.ORDER_CREATED)
  async onOrderCreated(@Payload() event: OrderCreatedEvent) {
    await this.stock.commit(event.sku, event.quantity);
  }

  @EventPattern(OrderTopic.Cancelled)
  async onOrderCancelled(@Payload() event: { id: string }) {
    await this.stock.release(event.id);
  }

  @MessagePattern('inventory.check')
  check(@Payload() req: { sku: string }) {
    return this.stock.available(req.sku);
  }
}
