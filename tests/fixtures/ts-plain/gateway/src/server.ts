import express, { Request, Response } from 'express';
import { pool } from '@db/pg';
import { usersRouter } from './routes/users';
import { publishAudit } from './messaging/kafka';

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

app.get('/health', health);
app.post('/webhooks/stripe', stripeWebhook);

function health(_req: Request, res: Response) {
  res.json({ ok: true });
}

async function stripeWebhook(req: Request, res: Response) {
  await pool.query('INSERT INTO webhook_events (payload) VALUES ($1)', [req.body]);
  await publishAudit({ type: 'stripe', id: req.body.id });
  res.sendStatus(204);
}

app.listen(Number(process.env.PORT ?? 3000));
