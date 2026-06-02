import type { DaemonState } from './types';

export function buildRunningDaemonState(
  previousState: DaemonState | null,
  currentRuntimeState: DaemonState | null | undefined,
  opts: { pid?: number; now?: number } = {},
): DaemonState {
  const currentHttpPort = currentRuntimeState?.httpPort;
  const currentStartedAt = currentRuntimeState?.startedAt;
  const next: DaemonState = {
    ...(previousState ?? {}),
    status: 'running',
    pid: opts.pid ?? process.pid,
    httpPort: currentHttpPort ?? previousState?.httpPort,
    startedAt: currentStartedAt ?? opts.now ?? Date.now(),
  };

  delete next.shutdownRequestedAt;
  delete next.shutdownSource;

  return next;
}
