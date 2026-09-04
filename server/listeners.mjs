import { atomic, readJSON } from "./storage.mjs";
export class Listeners {
  constructor(path, clock = Date.now) {
    this.path = path;
    this.clock = clock;
    this.sessions = new Map();
    this.saved = {
      total_sessions: 0,
      total_listen_hours: 0,
      peak_listeners: 0,
    };
  }
  async restore() {
    this.saved = await readJSON(this.path, this.saved);
  }
  touch(id) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id ?? "")) return;
    const now = this.clock(),
      last = this.sessions.get(id);
    if (last === undefined || now - last > 30000) this.saved.total_sessions++;
    else this.saved.total_listen_hours += (now - last) / 3600000;
    this.sessions.set(id, now);
    this.saved.peak_listeners = Math.max(
      this.saved.peak_listeners,
      this.snapshot().active_listeners,
    );
  }
  snapshot() {
    const now = this.clock();
    for (const [id, last] of this.sessions)
      if (now - last > 30000) this.sessions.delete(id);
    return {
      ...this.saved,
      active_listeners: this.sessions.size,
      top_countries: [],
      top_cities: [],
    };
  }
  async save() {
    await atomic(this.path, JSON.stringify(this.saved));
  }
}
