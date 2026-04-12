import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<string>();

export function runWithCorrelationId<T>(fn: () => T, id?: string): T {
  return store.run(id ?? randomUUID(), fn);
}

export function getCorrelationId(): string | undefined {
  return store.getStore();
}
