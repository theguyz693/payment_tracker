import { describe, expect, it } from "vitest";
import { signDelivery, verifyDelivery } from "./signature";

describe("webhook delivery signatures", () => {
  const body = JSON.stringify({ id: "gpay_evt_abc123", amount: "1500.00" });
  const ts = 1_800_000_000;

  it("accepts a correctly signed, fresh delivery", () => {
    expect(verifyDelivery(body, String(ts), signDelivery(body, ts), ts + 10)).toBe("ok");
  });

  it("rejects a tampered body, a wrong signature or missing headers", () => {
    const sig = signDelivery(body, ts);
    expect(verifyDelivery(body.replace("1500", "9500"), String(ts), sig, ts)).toBe("invalid_signature");
    expect(verifyDelivery(body, String(ts), "0".repeat(64), ts)).toBe("invalid_signature");
    expect(verifyDelivery(body, null, sig, ts)).toBe("invalid_signature");
    expect(verifyDelivery(body, String(ts), null, ts)).toBe("invalid_signature");
    // A signature for a different timestamp doesn't transfer.
    expect(verifyDelivery(body, String(ts + 1), sig, ts)).toBe("invalid_signature");
  });

  it("rejects replays outside the five-minute window", () => {
    expect(verifyDelivery(body, String(ts), signDelivery(body, ts), ts + 301)).toBe("stale_timestamp");
    expect(verifyDelivery(body, String(ts), signDelivery(body, ts), ts - 301)).toBe("stale_timestamp");
  });
});
