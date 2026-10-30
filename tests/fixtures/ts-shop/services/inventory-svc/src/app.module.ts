import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InventoryController } from './inventory.controller';
import { PrismaService } from './prisma.service';
import { RestockJob } from './restock.job';
import { StockService } from './stock.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [InventoryController],
  providers: [PrismaService, StockService, RestockJob],
})
export class AppModule {}
