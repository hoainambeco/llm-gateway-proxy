import { EventEmitter } from 'node:events';

export class FakeRedis extends EventEmitter {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  public static readonly bus = new EventEmitter();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
    let expiresAt: number | undefined;
    for (let i = 0; i < args.length; i++) {
      const mode = String(args[i]).toUpperCase();
      if (mode === 'PX' && args[i + 1] !== undefined) {
        expiresAt = Date.now() + Number(args[i + 1]);
        break;
      }
      if (mode === 'EX' && args[i + 1] !== undefined) {
        expiresAt = Date.now() + Number(args[i + 1]) * 1000;
        break;
      }
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async publish(channel: string, message: string): Promise<number> {
    FakeRedis.bus.emit(channel, message);
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    const handler = (msg: string) => {
      this.emit('message', channel, msg);
    };
    FakeRedis.bus.on(channel, handler);
    return 1;
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  disconnect(): void {
    FakeRedis.bus.removeAllListeners();
  }

  clear(): void {
    this.store.clear();
  }
}
