import { createServer } from 'node:http';
import { once } from 'node:events';

// Public, local-only fixture. No Docker daemon or external model is contacted.
export async function startMcpFixture(exerciseTool = false) {
  const calls: string[] = [],
    modelRequests: unknown[] = [];
  const secret = 'test-only-mcp-gateway-key';
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (req.url === '/responses') {
      modelRequests.push(request);
      const message = {
        id: 'message-' + modelRequests.length,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'LOCAL_FIXTURE_REPLY', annotations: [] }],
      };
      const output =
        exerciseTool && modelRequests.length === 2
          ? {
              type: 'custom_tool_call',
              id: 'mcp-exec-item',
              call_id: 'mcp-exec-call',
              name: 'exec',
              namespace: 'functions',
              input:
                'const tool = ALL_TOOLS.find(entry => entry.name.endsWith("__demo_echo")); if (!tool) throw new Error("Local MCP fixture tool is not available"); text(await tools[tool.name]({text:"NATIVE_MCP_PROBE"}));',
            }
          : message;
      const response = {
        id: 'response-' + modelRequests.length,
        object: 'response',
        status: 'completed',
        model: 'offline-fixture',
        output: [output],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of [
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item:
            output.type === 'custom_tool_call'
              ? { ...output, input: '' }
              : { ...message, status: 'in_progress', content: [] },
        },
        ...(output.type === 'custom_tool_call'
          ? []
          : [
              {
                type: 'response.output_text.delta',
                item_id: message.id,
                output_index: 0,
                content_index: 0,
                delta: 'LOCAL_FIXTURE_REPLY',
              },
            ]),
        { type: 'response.output_item.done', output_index: 0, item: output },
        { type: 'response.completed', response },
      ])
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.headers.authorization !== 'Bearer ' + secret) {
      res.writeHead(401);
      res.end();
      return;
    }
    calls.push(request.method);
    if (request.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    let result: unknown;
    switch (request.method) {
      case 'initialize':
        result = {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'Docker MCP local acceptance fixture', version: '1.0' },
        };
        break;
      case 'tools/list':
        result = {
          tools: [
            {
              name: 'demo_echo',
              description: 'Public local fixture; does not control Docker.',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
              },
            },
          ],
        };
        break;
      case 'tools/call':
        result = {
          content: [{ type: 'text', text: 'LOCAL_MCP_FIXTURE: ' + request.params.arguments.text }],
        };
        break;
      case 'resources/list':
        result = { resources: [] };
        break;
      case 'resources/templates/list':
        result = { resourceTemplates: [] };
        break;
      default:
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: 'Fixture method not found' },
          }),
        );
        return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture TCP address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    secret,
    calls,
    modelRequests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
