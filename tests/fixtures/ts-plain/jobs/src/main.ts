import { markOverdue, pollOutbox } from './outbox';

export function start() {
  setInterval(pollOutbox, 10000);
  setInterval(markOverdue, 3600000);
}

start();
