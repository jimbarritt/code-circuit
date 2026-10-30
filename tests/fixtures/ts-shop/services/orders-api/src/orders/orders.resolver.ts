import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Order } from './order.entity';
import { OrdersService } from './orders.service';

@Resolver(() => Order)
export class OrdersResolver {
  constructor(private readonly orders: OrdersService) {}

  @Query(() => [Order], { name: 'orders' })
  list(@Args('status', { nullable: true }) status?: string) {
    return this.orders.list(status);
  }

  @Mutation(() => Boolean)
  async cancelOrder(@Args('id') id: string) {
    await this.orders.cancel(id);
    return true;
  }
}
