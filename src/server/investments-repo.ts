// Data access for investment holdings and their transactions.
//
// SECURITY: every function takes the authenticated `userId` first and
// includes it in every filter.
// Integrity: each investment transaction is its own document with a unique
// (userId, requestId); SIP instalments are also unique per (holding, sipFor),
// so a refresh or double-click never records the same contribution twice.
// A sale is validated by replaying the holding's history (FIFO) with the new
// sale included before it's written.

import "server-only";
import { ObjectId } from "mongodb";
import { computeHolding, HoldingError, type AssetType, type GoldDetails, type InvTxn, type InvTxnType, type SipPlan, type SipStatus } from "@/lib/portfolio";
import type { ISODate } from "@/lib/types";
import { holdingsCollection, invTxnsCollection, isDuplicateKey, type HoldingDoc, type InvTxnDoc, type PriceProvider } from "./models";
import { UserError } from "./repository";

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
export async function listInvTxns(userId: string, holdingId?: string): Promise<InvTxn[]> {
  const filter: Record<string, unknown> = { userId };
  if (holdingId) {
    const _id = toObjectId(holdingId);
    if (!_id) return [];
    filter.holdingId = _id;
  }
  return (await invTxnsCollection().find(filter).sort({ date: 1, _id: 1 }).toArray()).map(toTxn);
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

/** Record a buy/sell/dividend. Returns "duplicate" when this exact submit (or SIP date) was already recorded. */
export async function addInvTxn(userId: string, holdingId: string, input: InvTxnInput, requestId: string): Promise<"added" | "duplicate"> {
  const hid = toObjectId(holdingId);
  const holding = hid ? await holdingsCollection().findOne({ _id: hid, userId, archivedAt: null }) : null;
  if (!hid || !holding) throw new UserError("This investment no longer exists.");

  if (input.type === "SELL") {
    // Validate against the full history, including this sale.
    const existing = await listInvTxns(userId, holdingId);
    try {
      computeHolding([...existing, { ...input, id: "zzzz-new", holdingId }], null);
    } catch (e) {
      if (e instanceof HoldingError) throw new UserError(e.message);
      throw e;
    }
  }

  try {
    await invTxnsCollection().insertOne({
      _id: new ObjectId(),
      userId,
      holdingId: hid,
      ...input,
      requestId,
      createdAt: new Date(),
    });
    return "added";
  } catch (e) {
    if (isDuplicateKey(e)) return "duplicate";
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
  const doc = await invTxnsCollection().findOne({ _id, userId });
  if (!doc) return false;
  const rest = (await listInvTxns(userId, doc.holdingId.toHexString())).filter((t) => t.id !== txnId);
  try {
    computeHolding(rest, null);
  } catch (e) {
    if (e instanceof HoldingError) throw new UserError("Can't delete this: a later sale depends on these units.");
    throw e;
  }
  const res = await invTxnsCollection().deleteOne({ _id, userId });
  return res.deletedCount === 1;
}
