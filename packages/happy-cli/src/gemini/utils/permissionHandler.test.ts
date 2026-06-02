import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
    debugLargeJson: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { GeminiPermissionHandler } from './permissionHandler';

type PermissionRpcResponse = {
  id: string;
  approved: boolean;
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
  mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
};

describe('GeminiPermissionHandler', () => {
  let agentState: any;
  let permissionRpcHandler: ((response: PermissionRpcResponse) => Promise<void>) | undefined;
  let session: any;
  let pushClient: any;

  beforeEach(() => {
    agentState = {};
    permissionRpcHandler = undefined;

    session = {
      sessionId: 'session-1',
      rpcHandlerManager: {
        registerHandler: vi.fn((name: string, handler: (response: PermissionRpcResponse) => Promise<void>) => {
          if (name === 'permission') {
            permissionRpcHandler = handler;
          }
        }),
      },
      updateAgentState: vi.fn((updater: (state: any) => any) => {
        agentState = updater(agentState);
      }),
    };

    pushClient = {
      sendToAllDevices: vi.fn(),
    };
  });

  it('does not write completedRequests when tool is auto-approved in yolo mode', async () => {
    const handler = new GeminiPermissionHandler(session, pushClient);
    handler.setPermissionMode('yolo');

    const result = await handler.handleToolCall('tool-1', 'Bash', { command: 'ls -la' });

    expect(result).toEqual({ decision: 'approved_for_session' });
    expect(session.updateAgentState).not.toHaveBeenCalled();
    expect(agentState.completedRequests).toBeUndefined();
  });

  it('manual approval flow still writes request + completedRequest', async () => {
    const handler = new GeminiPermissionHandler(session, pushClient);
    handler.setPermissionMode('default');

    const pending = handler.handleToolCall('tool-2', 'Bash', { command: 'pwd' });

    expect(session.updateAgentState).toHaveBeenCalledTimes(1);
    expect(agentState.requests?.['tool-2']).toMatchObject({
      tool: 'Bash',
      arguments: { command: 'pwd' },
    });

    expect(permissionRpcHandler).toBeDefined();
    await permissionRpcHandler!({ id: 'tool-2', approved: true, decision: 'approved' });

    await expect(pending).resolves.toEqual({ decision: 'approved' });
    expect(agentState.requests?.['tool-2']).toBeUndefined();
    expect(agentState.completedRequests?.['tool-2']).toMatchObject({
      tool: 'Bash',
      arguments: { command: 'pwd' },
      status: 'approved',
      decision: 'approved',
    });
  });


  it('preserves permission response mode in completed requests for UI selection state', async () => {
    const handler = new GeminiPermissionHandler(session, pushClient);
    handler.setPermissionMode('default');

    const pending = handler.handleToolCall('tool-3', 'Bash', { command: 'whoami' });

    expect(permissionRpcHandler).toBeDefined();
    await permissionRpcHandler!({
      id: 'tool-3',
      approved: true,
      decision: 'approved_for_session',
      mode: 'bypassPermissions',
    });

    await expect(pending).resolves.toEqual({ decision: 'approved_for_session' });
    expect(agentState.completedRequests?.['tool-3']).toMatchObject({
      tool: 'Bash',
      arguments: { command: 'whoami' },
      status: 'approved',
      decision: 'approved_for_session',
      mode: 'bypassPermissions',
    });
  });

  it('approves already-pending requests when allow-all is selected', async () => {
    const handler = new GeminiPermissionHandler(session, pushClient);
    handler.setPermissionMode('default');

    const firstPending = handler.handleToolCall('tool-4', 'read_file', { path: 'a.txt' });
    const secondPending = handler.handleToolCall('tool-5', 'run_shell_command', { command: 'pwd' });

    expect(agentState.requests?.['tool-4']).toBeDefined();
    expect(agentState.requests?.['tool-5']).toBeDefined();
    expect(permissionRpcHandler).toBeDefined();

    await permissionRpcHandler!({
      id: 'tool-4',
      approved: true,
      decision: 'approved_for_session',
      mode: 'bypassPermissions',
    });

    await expect(firstPending).resolves.toEqual({ decision: 'approved_for_session' });
    await expect(secondPending).resolves.toEqual({ decision: 'approved_for_session' });
    expect(agentState.requests?.['tool-4']).toBeUndefined();
    expect(agentState.requests?.['tool-5']).toBeUndefined();
    expect(agentState.completedRequests?.['tool-4']).toMatchObject({
      status: 'approved',
      decision: 'approved_for_session',
      mode: 'bypassPermissions',
    });
    expect(agentState.completedRequests?.['tool-5']).toMatchObject({
      status: 'approved',
      decision: 'approved_for_session',
      mode: 'bypassPermissions',
    });
  });
});
