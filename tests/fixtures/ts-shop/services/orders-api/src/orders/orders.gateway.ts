import { MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { OrdersService } from './orders.service';

@WebSocketGateway({ namespace: 'orders' })
export class OrdersGateway {
  constructor(private readonly orders: OrdersService) {}

  @SubscribeMessage('order.track')
  track(@MessageBody() id: string) {
    return this.orders.get(id);
  }

  @SubscribeMessage('stock.check')
  stock(@MessageBody() sku: string) {
    return this.orders.checkStock(sku);
  }
}
