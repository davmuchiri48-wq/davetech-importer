/** Tiny in-memory stand-in for the Firestore Admin API subset this app uses (tests only). */
type Data = Record<string, any>;
const store = new Map<string, Map<string, Data>>();
let autoId = 0;
const coll = (n: string) => { if (!store.has(n)) store.set(n, new Map()); return store.get(n)!; };
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const deepMerge = (a: any, b: any): any => {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  return out;
};

class Snap { constructor(public id: string, private d: Data | undefined, public ref: DocRef) {} get exists() { return this.d !== undefined; } data() { return clone(this.d); } }

class DocRef {
  constructor(public col: string, public id: string) {}
  async get() { return new Snap(this.id, coll(this.col).get(this.id), this); }
  async set(d: Data, o?: { merge?: boolean }) { coll(this.col).set(this.id, o?.merge ? deepMerge(coll(this.col).get(this.id), clone(d)) : clone(d)); }
  async create(d: Data) { if (coll(this.col).has(this.id)) throw new Error('ALREADY_EXISTS'); coll(this.col).set(this.id, clone(d)); }
  async update(d: Data) { const cur = coll(this.col).get(this.id); if (!cur) throw new Error('NOT_FOUND'); coll(this.col).set(this.id, { ...cur, ...clone(d) }); }
  async delete() { coll(this.col).delete(this.id); }
}

class Query {
  constructor(public name: string, private filters: [string, string, any][] = [], private _limit = 0, private _order?: [string, string]) {}
  where(f: string, op: string, v: any) { return new Query(this.name, [...this.filters, [f, op, v]], this._limit, this._order); }
  orderBy(f: string, dir = 'asc') { return new Query(this.name, this.filters, this._limit, [f, dir]); }
  limit(n: number) { return new Query(this.name, this.filters, n, this._order); }
  select() { return this; }
  private rows() {
    let r = [...coll(this.name).entries()].filter(([, d]) => this.filters.every(([f, op, v]) =>
      op === '==' ? d[f] === v : op === 'in' ? v.includes(d[f]) : op === 'array-contains' ? (d[f] || []).includes(v) : true));
    if (this._order) { const [f, dir] = this._order; r.sort((a, b) => (a[1][f] > b[1][f] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
    if (this._limit) r = r.slice(0, this._limit);
    return r.map(([id, d]) => new Snap(id, d, new DocRef(this.name, id)));
  }
  async get() { const docs = this.rows(); return { docs, empty: docs.length === 0, size: docs.length }; }
  count() { return { get: async () => ({ data: () => ({ count: this.rows().length }) }) }; }
}

class CollRef extends Query {
  doc(id?: string) { return new DocRef(this.name, id || `id${++autoId}x${Math.random().toString(36).slice(2, 8)}`); }
  async add(d: Data) { const r = this.doc(); await r.set(d); return r; }
}

export const db: any = {
  collection: (n: string) => new CollRef(n),
  settings: () => undefined,
  batch: () => { const ops: (() => Promise<void>)[] = []; return { set: (r: DocRef, d: Data) => ops.push(() => r.set(d)), update: (r: DocRef, d: Data) => ops.push(() => r.update(d)), commit: async () => { for (const o of ops) await o(); } }; },
  runTransaction: async (fn: (tx: any) => Promise<any>) => {
    const ops: (() => Promise<void>)[] = [];
    const tx = { get: (r: DocRef) => r.get(), create: (r: DocRef, d: Data) => ops.push(() => r.create(d)), set: (r: DocRef, d: Data) => ops.push(() => r.set(d)), delete: (r: DocRef) => ops.push(() => r.delete()), update: (r: DocRef, d: Data) => ops.push(() => r.update(d)) };
    const res = await fn(tx); for (const o of ops) await o(); return res;
  },
};
export const reset = () => store.clear();
export const dump = (n: string) => [...coll(n).entries()];
