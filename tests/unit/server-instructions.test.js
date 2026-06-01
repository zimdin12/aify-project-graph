import { describe, it, expect } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../mcp/stdio/server-instructions.js';

describe('SERVER_INSTRUCTIONS front door', () => {
  it('names graph_packet as the first move for understand-X questions', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/graph_packet/);
    expect(SERVER_INSTRUCTIONS).toMatch(/ONE graph_packet|first move|prefer it over chaining/i);
  });
  it('includes an honest KNOWN LIMITS section', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/KNOWN LIMITS/);
    expect(SERVER_INSTRUCTIONS).toMatch(/dynamic dispatch|function-pointer|script callback|std::function/i);
  });
  it('stays tight (<= ~72 lines) so it fits the system prompt budget', () => {
    expect(SERVER_INSTRUCTIONS.split('\n').length).toBeLessThanOrEqual(72);
  });
});
