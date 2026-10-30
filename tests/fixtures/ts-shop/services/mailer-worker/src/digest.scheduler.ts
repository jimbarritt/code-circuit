import { Queue } from 'bullmq';

const digests = new Queue('digests', { connection: { host: 'localhost', port: 6379 } });

export async function scheduleDigest(userId: string) {
  await digests.add('send-digest', { userId }, { delay: 60000 });
}
