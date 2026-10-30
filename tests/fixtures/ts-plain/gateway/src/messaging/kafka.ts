import { EachMessagePayload, Kafka } from 'kafkajs';

const kafka = new Kafka({ clientId: 'gateway', brokers: [process.env.KAFKA_BROKER ?? 'localhost:9092'] });
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'gateway' });

export async function publishAudit(event: { type: string; id: string }) {
  await producer.send({ topic: 'audit.events', messages: [{ value: JSON.stringify(event) }] });
}

export async function publishSignup(userId: string) {
  await producer.send({ topic: process.env.SIGNUP_TOPIC, messages: [{ key: userId, value: userId }] });
}

export async function startConsumers() {
  await consumer.subscribe({ topic: 'user.signup' });
  await consumer.subscribe({ topics: ['user.deleted', 'user.updated'], fromBeginning: false });
  await consumer.subscribe({ topic: process.env.AUDIT_REPLAY_TOPIC });
  await consumer.run({ eachMessage: handleMessage });
}

async function handleMessage({ topic, message }: EachMessagePayload) {
  console.log(topic, message.value?.toString());
}
