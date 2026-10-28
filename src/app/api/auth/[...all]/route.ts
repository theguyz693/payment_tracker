import { getAuth } from "@/server/auth";
import { ensureIndexes } from "@/server/models";

async function handler(request: Request) {
  await ensureIndexes();
  return getAuth().handler(request);
}

export { handler as GET, handler as POST };
