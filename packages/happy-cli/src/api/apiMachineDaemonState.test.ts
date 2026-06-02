import { describe, expect, it } from 'vitest';
import { buildRunningDaemonState } from './apiMachineDaemonState';

describe('buildRunningDaemonState', () => {
  it('uses the current control-server port instead of stale server daemonState', () => {
    expect(buildRunningDaemonState(
      { status: 'shutting-down', pid: 111, httpPort: 45171, startedAt: 1, shutdownRequestedAt: 2, shutdownSource: 'cli' },
      { status: 'offline', pid: 222, httpPort: 35279, startedAt: 3 },
      { pid: 333, now: 4 },
    )).toEqual({
      status: 'running',
      pid: 333,
      httpPort: 35279,
      startedAt: 3,
    });
  });

  it('falls back to previous port only when no current runtime port exists', () => {
    expect(buildRunningDaemonState(
      { status: 'running', pid: 111, httpPort: 45171, startedAt: 1 },
      null,
      { pid: 333, now: 4 },
    )).toEqual({
      status: 'running',
      pid: 333,
      httpPort: 45171,
      startedAt: 4,
    });
  });
});
