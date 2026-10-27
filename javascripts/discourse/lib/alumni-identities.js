export const MAX_IDENTITY_BATCH = 100;

export function alumniUserId(user) {
  const value = user?.id;
  if (typeof value === "string" && !/^[1-9]\d{0,9}$/.test(value)) {
    return null;
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

export default class AlumniIdentities {
  #generation = 0;
  #members = new Map();
  #loading = new Set();
  #pending = new Set();
  #request;
  #changed;
  #scheduled = false;
  #running = false;
  #watchers = new Map();

  constructor({ request, changed }) {
    this.#request = request;
    this.#changed = changed;
  }

  isMember(id) {
    return this.#members.get(id) === true;
  }

  snapshot() {
    return new Map(this.#members);
  }

  watch(id) {
    id = alumniUserId({ id });
    if (!id) {
      return;
    }
    this.#watchers.set(id, (this.#watchers.get(id) || 0) + 1);
    if (!this.#members.has(id) && !this.#loading.has(id)) {
      this.#pending.add(id);
      this.#schedule();
    }
  }

  unwatch(id) {
    const count = (this.#watchers.get(id) || 0) - 1;
    if (count > 0) {
      this.#watchers.set(id, count);
    } else {
      this.#watchers.delete(id);
      this.#pending.delete(id);
      this.#members.delete(id);
    }
  }

  refresh() {
    this.#generation++;
    this.#members.clear();
    this.#loading.clear();
    this.#pending = new Set(this.#watchers.keys());
    this.#scheduled = false;
    this.#running = false;
    this.#changed();
    this.#schedule();
  }

  destroy() {
    this.#generation++;
    this.#watchers.clear();
    this.#members.clear();
    this.#loading.clear();
    this.#pending.clear();
  }

  #schedule() {
    if (this.#scheduled || this.#running || !this.#pending.size) {
      return;
    }
    this.#scheduled = true;
    const generation = this.#generation;
    queueMicrotask(() => {
      if (generation !== this.#generation) {
        return;
      }
      this.#scheduled = false;
      this.#flush(generation);
    });
  }

  async #flush(generation) {
    this.#running = true;
    while (this.#pending.size && generation === this.#generation) {
      const ids = [...this.#pending].slice(0, MAX_IDENTITY_BATCH);
      ids.forEach((id) => {
        this.#pending.delete(id);
        this.#loading.add(id);
      });
      try {
        const result = await this.#request(ids);
        if (generation !== this.#generation) {
          return;
        }
        for (const id of ids) {
          const value = result?.memberships?.[id];
          if (this.#watchers.has(id) && typeof value === "boolean") {
            this.#members.set(id, value);
          }
        }
        this.#changed();
      } catch {
        // Unknown identity stays hidden; the next navigation or foreground refresh retries.
      } finally {
        if (generation === this.#generation) {
          ids.forEach((id) => this.#loading.delete(id));
        }
      }
    }
    if (generation === this.#generation) {
      this.#running = false;
    }
  }
}
