/**
 * Happy MCP STDIO Bridge
 *
 * Minimal STDIO MCP server exposing Happy tools
 * (`change_title`, `preview_html`, `orchestrator_*`).
 * On invocation it forwards tool calls to an existing Happy HTTP MCP server
 * using the StreamableHTTPClientTransport.
 *
 * Configure the target HTTP MCP URL via env var `HAPPY_HTTP_MCP_URL` or
 * via CLI flag `--url <http://127.0.0.1:PORT>`.
 *
 * Note: This process must not print to stdout as it would break MCP STDIO.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { shouldEnableOrchestratorTools } from '@/orchestrator/prompt';
import {
  ORCHESTRATOR_CANCEL_TOOL_SCHEMA,
  ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA,
  ORCHESTRATOR_LIST_TOOL_SCHEMA,
  ORCHESTRATOR_PEND_TOOL_SCHEMA,
  ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA,
  ORCHESTRATOR_SUBMIT_TOOL_SCHEMA,
} from '@/orchestrator/mcpToolSchemas';

function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && i + 1 < argv.length) {
      url = argv[i + 1];
      i++;
    }
  }
  return { url };
}

async function main() {
  // Resolve target HTTP MCP URL
  const { url: urlFromArgs } = parseArgs(process.argv.slice(2));
  const baseUrl = urlFromArgs || process.env.HAPPY_HTTP_MCP_URL || '';

  if (!baseUrl) {
    // Write to stderr; never stdout.
    process.stderr.write(
      '[happy-mcp] Missing target URL. Set HAPPY_HTTP_MCP_URL or pass --url <http://127.0.0.1:PORT>\n'
    );
    process.exit(2);
  }

  let httpClient: Client | null = null;

  async function ensureHttpClient(): Promise<Client> {
    if (httpClient) return httpClient;
    const client = new Client(
      { name: 'happy-stdio-bridge', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    await client.connect(transport);
    httpClient = client;
    return client;
  }

  // Create STDIO MCP server
  const server = new McpServer({
    name: 'Happy MCP Bridge',
    version: '1.0.0',
  });
  const enableOrchestratorTools = shouldEnableOrchestratorTools();

  // Helper to register a tool that forwards calls to the HTTP MCP server
  function registerForwardedTool(
    name: string,
    opts: { description: string; title: string; inputSchema: Record<string, z.ZodType> },
  ) {
    server.registerTool(name, opts, async (args) => {
      try {
        const client = await ensureHttpClient();
        const response = await client.callTool({ name, arguments: args });
        return response as any;
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `Failed to call ${name}: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    });
  }

  registerForwardedTool('change_title', {
    description: 'Change the title of the current chat session',
    title: 'Change Chat Title',
    inputSchema: {
      title: z.string().describe('The new title for the chat session'),
    },
  });

  registerForwardedTool('preview_html', {
    description: 'Preview an HTML page in the client app. The HTML must be a complete, self-contained document with all CSS and JS inlined.',
    title: 'Preview HTML',
    inputSchema: {
      html: z.string().describe('Complete self-contained HTML document string'),
      title: z.string().optional().describe('Display title for the preview'),
    },
  });

  registerForwardedTool('submit_bug', {
    description: 'File a bug report on the user\'s Happy bug board. Use when the user asks to report or file a bug. '
      + 'Write the description yourself from the conversation: what went wrong, what was expected, and the steps to reproduce it.',
    title: 'Submit Bug',
    inputSchema: {
      description: z.string().describe('What went wrong, what was expected, and how to reproduce it. The title is derived from the first line.'),
      visibility: z.enum(['shared', 'private']).optional().describe('shared (default) puts it on the shared board; private keeps it to the owner'),
      images: z.array(z.string()).optional().describe('Absolute paths to screenshots on this machine. JPEG and PNG only, up to 10 images, 20MB each.'),
    },
  });

  registerForwardedTool('edit_bug', {
    description: 'Change a bug already on the user\'s Happy bug board: rewrite its description, add screenshots to it, or both. '
      + 'Use when the user wants to correct, expand or illustrate an existing bug.',
    title: 'Edit Bug',
    inputSchema: {
      bug: z.string().describe('Which bug, as the user refers to it: "BUG-236", "#236" or "236". An internal bug id also works.'),
      description: z.string().optional().describe('The full replacement description. It replaces the old one outright, so carry over anything still true. Omit to leave the description alone.'),
      images: z.array(z.string()).optional().describe('Absolute paths to screenshots on this machine, added to any already on the bug. JPEG and PNG only, 10 per bug in total, 20MB each.'),
    },
  });

  registerForwardedTool('delete_bug', {
    description: 'Remove a bug from the user\'s Happy bug board. The server keeps the row and hides it, so this can be undone by an admin, but it disappears from the board immediately.',
    title: 'Delete Bug',
    inputSchema: {
      bug: z.string().describe('Which bug, as the user refers to it: "BUG-236", "#236" or "236". An internal bug id also works.'),
    },
  });

  if (enableOrchestratorTools) {
    registerForwardedTool('orchestrator_get_context', ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_submit', ORCHESTRATOR_SUBMIT_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_pend', ORCHESTRATOR_PEND_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_list', ORCHESTRATOR_LIST_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_cancel', ORCHESTRATOR_CANCEL_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_send_message', ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA);
  }

  // Start STDIO transport
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

// Start and surface fatal errors to stderr only
main().catch((err) => {
  try {
    process.stderr.write(`[happy-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    process.exit(1);
  }
});
