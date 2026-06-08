import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';

describe('getLocalIP', () => {
  beforeEach(() => vi.resetModules());

  it('returns the first non-internal IPv4 address', async () => {
    vi.doMock('os', () => ({
      default: {
        networkInterfaces: () => ({
          lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
          en0: [
            { family: 'IPv6', address: 'fe80::1', internal: false },
            { family: 'IPv4', address: '192.168.1.42', internal: false },
          ],
        }),
      },
    }));
    const { getLocalIP } = await import('../lib/network.js');
    expect(getLocalIP()).toBe('192.168.1.42');
  });

  it('falls back to 127.0.0.1 when no external interface exists', async () => {
    vi.doMock('os', () => ({
      default: {
        networkInterfaces: () => ({
          lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
        }),
      },
    }));
    const { getLocalIP } = await import('../lib/network.js');
    expect(getLocalIP()).toBe('127.0.0.1');
  });
});
