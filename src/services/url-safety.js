import dns from 'node:dns';

const IPV4_PRIVATE_RANGES = [
  { base: '10.0.0.0', bits: 8 },
  { base: '172.16.0.0', bits: 12 },
  { base: '192.168.0.0', bits: 16 },
  { base: '127.0.0.0', bits: 8 },
  { base: '169.254.0.0', bits: 16 },
];

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4InRange(ip, base, bits) {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isPrivateIpv4(ip) {
  return IPV4_PRIVATE_RANGES.some(({ base, bits }) => isIpv4InRange(ip, base, bits));
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 address — check the embedded IPv4 address
    const mapped = normalized.slice('::ffff:'.length);
    return isPrivateIpv4(mapped);
  }
  return false;
}

export function isPrivateOrReservedAddress(address, family) {
  if (family === 6) return isPrivateIpv6(address);
  return isPrivateIpv4(address);
}

/**
 * Resolves the hostname of `urlString` and returns false ONLY if it resolves
 * to a private/loopback/link-local/metadata address (FR-019) — that is the
 * one thing this function blocks. A hostname that fails to resolve at all
 * (e.g. NXDOMAIN) is NOT considered unsafe by this check: that is a normal
 * connection failure, left to the poller's own fetch to surface as "down"
 * (FR-007/FR-008), not a private-address policy violation. A malformed URL
 * also returns true here for the same reason — URL syntax validation is a
 * separate concern (FR-005), already enforced before this is called.
 */
export async function isSafeToFetch(urlString) {
  let hostname;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return true;
  }

  let result;
  try {
    result = await dns.promises.lookup(hostname);
  } catch {
    return true;
  }

  return !isPrivateOrReservedAddress(result.address, result.family);
}
