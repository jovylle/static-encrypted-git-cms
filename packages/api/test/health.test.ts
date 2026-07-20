import { describe, it, expect } from 'vitest';
import { handleHealth } from '../src/routes/health';

describe('Health endpoint', () => {
  it('returns ok status', async () => {
    const response = handleHealth();
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      timestamp: string;
      version: string;
    };
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.version).toBe('1.0.0');
  });
});
