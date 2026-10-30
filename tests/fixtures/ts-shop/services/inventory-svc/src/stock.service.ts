import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(sku: string, quantity: number) {
    const row = await this.prisma.stock.update({ where: { sku }, data: { reserved: { increment: quantity } } });
    return { ok: row.reserved <= row.onHand };
  }

  async commit(sku: string, quantity: number) {
    await this.prisma.stock.update({ where: { sku }, data: { onHand: { decrement: quantity } } });
  }

  async release(orderId: string) {
    await this.prisma.reservation.deleteMany({ where: { orderId } });
  }

  available(sku: string) {
    return this.prisma.stock.findUnique({ where: { sku } });
  }

  lowStock() {
    return this.prisma.stock.findMany({ where: { onHand: { lt: 5 } } });
  }
}
