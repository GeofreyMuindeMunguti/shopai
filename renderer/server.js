// Headless renderer sidecar (ADR-0006): POST /render {url} -> {html, final_url, status}.
// Used by the worker only when a plain fetch returns no structured product data.
// SSRF rules match temporal/src/retail/fetcher.py: http(s) only, public addresses only,
// checked for the page and for every sub-request the browser makes.
const http = require('http');
const dns = require('dns').promises;
const net = require('net');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 3001);
const NAV_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 25000);
const MAX_HTML_BYTES = Number(process.env.RENDER_MAX_BYTES || 2000000);
const MAX_CONCURRENT = Number(process.env.RENDER_MAX_CONCURRENT || 2);
const USER_AGENT = process.env.RENDER_USER_AGENT || 'ScoutBot/0.1 (wishlist price checker; headless)';

function log(msg, fields = {}) {
  const extras = Object.entries(fields).map(([k, v]) => `${k}=${String(v).replace(/\s+/g, ' ')}`).join(' ');
  console.log(`${new Date().toISOString()} renderer ${msg} ${extras}`.trim());
}

function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 192 && b === 0) return false;
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return false;
  if (v6.startsWith('::ffff:')) return isPublicIp(v6.slice(7));
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff')) return false;
  return true;
}

async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'invalid url'; }
  if (!['http:', 'https:'].includes(u.protocol)) return `scheme not allowed: ${u.protocol}`;
  if (u.username || u.password) return 'credentials in URL are not allowed';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /\.(local|internal|localhost)$/i.test(host)) return `host not allowed: ${host}`;
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length) return `dns lookup failed for ${host}`;
  const bad = ips.find((ip) => !isPublicIp(ip));
  return bad ? `address not allowed for ${host}: ${bad}` : null;
}

let browserPromise = null;
function browser() {
  if (!browserPromise) browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  return browserPromise;
}

let active = 0;
async function render(url) {
  const context = await (await browser()).newContext({ userAgent: USER_AGENT, javaScriptEnabled: true });
  try {
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (['image', 'media', 'font'].includes(req.resourceType())) return route.abort();
      const problem = await checkUrl(req.url());
      return problem ? route.abort('blockedbyclient') : route.continue();
    });
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const finalUrl = page.url();
    const problem = await checkUrl(finalUrl);
    if (problem) return { blocked: problem };
    let html = await page.content();
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);
    return { html, final_url: finalUrl, status: resp ? resp.status() : 0 };
  } finally {
    await context.close().catch(() => {});
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/render') return send(res, 404, { error: 'not found' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
  req.on('end', async () => {
    let url;
    try { url = JSON.parse(body).url; } catch { return send(res, 400, { error: 'invalid json' }); }
    const problem = await checkUrl(url || '');
    if (problem) { log('render blocked', { url, reason: problem }); return send(res, 403, { error: problem }); }
    if (active >= MAX_CONCURRENT) return send(res, 503, { error: 'busy' });
    active += 1;
    const started = Date.now();
    try {
      const out = await render(url);
      if (out.blocked) { log('render blocked', { url, reason: out.blocked }); return send(res, 403, { error: out.blocked }); }
      log('render ok', { url, status: out.status, bytes: out.html.length, ms: Date.now() - started });
      return send(res, 200, out);
    } catch (err) {
      log('render failed', { url, error: err.message });
      return send(res, 502, { error: 'render failed' });
    } finally {
      active -= 1;
    }
  });
}).listen(PORT, () => log('listening', { port: PORT }));
