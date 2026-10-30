import { ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sqs = new SQSClient({ region: 'eu-west-1' });
const sns = new SNSClient({ region: 'eu-west-1' });
const PAYMENTS_QUEUE = 'https://sqs.eu-west-1.amazonaws.com/123456789012/payments';

export async function enqueuePayment(payment: object) {
  await sqs.send(new SendMessageCommand({ QueueUrl: PAYMENTS_QUEUE, MessageBody: JSON.stringify(payment) }));
}

export async function pollPayments() {
  for (;;) {
    const out = await sqs.send(new ReceiveMessageCommand({ QueueUrl: PAYMENTS_QUEUE, WaitTimeSeconds: 20 }));
    for (const m of out.Messages ?? []) console.log(m.Body);
  }
}

export async function alert(message: string) {
  await sns.send(new PublishCommand({ TopicArn: process.env.ALERTS_TOPIC_ARN, Message: message }));
}
