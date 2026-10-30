import amqp, { Channel, ConsumeMessage } from 'amqplib';

export async function startRabbit() {
  const conn = await amqp.connect(process.env.AMQP_URL ?? 'amqp://localhost');
  const channel = await conn.createChannel();
  await channel.assertQueue('invoices');
  await channel.consume('invoices', onInvoice);
  return channel;
}

function onInvoice(msg: ConsumeMessage | null) {
  if (msg) console.log(msg.content.toString());
}

export function publishInvoice(channel: Channel, invoice: object) {
  channel.publish('billing', 'invoice.created', Buffer.from(JSON.stringify(invoice)));
}

export function queueReminder(channel: Channel, reminder: object) {
  channel.sendToQueue('reminders', Buffer.from(JSON.stringify(reminder)));
}
