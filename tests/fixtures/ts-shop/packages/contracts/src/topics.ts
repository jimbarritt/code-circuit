export const TOPICS = {
  ORDER_CREATED: 'order.created',
  ORDER_CANCELLED: 'order.cancelled',
} as const;

export enum OrderTopic {
  Created = 'order.created',
  Cancelled = 'order.cancelled',
}

export enum Queues {
  Emails = 'emails',
  Digests = 'digests',
}
