import { describe, expect, test } from "bun:test";
import { hashNetwork, networkKey, timingSafeEqual } from "../src/crypto";

describe("networkKey", () => {
  test("keeps IPv4 addresses and unwraps IPv4-mapped IPv6", () => {
    expect(networkKey("203.0.113.7")).toBe("203.0.113.7");
    expect(networkKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("reduces IPv6 addresses to their /64 prefix", () => {
    expect(networkKey("2001:db8:abcd:12::1")).toBe("2001:0db8:abcd:0012::/64");
    expect(networkKey("2001:DB8:ABCD:12:ffff:ffff:ffff:ffff")).toBe(
      "2001:0db8:abcd:0012::/64",
    );
    expect(networkKey("2001:db8::")).toBe("2001:0db8:0000:0000::/64");
    expect(networkKey("::1")).toBe("0000:0000:0000:0000::/64");
    expect(networkKey("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
  });

  test("passes through anything it cannot parse", () => {
    expect(networkKey("unknown")).toBe("unknown");
    expect(networkKey("1:2:3")).toBe("1:2:3");
  });
});

describe("hashNetwork", () => {
  const salt = "a-test-salt-that-is-long-enough";

  test("is stable, salted and never contains the address", async () => {
    const hash = await hashNetwork("203.0.113.7", salt);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashNetwork("203.0.113.7", salt)).toBe(hash);
    expect(await hashNetwork("203.0.113.7", `${salt}2`)).not.toBe(hash);
    expect(await hashNetwork("203.0.113.8", salt)).not.toBe(hash);
  });

  test("gives one IPv6 subscriber a single identity", async () => {
    expect(await hashNetwork("2001:db8:1:2::10", salt)).toBe(
      await hashNetwork("2001:db8:1:2:aaaa::99", salt),
    );
    expect(await hashNetwork("2001:db8:1:2::10", salt)).not.toBe(
      await hashNetwork("2001:db8:1:3::10", salt),
    );
  });
});

describe("timingSafeEqual", () => {
  test("compares values of any length", async () => {
    expect(await timingSafeEqual("secret-token", "secret-token")).toBe(true);
    expect(await timingSafeEqual("secret-token", "secret-tokem")).toBe(false);
    expect(await timingSafeEqual("secret-token", "secret")).toBe(false);
    expect(await timingSafeEqual("", "")).toBe(true);
  });
});
