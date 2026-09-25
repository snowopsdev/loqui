const handlers = new Set<() => Promise<unknown>>();
export function registerUpdateFlush(handler: () => Promise<unknown>) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
export async function flushForUpdate() {
  await Promise.all([...handlers].map((handler) => handler()));
}
