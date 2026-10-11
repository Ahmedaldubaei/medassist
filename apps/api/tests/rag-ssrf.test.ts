import { describe, expect, it } from 'vitest';
import { isBlockedIp, assertPublicUrl } from '../src/rag/ingest.js';

describe('SSRF guard (P6)', () => {
  it('blocks private IPv4 ranges', () => {
    for (const ip of [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '224.0.0.1',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('blocks IPv6 loopback/link-local/unique-local', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true); // v4-mapped
  });

  it('allows public IPs', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.167.1.1']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it('assertPublicUrl rejects non-http(s) protocols', async () => {
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow(/unsupported protocol/);
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/unsupported protocol/);
  });

  it('assertPublicUrl rejects localhost (resolves to loopback)', async () => {
    await expect(assertPublicUrl('http://localhost:3000/x')).rejects.toThrow(/blocked private\/internal host/);
    await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toThrow(/blocked private\/internal host/);
  });
});
