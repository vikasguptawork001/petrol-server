/**
 * Quick smoke test: public health + protected routes return 401 without JWT.
 * Run with server up: node server/scripts/smoke-routes.js
 * Optional: BASE_URL=http://127.0.0.1:5000
 */
const http = require('http');
const https = require('https');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';

function request(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path.startsWith('http') ? path : BASE.replace(/\/$/, '') + path);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      { method, headers: { Accept: 'application/json', ...headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json, raw: body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const protectedGets = [
  '/api/items?page=1&limit=1',
  '/api/parties/buyers?page=1&limit=1',
  '/api/reports/sales?from_date=2026-01-01&to_date=2026-01-31&page=1&limit=1',
  '/api/orders?page=1&limit=1',
  '/api/transactions/sales?page=1&limit=1',
  '/api/unified-transactions/party/seller/1',
  '/api/expenses?page=1&limit=1',
  '/api/nozzles',
  '/api/attendants',
  '/api/nozzle-readings?page=1&limit=1',
  '/api/bills/1/pdf',
];

async function main() {
  console.log('BASE_URL=', BASE);
  const health = await request('GET', '/api/health');
  console.log('\nGET /api/health ->', health.status);
  if (health.json) {
    console.log('  DB:', health.json.database);
    console.log('  timestamp (IST string):', health.json.timestamp);
    if (health.json.timezone) {
      console.log('  mysql_session_time_zone:', health.json.timezone.mysql_session_time_zone);
      console.log('  mysql_now:', health.json.timezone.mysql_now);
      const stz = String(health.json.timezone.mysql_session_time_zone || '');
      if (stz !== '+05:30' && stz !== 'Asia/Kolkata') {
        console.warn('  WARNING: expected session TZ +05:30 for IST; got:', stz);
      }
    }
  }
  if (health.status !== 200) {
    console.error('Health check failed; aborting.');
    process.exit(1);
  }

  let failed = 0;
  console.log('\nProtected routes (no token — expect 401):');
  for (const p of protectedGets) {
    const r = await request('GET', p);
    const ok = r.status === 401;
    console.log(`  ${ok ? 'OK' : 'FAIL'} ${r.status} ${p}`);
    if (!ok) failed++;
  }

  const login = await request('POST', '/api/auth/login', { 'Content-Type': 'application/json' });
  console.log('\nPOST /api/auth/login (empty body) ->', login.status, '(expect 400 or 422)');
  if (login.status === 401) failed++;

  console.log(failed ? `\nDone with ${failed} unexpected status(es).` : '\nAll smoke checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
