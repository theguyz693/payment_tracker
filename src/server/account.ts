// Whole-account operations: deleting every record a user owns.
// Called from Better Auth's deleteUser.beforeDelete hook, so it runs only
// after Better Auth has verified the session and the password.

import "server-only";
import { goalsCollection, holdingsCollection, invTxnsCollection, loansCollection, settingsCollection, transactionsCollection } from "./models";

/** Delete all app data for one user. Auth data (user, account, session) is removed by Better Auth. */
export async function deleteAllUserData(userId: string): Promise<Record<string, number>> {
  if (!userId) throw new Error("deleteAllUserData needs a userId");
  const filter = { userId };
  const [transactions, goals, loans, holdings, investmentTxns, userSettings] = await Promise.all([
    transactionsCollection().deleteMany(filter),
    goalsCollection().deleteMany(filter),
    loansCollection().deleteMany(filter),
    holdingsCollection().deleteMany(filter),
    invTxnsCollection().deleteMany(filter),
    settingsCollection().deleteMany(filter),
  ]);
  return {
    transactions: transactions.deletedCount,
    goals: goals.deletedCount,
    loans: loans.deletedCount,
    holdings: holdings.deletedCount,
    investmentTxns: investmentTxns.deletedCount,
    userSettings: userSettings.deletedCount,
  };
}
