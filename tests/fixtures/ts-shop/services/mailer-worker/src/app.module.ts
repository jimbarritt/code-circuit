import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Queues } from '@shop/contracts';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }), BullModule.registerQueue({ name: Queues.Emails })],
  providers: [EmailProcessor],
})
export class AppModule {}
