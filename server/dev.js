import { createServer } from 'node:http';
import { createReferenceApi } from './api.js';

if (process.env.NODE_ENV === 'production') throw new Error('The local reference server must not run in production.');
const api = createReferenceApi({
  authenticate: async header => header === 'Bearer local-test-token' ? 'local-test-user' : null,
  otp: { mode: 'test', start: async () => 'test-challenge', verify: async (_, code) => code === '123456' },
});
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST' || !req.url?.startsWith('/api/')) { res.writeHead(404).end(JSON.stringify({ error: 'not_found' })); return; }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) { res.writeHead(415).end(JSON.stringify({ error: 'json_required' })); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16_384) { res.writeHead(413).end(JSON.stringify({ error: 'body_too_large' })); return; }
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { res.writeHead(400).end(JSON.stringify({ error: 'invalid_json' })); return; }
    const result = await api.request(req.url.slice(4), body, req.headers.authorization);
    res.writeHead(result.status).end(JSON.stringify(result.body));
  } catch { if (!res.headersSent) res.writeHead(400).end(JSON.stringify({ error: 'invalid_request' })); }
});
server.requestTimeout = 20_000; server.headersTimeout = 10_000; server.timeout = 20_000;
const cleanup = setInterval(api.prune, 60_000); cleanup.unref();
server.listen(8787, '127.0.0.1', () => console.log('Local test API: http://127.0.0.1:8787/api | token: local-test-token | simulated OTP: 123456 | no real SMS; memory-only data expires after 15 minutes.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(cleanup); server.close(); });
