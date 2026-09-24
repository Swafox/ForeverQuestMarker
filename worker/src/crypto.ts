const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(text)),
  );
}

/** Compares two secrets without leaking their length or common prefix through timing. */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

function expandIpv6(address: string): string[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ];
  return groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? groups : null;
}

/**
 * The part of a client address that identifies one network: the IPv4 address,
 * or the /64 prefix of an IPv6 address (a single subscriber usually controls a
 * whole /64, so counting full IPv6 addresses would let one person look like many).
 */
export function networkKey(ip: string): string {
  const address = ip.trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return address;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1]!;
  const groups = expandIpv6(address.replace(/%.*$/, ""));
  if (!groups) return address;
  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":")}::/64`;
}

/** Keyed hash of the client's network; the raw address is never stored. */
export async function hashNetwork(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(networkKey(ip)),
  );
  return toHex(signature).slice(0, 32);
}
