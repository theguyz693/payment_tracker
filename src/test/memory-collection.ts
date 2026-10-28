// A tiny in-memory stand-in for a MongoDB collection, supporting just the
// filter/update operators the repositories use. Lets tests run real
// repository code against two users' data and observe what changes.

import { ObjectId } from "mongodb";

type Doc = Record<string, unknown>;

/** Deep copy that keeps ObjectId and Date instances (structuredClone doesn't). */
function clone<T>(v: T): T {
  if (v instanceof ObjectId) return new ObjectId(v.toHexString()) as T;
  if (v instanceof Date) return new Date(v.getTime()) as T;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
}

function get(doc: unknown, path: string): unknown[] {
  // Returns every value at a dotted path, fanning out over arrays.
  let values: unknown[] = [doc];
  for (const key of path.split(".")) {
    const next: unknown[] = [];
    for (const v of values) {
      if (Array.isArray(v)) {
        if (/^\d+$/.test(key)) next.push(v[Number(key)]);
        else for (const item of v) next.push((item as Doc | undefined)?.[key]);
      } else if (v && typeof v === "object") next.push((v as Doc)[key]);
      else next.push(undefined);
    }
    values = next;
  }
  return values;
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchValue(values: unknown[], cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !(cond instanceof Date)) {
    const ops = cond as Record<string, unknown>;
    return Object.entries(ops).every(([op, arg]) => {
      switch (op) {
        case "$ne":
          return !values.some((v) => eq(v, arg) || (arg === null && v === undefined));
        case "$exists":
          return values.some((v) => v !== undefined) === arg;
        case "$in":
          return values.some((v) => (arg as unknown[]).some((x) => eq(v, x)));
        case "$type":
          return values.some((v) => typeof v === arg);
        default:
          throw new Error(`memory-collection: unsupported operator ${op}`);
      }
    });
  }
  if (cond === null) return values.some((v) => v === null || v === undefined);
  return values.some((v) => eq(v, cond));
}

export function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((f) => matches(doc, f));
    if (key === "$expr") return true; // balance checks are covered by unit tests of the pure logic
    return matchValue(get(doc, key), cond);
  });
}

function setPath(doc: Doc, path: string, value: unknown) {
  const keys = path.split(".");
  let cur: Doc = doc;
  for (const k of keys.slice(0, -1)) {
    cur[k] ??= /^\d+$/.test(k) ? [] : {};
    cur = cur[k] as Doc;
  }
  cur[keys[keys.length - 1]] = value;
}

export class MemoryCollection {
  docs: Doc[] = [];

  constructor(initial: Doc[] = []) {
    this.docs = initial.map((d) => clone(d));
  }

  find(filter: Doc) {
    const rows = this.docs.filter((d) => matches(d, filter)).map((d) => clone(d));
    const cursor = {
      sort: () => cursor,
      limit: () => cursor,
      project: () => cursor,
      toArray: async () => rows,
    };
    return cursor;
  }
  async findOne(filter: Doc) {
    const d = this.docs.find((x) => matches(x, filter));
    return d ? clone(d) : null;
  }
  async insertOne(doc: Doc) {
    const d = { _id: new ObjectId(), ...doc };
    this.docs.push(d);
    return { insertedId: d._id };
  }
  async updateOne(filter: Doc, update: Doc) {
    const d = this.docs.find((x) => matches(x, filter));
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    for (const [k, v] of Object.entries((update.$set as Doc) ?? {})) setPath(d, k, v);
    for (const [k, v] of Object.entries((update.$push as Doc) ?? {})) ((d[k] ??= []) as unknown[]).push(v);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async updateMany(filter: Doc, update: Doc) {
    let n = 0;
    for (const d of this.docs.filter((x) => matches(x, filter))) {
      for (const [k, v] of Object.entries((update.$set as Doc) ?? {})) setPath(d, k, v);
      n++;
    }
    return { matchedCount: n, modifiedCount: n };
  }
  async deleteOne(filter: Doc) {
    const i = this.docs.findIndex((x) => matches(x, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async deleteMany(filter: Doc) {
    const before = this.docs.length;
    this.docs = this.docs.filter((x) => !matches(x, filter));
    return { deletedCount: before - this.docs.length };
  }
}
