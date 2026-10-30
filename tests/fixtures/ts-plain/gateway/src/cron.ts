import cron from 'node-cron';
import { pool } from '@db/pg';

cron.schedule('*/5 * * * *', syncRates);

async function syncRates() {
  const res = await fetch('https://rates.example.com/latest');
  const rates = await res.json();
  await pool.query('UPDATE currencies SET rate = $2 WHERE code = $1', [rates.base, rates.value]);
}
