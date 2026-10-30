import { ConnectionOptions, Job, Worker } from 'bullmq';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';

const s3 = new S3Client({ region: 'eu-west-2' });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

export async function processDigest(job: Job<{ userId: string }>) {
  const seen = await redis.get(`digest:${job.data.userId}`);
  if (seen) return;
  await s3.send(new PutObjectCommand({ Bucket: 'shop-digests', Key: `${job.data.userId}.html`, Body: '<html></html>' }));
  await redis.set('digest:last-run', new Date().toISOString());
}

export function startDigestWorker(connection: ConnectionOptions) {
  return new Worker('digests', processDigest, { connection, concurrency: 2 });
}
