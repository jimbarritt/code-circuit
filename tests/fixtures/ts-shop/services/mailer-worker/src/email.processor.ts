import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

@Processor('emails')
export class EmailProcessor extends WorkerHost {
  private readonly ses = new SESClient({ region: process.env.AWS_REGION });

  async process(job: Job<{ orderId: string; email: string }>) {
    await this.ses.send(
      new SendEmailCommand({
        Source: 'orders@shop.example.com',
        Destination: { ToAddresses: [job.data.email] },
        Message: { Subject: { Data: 'Order confirmed' }, Body: { Text: { Data: `Order ${job.data.orderId}` } } },
      }),
    );
  }
}
