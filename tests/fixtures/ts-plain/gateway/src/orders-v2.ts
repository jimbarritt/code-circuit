import Koa, { Context } from 'koa';
import Router from '@koa/router';
import axios from 'axios';

const app = new Koa();
const router = new Router({ prefix: '/v2' });

router.get('/orders/:id', getOrder);
router.post('/orders', createOrder);

async function getOrder(ctx: Context) {
  const res = await axios.get('https://orders.example.com/api/orders/' + ctx.params.id);
  ctx.body = res.data;
}

async function createOrder(ctx: Context) {
  const res = await axios.post('https://orders.example.com/api/orders', ctx.request.body);
  ctx.status = 201;
  ctx.body = res.data;
}

app.use(router.routes()).use(router.allowedMethods());
app.listen(3002);
