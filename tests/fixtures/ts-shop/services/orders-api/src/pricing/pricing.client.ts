import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CreateOrderDto } from '@shop/contracts';

@Injectable()
export class PricingClient {
  constructor(private readonly http: HttpService) {}

  async price(sku: string) {
    const { data } = await firstValueFrom(this.http.get('https://pricing.example.com/v1/prices', { params: { sku } }));
    return data;
  }

  async screen(dto: CreateOrderDto) {
    const { data } = await firstValueFrom(this.http.post(`${process.env.FRAUD_URL}/check`, dto));
    return data;
  }
}
