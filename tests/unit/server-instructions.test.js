import { describe, it, expect } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../mcp/stdio/server-instructions.js';

describe('SERVER_INSTRUCTIONS front door', () => {
  it('names graph_packet as the first move for understand-X questions', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/graph_packet/);
    expect(SERVER_INSTRUCTIONS).toMatch(/ONE graph_packet|first move|prefer it over chaining/i);
  });
  it('tells deferred/managed sessions to ToolSearch to load the verbs (discoverability)', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/DISCOVERABILITY/);
    expect(SERVER_INSTRUCTIONS).toMatch(/ToolSearch/);
  });
  it('includes an honest KNOWN LIMITS section', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/KNOWN LIMITS/);
    expect(SERVER_INSTRUCTIONS).toMatch(/dynamic dispatch|function-pointer|script callback|std::function/i);
  });
  it('includes a FRESHNESS self-refresh rule', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/FRESHNESS/);
    expect(SERVER_INSTRUCTIONS).toMatch(/graph_index|APG_AUTO_REINDEX/);
    expect(SERVER_INSTRUCTIONS).toMatch(/not proof a symbol|stale .*not.*proof/i);
  });
  it('stays tight (<= ~84 lines) so it fits the system prompt budget', () => {
    expect(SERVER_INSTRUCTIONS.split('\n').length).toBeLessThanOrEqual(84);
  });
});
