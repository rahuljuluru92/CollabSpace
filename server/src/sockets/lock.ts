const tails = new Map<string, Promise<void>>();

/**
 * Runs `fn` once every task queued earlier under the same key has finished
 * (whether it succeeded or failed). Tasks under different keys run freely.
 *
 * Joins and edits for a workspace go through this, so this server reads,
 * writes and emits that workspace's events strictly in version order. A
 * client therefore always sees its own ack before any later edit built on it.
 */
export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const result = previous.then(fn);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
}

/** Resolves once every task queued so far (under any key) has finished. */
export async function drain() {
  await Promise.all(Array.from(tails.values()));
}
