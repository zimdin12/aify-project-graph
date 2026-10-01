// Read one provider request's answer from the live service. The key is read from the .env and never printed.
import { readFileSync } from 'node:fs';
const key = readFileSync('C:/Docker/aify-dashboard/.env', 'utf8').match(/^\s*API_KEY\s*=\s*(.+?)\s*$/mu)?.[1];
if (!key) { console.error('no API_KEY in the .env'); process.exit(1); }
const id = process.argv[2];
const res = await fetch(`http://127.0.0.1:9700/api/v1/provider/requests/${encodeURIComponent(id)}`, { headers: { 'x-api-key': key, 'x-aify-agent': 'graph-tech-lead' } });
console.log(`${new Date().toISOString()} GET ${id} -> ${res.status} ${JSON.stringify(await res.json())}`);
