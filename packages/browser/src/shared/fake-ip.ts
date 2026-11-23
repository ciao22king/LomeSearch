/**
 * Decoy forwarding headers.
 *
 * A connection's source address is chosen by the kernel: no browser can change
 * it. What this feature does is send the usual proxy headers with a reserved
 * documentation address, so a server that trusts those headers logs that
 * address instead of guessing. Servers that look at the real socket, and every
 * hop in between, still see the true address. It is a decoy, not a proxy.
 *
 * Addresses come from the RFC 5737 documentation ranges so a fake value can
 * never point at a real host.
 */

export const DOCUMENTATION_PREFIXES = ['192.0.2', '198.51.100', '203.0.113'] as const;

export const FAKE_IP_HEADERS = [
  'X-Forwarded-For',
  'X-Real-IP',
  'Client-IP',
  'X-Client-IP',
] as const;

export function isValidFakeAddress(value: string): boolean {
  const address = value.trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    return address.split('.').every((part) => Number(part) <= 255);
  }
  return /^[0-9a-f:]+$/i.test(address) && address.includes(':') && address.length <= 45;
}

/** A fixed address when it validates, otherwise a random documentation address. */
export function pickFakeAddress(custom = '', random: () => number = Math.random): string {
  const trimmed = custom.trim();
  if (trimmed && isValidFakeAddress(trimmed)) return trimmed;
  const prefix = DOCUMENTATION_PREFIXES[Math.floor(random() * DOCUMENTATION_PREFIXES.length)]!;
  return `${prefix}.${1 + Math.floor(random() * 254)}`;
}

export function applyFakeIpHeaders(
  headers: Record<string, string | string[]>,
  address: string,
): void {
  for (const name of FAKE_IP_HEADERS) headers[name] = address;
  headers['Forwarded'] = `for=${address.includes(':') ? `"[${address}]"` : address}`;
}
