import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/**
 * Serves the static dashboard shell from src/public/ for any non-/api/* path
 * (contracts/api.md §Static dashboard). Unknown paths fall back to
 * index.html so the client-side dashboard can route them itself.
 */
export function serveStatic(pathname, res) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(PUBLIC_DIR, 'index.html');
  }
  const contentType = CONTENT_TYPES[extname(filePath)] || 'application/octet-stream';
  const content = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}
