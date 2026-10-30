import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { pool } from './pg';

export const users = pgTable('users', { id: serial('id').primaryKey(), email: text('email') });

export const orm = drizzle(pool);
