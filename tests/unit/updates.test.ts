import { describe, expect, it } from 'vitest';
import { compareVersions } from '../../src/app/updates';

describe('compareVersions', () => {
  it('orders semantic versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('v1.1.0', '1.1.0')).toBe(0);
    expect(compareVersions('1.1', '1.1.1')).toBe(-1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });
});
