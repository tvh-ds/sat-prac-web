// Share only simultaneous reads. Completed responses are never cached, so
// navigation, polling and retries always fetch current server state.
export class InflightRequests {
  private readonly requests = new Map<string, Promise<unknown>>();

  read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(key);
    if (existing) return existing as Promise<T>;
    const request = Promise.resolve().then(load).finally(() => {
      // An intervening mutation may have replaced this entry.
      if (this.requests.get(key) === request) this.requests.delete(key);
    });
    this.requests.set(key, request);
    return request;
  }

  invalidate(): void {
    this.requests.clear();
  }
}
