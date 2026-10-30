import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CreateOrderDto } from '@shop/contracts';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.orders.list(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body() dto: CreateOrderDto) {
    return this.orders.replace(id, dto);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.orders.setStatus(id, status);
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.orders.cancel(id);
  }
}
