import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';

interface InventoryService {
  reserveStock(req: { sku: string; quantity: number }): Observable<{ ok: boolean }>;
}

@Injectable()
export class InventoryClient implements OnModuleInit {
  private svc!: InventoryService;

  constructor(@Inject('INVENTORY_PACKAGE') private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.svc = this.client.getService<InventoryService>('InventoryService');
  }

  async reserve(sku: string, quantity: number) {
    const res = await firstValueFrom(this.svc.reserveStock({ sku, quantity }));
    return res.ok;
  }
}
