export class CreateOrderDto {
  sku!: string;
  quantity!: number;
  email!: string;
}

export interface OrderCreatedEvent {
  id: string;
  sku: string;
  quantity: number;
}
