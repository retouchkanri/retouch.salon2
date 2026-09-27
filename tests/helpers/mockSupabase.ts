/**
 * Tiny in-memory Supabase client stub. Implements only the chain shape that
 * `seatUsage`, `seatUsageBatch`, `hasActiveSupport`, and the booking routes
 * touch:
 *
 *   admin.from(table).select(cols).eq(col, val).maybeSingle?()
 *   admin.from(table).select(cols).in(col, values)
 *   admin.from(table).select(cols, { count: "exact", head: true }).eq(col, val).eq(col, val)
 *
 * The chain is truthy regardless of order; filters are applied lazily when
 * the chain is awaited or .maybeSingle() is called.
 */

type Row = Record<string, any>;

type Filter = { kind: "eq"; col: string; val: any } | { kind: "in"; col: string; vals: any[] };

class Query implements PromiseLike<{ data: Row[]; error: null; count?: number }> {
  private filters: Filter[] = [];
  constructor(
    private rows: Row[],
    private opts: { count?: "exact"; head?: boolean } = {},
  ) {}

  eq(col: string, val: any) {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push({ kind: "in", col, vals });
    return this;
  }
  order(_col: string, _opts?: any) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  range(_a: number, _b: number) {
    return this;
  }

  private apply(): Row[] {
    let rows = this.rows;
    for (const f of this.filters) {
      if (f.kind === "eq") rows = rows.filter((r) => r[f.col] === f.val);
      else rows = rows.filter((r) => f.vals.includes(r[f.col]));
    }
    return rows;
  }

  async maybeSingle() {
    const rows = this.apply();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.apply();
    if (rows.length === 0) return { data: null, error: { message: "not found" } };
    return { data: rows[0], error: null };
  }

  then<TResult1 = { data: Row[]; error: null; count?: number }, TResult2 = never>(
    resolve?: ((value: { data: Row[]; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.apply();
    const out: any = { data: this.opts.head ? null : rows, error: null };
    if (this.opts.count === "exact") out.count = rows.length;
    return Promise.resolve(out).then(resolve as any, reject as any);
  }
}

class Table {
  insertedRows: Row[] = [];
  updatedRows: Row[] = [];
  deletedRows: Row[] = [];

  constructor(public name: string, public rows: Row[]) {}

  select(_cols: string, opts?: { count?: "exact"; head?: boolean }) {
    return new Query(this.rows, opts);
  }

  insert(row: Row | Row[]) {
    const list = Array.isArray(row) ? row : [row];
    const inserted = list.map((r) => ({ id: r.id ?? `row_${this.rows.length + 1}`, ...r }));
    this.rows.push(...inserted);
    this.insertedRows.push(...inserted);
    const wrapper = {
      select(_cols: string) {
        return {
          async single() {
            return { data: inserted[0], error: null };
          },
        };
      },
      then(resolve: any) {
        return Promise.resolve({ data: inserted, error: null }).then(resolve);
      },
    };
    return wrapper as any;
  }

  update(patch: Row) {
    const filters: Filter[] = [];
    const proxy: any = {
      eq(col: string, val: any) {
        filters.push({ kind: "eq", col, val });
        return proxy;
      },
      in(col: string, vals: any[]) {
        filters.push({ kind: "in", col, vals });
        return proxy;
      },
      select(_cols: string) {
        return {
          single: async () => {
            const tgt = applyFilters(this.rows, filters)[0];
            if (!tgt) return { data: null, error: { message: "not found" } };
            Object.assign(tgt, patch);
            this.updatedRows.push({ id: tgt.id, ...patch });
            return { data: tgt, error: null };
          },
        };
      },
      then: (resolve: any) => {
        const tgts = applyFilters(this.rows, filters);
        for (const t of tgts) Object.assign(t, patch);
        this.updatedRows.push(...tgts.map((t) => ({ id: t.id, ...patch })));
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return proxy;
  }

  delete() {
    const filters: Filter[] = [];
    const proxy: any = {
      eq: (col: string, val: any) => {
        filters.push({ kind: "eq", col, val });
        return proxy;
      },
      then: (resolve: any) => {
        const tgts = applyFilters(this.rows, filters);
        for (const t of tgts) {
          const idx = this.rows.indexOf(t);
          if (idx >= 0) this.rows.splice(idx, 1);
          this.deletedRows.push(t);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return proxy;
  }
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  let r = rows;
  for (const f of filters) {
    if (f.kind === "eq") r = r.filter((row) => row[f.col] === f.val);
    else r = r.filter((row) => f.vals.includes(row[f.col]));
  }
  return r;
}

export function makeSupabase(initial: Record<string, Row[]>) {
  const tables = new Map<string, Table>();
  for (const [name, rows] of Object.entries(initial)) {
    tables.set(name, new Table(name, [...rows]));
  }
  return {
    from(name: string) {
      let t = tables.get(name);
      if (!t) {
        t = new Table(name, []);
        tables.set(name, t);
      }
      return t;
    },
    _table(name: string) {
      return tables.get(name);
    },
  };
}
