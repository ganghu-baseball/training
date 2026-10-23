// 簡易靜態伺服器（給無頭瀏覽器載入 engine/）
import http from 'http'; import fs from 'fs'; import path from 'path';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
export function serve(root, port) {
  const srv = http.createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    try {
      if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      const d = fs.readFileSync(p);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(d);
    } catch (e) { res.writeHead(404); res.end('not found'); }
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}
