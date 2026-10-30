import axios from 'axios';
import { Op } from 'sequelize';
import { Invoice, OutboxEvent } from './models';

export async function pollOutbox() {
  const rows = await OutboxEvent.findAll({ where: { sent: false }, limit: 100 });
  for (const row of rows) {
    await axios.post(process.env.WEBHOOK_URL, row.payload);
  }
}

export async function markOverdue() {
  await Invoice.update({ status: 'overdue' }, { where: { dueAt: { [Op.lt]: new Date() }, status: 'open' } });
}
