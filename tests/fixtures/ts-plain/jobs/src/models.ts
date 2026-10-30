import { DataTypes, Model, Sequelize } from 'sequelize';

export const sequelize = new Sequelize(process.env.DATABASE_URL ?? 'postgres://localhost/jobs');

export class Invoice extends Model {
  declare id: number;
  declare status: string;
  declare dueAt: Date;
}

Invoice.init({ status: DataTypes.STRING, dueAt: DataTypes.DATE }, { sequelize, tableName: 'invoices' });

export class OutboxEvent extends Model {
  declare id: number;
  declare payload: object;
  declare sent: boolean;
}

OutboxEvent.init({ payload: DataTypes.JSON, sent: DataTypes.BOOLEAN }, { sequelize, tableName: 'outbox' });
