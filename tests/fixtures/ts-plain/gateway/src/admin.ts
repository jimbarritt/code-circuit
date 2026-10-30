import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import got from 'got';
import { orm, users } from '@db/drizzle';
import { redis } from '@db/redis';

const fastify = Fastify({ logger: true });

fastify.get('/admin/stats', stats);
fastify.route({ method: 'POST', url: '/admin/reindex', handler: reindex });

async function stats(_req: FastifyRequest, reply: FastifyReply) {
  const cached = await redis.get('stats:daily');
  if (cached) return reply.send(JSON.parse(cached));
  const res = await fetch(`${process.env.METRICS_URL}/summary`);
  return reply.send(await res.json());
}

async function reindex(_req: FastifyRequest, reply: FastifyReply) {
  const rows = await orm.select().from(users);
  await got.post('https://search.example.com/reindex', { json: rows });
  return reply.code(202).send();
}

fastify.listen({ port: 3001 });
