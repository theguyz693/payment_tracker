// Data access for investment holdings and their transactions.
//
// SECURITY: every function takes the authenticated `userId` first and
// includes it in every filter.
// Integrity: each investment transaction is its own document with a unique
// (userId, requestId); SIP instalments are also unique per (holding, sipFor),
// so a refresh or double-click never records the same contribution twice.
// A sale is validated by replaying the holding's history (FIFO) with the new
// sale included before it's written.
//
// Concurrency: every trade write runs in a MongoDB transaction that also
// bumps the holding's `txnSeq`. Two concurrent sells both write the holding
// document, so one hits a write conflict and is retried by the driver; the
// retry re-reads the history (now including the other sale) and is refused
// if it would oversell. Deleting a trade is serialised the same way.

import "server-only";
import { ObjectId, type ClientSession } from "mongodb";
import { computeHolding, HoldingError, type AssetType, type GoldDetails, type InvTxn, type InvTxnType, type SipPlan, type SipStatus } from "@/lib/portfolio";
import type { ISODate } from "@/lib/types";
import { UserError } from "./errors";
import { holdingsCollection, invTxnsCollection, isDuplicateKey, runInTransaction, type HoldingDoc, type InvTxnDoc, type PriceProvider } from "./models";

function toObjectId(id: string): ObjectId | null {
  return /^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null;
}

export interface Holding {
  id: string;
  type: AssetType;
  name: string;
  symbol: string | null;
  provider: PriceProvider | null;
  providerKey: string | null;
  sip: SipPlan | null;
  gold: GoldDetails | null;
  manualPrice: { price4: number; asOf: ISODate } | null;
  notes: string | null;
  archived: boolean;
}

function toHolding(d: HoldingDoc): Holding {
  return {
    id: d._id.toHexString(),
    type: d.type,
    name: d.name,
    symbol: d.symbol,
    provider: d.provider,
    providerKey: d.providerKey,
    sip: d.sip,
    gold: d.gold,
    manualPrice: d.manualPrice ? { price4: d.manualPrice.price4, asOf: d.manualPrice.asOf } : null,
    notes: d.notes,
    archived: d.archivedAt !== null,
  };
}

function toTxn(d: InvTxnDoc): InvTxn {
  return {
    id: d._id.toHexString(),
    holdingId: d.holdingId.toHexString(),
    type: d.type,
    date: d.date,
    qtyMicro: d.qtyMicro,
    price4: d.price4,
    amountPaise: d.amountPaise,
    feePaise: d.feePaise,
    sipFor: d.sipFor,
    note: d.note,
  };
}

export async function listHoldings(userId: string, opts: { includeArchived?: boolean } = {}): Promise<Holding[]> {
  const filter = opts.includeArchived ? { userId } : { userId, archivedAt: null };
  return (await holdingsCollection().find(filter).sort({ type: 1, name: 1 }).toArray()).map(toHolding);
}

export async function getHolding(userId: string, id: string): Promise<Holding | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const doc = await holdingsCollection().findOne({ _id, userId });
  return doc ? toHolding(doc) : null;
}

/** All of the user's investment transactions (optionally for one holding). */
export async function listInvTxns(userId: string, holdingId?: string, session?: ClientSession): Promise<InvTxn[]> {
  const filter: Record<string, unknown> = { userId };
  if (holdingId) {
    const _id = toObjectId(holdingId);
    if (!_id) return [];
    filter.holdingId = _id;
  }
  return (await invTxnsCollection().find(filter, { session }).sort({ date: 1, _id: 1 }).toArray()).map(toTxn);
}

export interface HoldingInput {
  type: AssetType;
  name: string;
  symbol: string | null;
  provider: PriceProvider | null;
  providerKey: string | null;
  sip: SipPlan | null;
  gold: GoldDetails | null;
  notes: string | null;
}

export async function createHolding(userId: string, input: HoldingInput, requestId: string): Promise<string> {
  const now = new Date();
  try {
    const res = await holdingsCollection().insertOne({
      ...input,
      userId,
      manualPrice: null,
      archivedAt: null,
      requestId,
      createdAt: now,
      updatedAt: now,
    } as unknown as HoldingDoc);
    return res.insertedId.toHexString();
  } catch (e) {
    if (isDuplicateKey(e)) {
      const existing = await holdingsCollection().findOne({ userId, requestId });
      if (existing) return existing._id.toHexString();
    }
    throw e;
  }
}

export async function updateHolding(userId: string, id: string, input: Omit<HoldingInput, "type">): Promise<void> {
  const _id = toObjectId(id);
  if (!_id) throw new UserError("This investment no longer exists.");
  const res = await holdingsCollection().updateOne({ _id, userId }, { $set: { ...input, updatedAt: new Date() } });
  if (res.matchedCount !== 1) throw new UserError("This investment no longer exists.");
}

export async function setSipStatus(userId: string, id: string, status: SipStatus): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await holdingsCollection().updateOne(
    { _id, userId, sip: { $ne: null } },
    { $set: { "sip.status": status, updatedAt: new Date() } },
  );
  return res.matchedCount === 1;
}

export async function setManualPrice(userId: string, id: string, price4: number, asOf: ISODate): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await holdingsCollection().updateOne(
    { _id, userId },
    { $set: { manualPrice: { price4, asOf, setAt: new Date() }, updatedAt: new Date() } },
  );
  return res.matchedCount === 1;
}

export async function setHoldingArchived(userId: string, id: string, archived: boolean): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await holdingsCollection().updateOne({ _id, userId }, { $set: { archivedAt: archived ? new Date() : null, updatedAt: new Date() } });
  return res.matchedCount === 1;
}

export interface InvTxnInput {
  type: InvTxnType;
  date: ISODate;
  qtyMicro: number | null;
  price4: number | null;
  amountPaise: number;
  feePaise: number;
  sipFor: ISODate | null;
  note: string | null;
}

/** Filter on the holding's trade counter (older holdings don't have one yet). */
function seqCond(seq: number | undefined) {
  return seq === undefined ? { $exists: false } : seq;
}

/**
 * Record a buy/sell/dividend. Returns "duplicate" when this exact submit (or
 * SIP date) was already recorded. Pass `session` to join a caller's
 * transaction (event processing); otherwise one is started here.
 */
export async function addInvTxn(
  userId: string,
  holdingId: string,
  input: InvTxnInput,
  requestId: string,
  session?: ClientSession,
): Promise<"added" | "duplicate"> {
  if (session) return addInvTxnIn(userId, holdingId, input, requestId, session);
  return runInTransaction((s) => addInvTxnIn(userId, holdingId, input, requestId, s));
}

async function addInvTxnIn(userId: string, holdingId: string, input: InvTxnInput, requestId: string, session: ClientSession | undefined): Promise<"added" | "duplicate"> {
  const hid = toObjectId(holdingId);
  const holding = hid ? await holdingsCollection().findOne({ _id: hid, userId, archivedAt: null }, { session }) : null;
  if (!hid || !holding) throw new UserError("This investment no longer exists.");

  // Inside a transaction a duplicate-key error aborts it, so look first.
  const dup = await invTxnsCollection().findOne(
    { userId, $or: [{ requestId }, ...(input.sipFor ? [{ holdingId: hid, sipFor: input.sipFor }] : [])] },
    { session, projection: { _id: 1 } },
  );
  if (dup) return "duplicate";

  if (input.type === "SELL") {
    // Validate against the full history, including this sale.
    const existing = await listInvTxns(userId, holdingId, session);
    try {
      computeHolding([...existing, { ...input, id: "zzzz-new", holdingId }], null);
    } catch (e) {
      if (e instanceof HoldingError) throw new UserError(e.message);
      throw e;
    }
  }

  // Claim the holding: concurrent trade writes conflict here.
  const claimed = await holdingsCollection().updateOne(
    { _id: hid, userId, archivedAt: null, txnSeq: seqCond(holding.txnSeq) },
    { $inc: { txnSeq: 1 }, $set: { updatedAt: new Date() } },
    { session },
  );
  if (claimed.matchedCount !== 1) throw new UserError("This investment changed while saving. Please try again.");

  try {
    await invTxnsCollection().insertOne(
      {
        _id: new ObjectId(),
        userId,
        holdingId: hid,
        ...input,
        requestId,
        createdAt: new Date(),
      },
      { session },
    );
    return "added";
  } catch (e) {
    if (!session && isDuplicateKey(e)) return "duplicate";
    throw e;
  }
}

/**
 * Delete one investment transaction (to correct a mistake). Refused when the
 * remaining history would become invalid (e.g. a later sale needs these units).
 */
export async function deleteInvTxn(userId: string, txnId: string): Promise<boolean> {
  const _id = toObjectId(txnId);
  if (!_id) return false;
  return runInTransaction(async (session) => {
    const doc = await invTxnsCollection().findOne({ _id, userId }, { session });
    if (!doc) return false;
    const rest = (await listInvTxns(userId, doc.holdingId.toHexString(), session)).filter((t) => t.id !== txnId);
    try {
      computeHolding(rest, null);
    } catch (e) {
      if (e instanceof HoldingError) throw new UserError("Can't delete this: a later sale depends on these units.");
      throw e;
    }
    // Same claim as a new trade, so a delete and a concurrent sale can't both pass validation.
    const holding = await holdingsCollection().findOne({ _id: doc.holdingId, userId }, { session, projection: { txnSeq: 1 } });
    if (holding) {
      await holdingsCollection().updateOne({ _id: doc.holdingId, userId, txnSeq: seqCond(holding.txnSeq) }, { $inc: { txnSeq: 1 } }, { session });
    }
    const res = await invTxnsCollection().deleteOne({ _id, userId }, { session });
    return res.deletedCount === 1;
  });
}

/** Find a holding created by an import, or create it (inside the caller's transaction). */
export async function findOrCreateImportedHolding(
  userId: string,
  importKey: string,
  init: { type: AssetType; name: string; symbol: string },
  session: ClientSession | undefined,
): Promise<string> {
  const existing = await holdingsCollection().findOne({ userId, importKey }, { session, projection: { _id: 1, archivedAt: 1 } });
  if (existing) {
    // An archived import holding comes back when new trades arrive for it.
    if (existing.archivedAt) await holdingsCollection().updateOne({ _id: existing._id, userId }, { $set: { archivedAt: null, updatedAt: new Date() } }, { session });
    return existing._id.toHexString();
  }
  const now = new Date();
  const res = await holdingsCollection().insertOne(
    {
      _id: new ObjectId(),
      userId,
      type: init.type,
      name: init.name,
      symbol: init.symbol,
      provider: null,
      providerKey: null,
      sip: null,
      gold: null,
      manualPrice: null,
      notes: "Created by a simulated Groww import.",
      archivedAt: null,
      txnSeq: 0,
      importKey,
      createdAt: now,
      updatedAt: now,
    },
    { session },
  );
  return res.insertedId.toHexString();
}
