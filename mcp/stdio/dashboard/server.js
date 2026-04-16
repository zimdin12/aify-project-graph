import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

export function startDashboard({ db, port = 0 }) {
  const server = http.createServer(async (req, res) => {
    // API routes
    if (req.url === '/api/graph') {
      const nodes = db.all('SELECT * FROM nodes LIMIT 5000');
      const edges = db.all('SELECT * FROM edges LIMIT 10000');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ nodes, edges }));
      return;
    }

    if (req.url === '/api/stats') {
      const nodeCount = db.get('SELECT count(*) AS c FROM nodes').c;
      const edgeCount = db.get('SELECT count(*) AS c FROM edges').c;
      const types = db.all('SELECT type, count(*) AS c FROM nodes GROUP BY type ORDER BY c DESC');
      const relations = db.all('SELECT relation, count(*) AS c FROM edges GROUP BY relation ORDER BY c DESC');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ nodeCount, edgeCount, types, relations }));
      return;
    }

    if (req.url?.startsWith('/api/search?')) {
      const url = new URL(req.url, `http://localhost`);
      const q = url.searchParams.get('q') || '';
      const results = db.all(
        'SELECT * FROM nodes WHERE label LIKE $q LIMIT 20',
        { q: `%${q}%` }
      );
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(results));
      return;
    }

    if (req.url?.startsWith('/api/node/')) {
      const id = decodeURIComponent(req.url.slice('/api/node/'.length));
      const node = db.get('SELECT * FROM nodes WHERE id = $id', { id });
      const incoming = db.all('SELECT * FROM edges WHERE to_id = $id LIMIT 20', { id });
      const outgoing = db.all('SELECT * FROM edges WHERE from_id = $id LIMIT 20', { id });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ node, incoming, outgoing }));
      return;
    }

    // Static files — serve the SPA
    let filePath = req.url === '/' ? '/index.html' : req.url;
    try {
      const content = await readFile(join(__dirname, 'static', filePath));
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(content);
    } catch {
      // Fallback to index.html for SPA routing
      try {
        const content = await readFile(join(__dirname, 'static', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({ url, server, port: addr.port });
    });
  });
}
