export interface ThumbnailRequest { key: string; imageId: string; mainFile: string }
export type ThumbnailLoader = (request: ThumbnailRequest, isCurrent: () => boolean) => Promise<string | null>;

/** One queue per mounted library: two active jobs across page/project changes. */
export class ThumbnailQueue {
  private active = new Set<string>();
  private cache = new Map<string, string | null>();
  private pending: ThumbnailRequest[] = [];
  private wanted = new Set<string>();
  private notify: (() => void) | null = null;
  private subscription = 0;
  constructor(private load: ThumbnailLoader, private capacity = 64) {}
  get(key: string) { return this.cache.get(key); }
  set(requests: ThumbnailRequest[], notify: () => void) {
    const subscription = ++this.subscription;
    this.wanted = new Set(requests.map((request) => request.key));
    this.notify = notify;
    this.pending = requests.filter((request) => !this.cache.has(request.key) && !this.active.has(request.key));
    this.pump();
    return () => { if (this.subscription === subscription) { this.notify = null; this.pending = []; this.wanted.clear(); } };
  }
  private pump() {
    while (this.active.size < 2 && this.pending.length) {
      const request = this.pending.shift()!;
      this.active.add(request.key);
      void this.load(request, () => this.wanted.has(request.key)).catch(() => null).then((source) => {
        if (!this.wanted.has(request.key)) return;
        this.cache.delete(request.key); this.cache.set(request.key, source);
        while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
        this.notify?.();
      }).finally(() => { this.active.delete(request.key); this.pump(); });
    }
  }
}
