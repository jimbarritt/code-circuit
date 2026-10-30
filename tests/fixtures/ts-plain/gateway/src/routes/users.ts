import express, { Request, Response } from 'express';
import { User } from '@db/mongo';
import { db } from '@db/knex';
import { publishSignup } from '../messaging/kafka';

export const usersRouter = express.Router();

usersRouter.get('/', listUsers);
usersRouter.get('/search', searchUsers);
usersRouter.get('/:id', getUser);
usersRouter.post('/', createUser);

async function listUsers(_req: Request, res: Response) {
  res.json(await User.find({ active: true }));
}

async function searchUsers(req: Request, res: Response) {
  res.json(await db('users').where('name', 'like', `%${req.query.q}%`).limit(20));
}

async function getUser(req: Request, res: Response) {
  res.json(await User.findById(req.params.id));
}

async function createUser(req: Request, res: Response) {
  const user = await User.create(req.body);
  await publishSignup(user.id);
  res.status(201).json(user);
}
