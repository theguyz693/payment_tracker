// Which databases the development seed may write to (kept separate so it can be unit-tested).

/** Only *_dev / *_test databases, or one named explicitly with --allow-db=<name>. */
export function seedAllowed(dbName: string, args: string[]): boolean {
  if (/_(dev|test)$/.test(dbName)) return true;
  return args.includes(`--allow-db=${dbName}`);
}
