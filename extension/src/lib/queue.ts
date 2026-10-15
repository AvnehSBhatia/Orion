// A small in-memory queue of captures waiting for the server. Bounded by item
// count and total bytes; when full, the oldest captures are dropped first.

export class BoundedQueue<T> {
  private items: { item: T; bytes: number }[] = [];
  private total = 0;
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (item: T) => number;

  constructor(maxItems: number, maxBytes: number, sizeOf: (item: T) => number) {
    this.maxItems = maxItems;
    this.maxBytes = maxBytes;
    this.sizeOf = sizeOf;
  }

  /** Adds an item and returns how many were dropped to make room (the item itself counts if it can never fit). */
  push(item: T): number {
    const bytes = this.sizeOf(item);
    if (bytes > this.maxBytes) return 1;
    let dropped = 0;
    while (this.items.length > 0 && (this.items.length >= this.maxItems || this.total + bytes > this.maxBytes)) {
      this.shift();
      dropped++;
    }
    this.items.push({ item, bytes });
    this.total += bytes;
    return dropped;
  }

  peek(): T | undefined {
    return this.items[0]?.item;
  }

  shift(): T | undefined {
    const first = this.items.shift();
    if (first) this.total -= first.bytes;
    return first?.item;
  }

  /** Removes every item the predicate rejects, for example captures of a site that is now excluded. */
  retain(keep: (item: T) => boolean): void {
    this.items = this.items.filter((e) => keep(e.item));
    this.total = this.items.reduce((sum, e) => sum + e.bytes, 0);
  }

  clear(): void {
    this.items = [];
    this.total = 0;
  }

  get length(): number {
    return this.items.length;
  }

  get bytes(): number {
    return this.total;
  }
}
