import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
    debugLargeJson: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib', () => ({
  logger: {
    debug: vi.fn(),
    debugLargeJson: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { PermissionHandler } from './permissionHandler';

type PermissionRpcResponse = {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  answers?: Record<string, string>;
};

describe('PermissionHandler AskUserQuestion', () => {
  let agentState: any;
  let permissionRpcHandler: ((response: PermissionRpcResponse) => Promise<void>) | undefined;
  let session: any;
  const input = {
    questions: [{
      header: 'Scope',
      question: '本次任务的 scope 怎么定？',
      options: [{ label: '先跟我说说 当前任务要做什么事', description: '' }],
      multiSelect: false,
    }],
  };

  beforeEach(() => {
    agentState = {};
    permissionRpcHandler = undefined;
    session = {
      path: '/tmp/happy-permission-test',
      queue: { unshift: vi.fn() },
      api: { push: () => ({ sendToAllDevices: vi.fn() }) },
      client: {
        sessionId: 'session-1',
        rpcHandlerManager: {
          registerHandler: vi.fn((name: string, handler: (response: PermissionRpcResponse) => Promise<void>) => {
            if (name === 'permission') permissionRpcHandler = handler;
          }),
        },
        updateAgentState: vi.fn((updater: (state: any) => any) => {
          agentState = updater(agentState);
        }),
      },
    };
  });

  it('returns AskUserQuestion answers through the permission result instead of only mutating tool input', async () => {
    const handler = new PermissionHandler(session);
    handler.onMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool-ask-1', name: 'AskUserQuestion', input }],
      },
    } as any);

    const pending = handler.handleToolCall('AskUserQuestion', input, 'default' as any, {
      signal: new AbortController().signal,
    });

    expect(permissionRpcHandler).toBeDefined();
    await permissionRpcHandler!({
      id: 'tool-ask-1',
      approved: true,
      answers: { Scope: '先跟我说说 当前任务要做什么事' },
    });

    await expect(pending).resolves.toEqual({
      behavior: 'deny',
      message: '我的选择是：\n- Scope：先跟我说说 当前任务要做什么事\n\n请根据以上选择继续。',
    });
    expect(agentState.completedRequests?.['tool-ask-1']).toMatchObject({
      status: 'approved',
      answers: { Scope: '先跟我说说 当前任务要做什么事' },
    });
  });

  it('approves already-pending non-interactive requests when bypassPermissions is selected', async () => {
    const handler = new PermissionHandler(session);
    const firstInput = { id: 347 };
    const secondInput = { command: 'pwd' };
    handler.onMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-note-1', name: 'mcp__it_note__get_node', input: firstInput },
          { type: 'tool_use', id: 'tool-bash-1', name: 'Bash', input: secondInput },
        ],
      },
    } as any);

    const firstPending = handler.handleToolCall('mcp__it_note__get_node', firstInput, 'default' as any, {
      signal: new AbortController().signal,
    });
    const secondPending = handler.handleToolCall('Bash', secondInput, 'default' as any, {
      signal: new AbortController().signal,
    });

    expect(agentState.requests?.['tool-note-1']).toBeDefined();
    expect(agentState.requests?.['tool-bash-1']).toBeDefined();
    expect(permissionRpcHandler).toBeDefined();

    await permissionRpcHandler!({
      id: 'tool-note-1',
      approved: true,
      mode: 'bypassPermissions',
    });

    await expect(firstPending).resolves.toEqual({
      behavior: 'allow',
      updatedInput: firstInput,
    });
    await expect(secondPending).resolves.toEqual({
      behavior: 'allow',
      updatedInput: secondInput,
    });
    expect(agentState.requests?.['tool-note-1']).toBeUndefined();
    expect(agentState.requests?.['tool-bash-1']).toBeUndefined();
    expect(agentState.completedRequests?.['tool-note-1']).toMatchObject({
      status: 'approved',
      mode: 'bypassPermissions',
    });
    expect(agentState.completedRequests?.['tool-bash-1']).toMatchObject({
      status: 'approved',
      mode: 'bypassPermissions',
    });
  });
});
