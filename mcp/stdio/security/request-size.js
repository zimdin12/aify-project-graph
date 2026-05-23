// Plan #21 — request-size cap for the MCP JSON-RPC handler.
//
// Mirrors codegraph commit 7340892's MCP input-size validation. The
// JSON-RPC handler reads one line at a time from stdin and JSON.parses
// it; a malicious or runaway client could send an arbitrary-length
// line and force a giant string allocation + parse before we even
// know what tool is being called.
//
// Per senior-dev's lock: ~256KB cap, return a JSON-RPC structured
// error envelope on overflow — never process.exit.

export const MAX_MCP_LINE_BYTES = 256 * 1024;

/**
 * Validate an incoming MCP request line. Returns null when the line
 * is within bounds (caller proceeds to JSON.parse), or a JSON-RPC
 * error envelope ready to send back when oversize.
 *
 * @param {string} line - the raw stdin line (not yet parsed)
 * @returns {object | null}
 */
export function checkRequestSize(line) {
  if (typeof line !== 'string') return null;
  // Buffer.byteLength is the correct measure for stdin bytes; line.length
  // is character count and would under-count multi-byte UTF-8 input.
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes <= MAX_MCP_LINE_BYTES) return null;
  return {
    jsonrpc: '2.0',
    // id:null is JSON-RPC §5.1's "couldn't parse the id" convention.
    // We can't safely read the id out of an oversize body; some line
    // shapes (e.g. an unterminated JSON array) would still parse for
    // the id but the safer move is to refuse before the parse.
    id: null,
    error: {
      code: -32600,
      message: `Invalid Request: line exceeds ${MAX_MCP_LINE_BYTES} bytes (got ${bytes})`,
      data: { maxBytes: MAX_MCP_LINE_BYTES, observedBytes: bytes },
    },
  };
}
