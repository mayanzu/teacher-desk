import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcademicSync } from './useAcademicSync';

const startPayload = {
  status: 'waiting',
  session: 'session-1234567890abcdef',
  qrCode: 'qr-1234567890abcdef',
  expiresIn: 300,
};

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('useAcademicSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries failing status polls with backoff before reporting an error', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/slu/qr/start')) return jsonResponse(startPayload);
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAcademicSync({ onImported: vi.fn() }));

    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe('waiting');
    expect(result.current.qrCodeValue).toBe(startPayload.qrCode);

    await act(async () => { await vi.advanceTimersByTimeAsync(1200 + 1500 + 3000 + 6000); });

    expect(result.current.status).toBe('error');
    expect(result.current.qrCodeValue).toBe('');
  });

  it('expires the session once expiresIn has elapsed and clears the code', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/slu/qr/start')) return jsonResponse({ ...startPayload, expiresIn: 1 });
      return jsonResponse({ status: 'waiting' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAcademicSync({ onImported: vi.fn() }));

    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe('waiting');

    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

    expect(result.current.status).toBe('expired');
    expect(result.current.qrCodeValue).toBe('');
  });
});
