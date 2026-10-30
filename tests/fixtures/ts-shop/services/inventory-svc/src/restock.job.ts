import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { StockService } from './stock.service';

@Injectable()
export class RestockJob {
  private readonly logger = new Logger(RestockJob.name);

  constructor(private readonly stock: StockService) {}

  @Cron('0 * * * *')
  async restock() {
    const low = await this.stock.lowStock();
    this.logger.log(`${low.length} items need restock`);
  }

  @Interval(30000)
  heartbeat() {
    this.logger.debug('inventory alive');
  }
}
