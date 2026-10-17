import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { openDatabase } from './db/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCheckRoutes } from './routes/checks.js';
import { registerAdminRoutes } from './routes/admin.js';
import { serveStatic } from './routes/static.js';
import { startPoller } from './services/poller.js';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function createServer(db) {
  const routes = [];

  function addRoute(method, path, handler) {
    const paramNames = [];
    const patternStr = path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          paramNames.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    routes.push({ method, pattern: new RegExp(`^${patternStr}$`), paramNames, handler });
  }

  const context = { db, addRoute, sendJson };

  registerAuthRoutes(context);
  registerCheckRoutes(context);
  registerAdminRoutes(context);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      serveStatic(pathname, res);
      return;
    }

    const match = routes.find((r) => r.method === req.method && r.pattern.test(pathname));
    if (!match) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const execResult = match.pattern.exec(pathname);
    const params = {};
    match.paramNames.forEach((name, i) => {
      params[name] = execResult[i + 1];
    });

    const cookies = parseCookies(req.headers.cookie);

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
    }

    try {
      await match.handler({ req, res, params, cookies, body, query: url.searchParams, sendJson });
    } catch (err) {
      console.error('Unhandled request error:', err.message);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const dbPath = process.env.UPLERT_DB_PATH || join(process.cwd(), 'uplert.db');
  const port = process.env.PORT || 3000;
  const db = openDatabase(dbPath);
  const server = createServer(db);
  startPoller(db);
  server.listen(port, () => {
    console.log(`Uplert listening on http://localhost:${port}`);
  });
}
