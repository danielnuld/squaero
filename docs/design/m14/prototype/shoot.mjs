// Renders every .dc.html in this folder with the canvas runtime (served as
// support.js) and records console errors, page errors and a screenshot.
// Usage: node shoot.mjs [theme] [Name ...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('D:/squaero/frontend/package.json');
const { chromium } = require('@playwright/test');

const dir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const [theme = 'b', ...only] = process.argv.slice(2);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  if (p.endsWith('.dc.html') && theme !== 'b') {
    res.end(fs.readFileSync(p, 'utf8').split('"options":["b","a","c","rosa"],"default":"b"').join(`"options":["b","a","c","rosa"],"default":"${theme}"`).replace(/theme \?\? 'b'/g, `theme ?? '${theme}'`));
    return;
  }
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch();
const outDir = path.join(dir, 'shots-' + theme);
fs.mkdirSync(outDir, { recursive: true });
const files = (only.length ? only.map((n) => n + '.dc.html') : fs.readdirSync(dir).filter((f) => f.endsWith('.dc.html')));
const report = {};
for (const f of files) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)));
  const url = `http://localhost:${port}/${f}` + (theme !== 'b' ? `?theme=${theme}` : '');
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
    const errBox = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => /error|Error/.test(e.className || '') && e.textContent.length < 400).map((e) => e.textContent.trim()).slice(0, 3));
    if (errBox.length) errs.push('errbox: ' + errBox.join(' | '));
    await page.screenshot({ path: path.join(outDir, f.replace('.dc.html', '.png')) });
    report[f] = { errs, text: text.replace(/\s+/g, ' ').slice(0, 120) };
  } catch (e) {
    report[f] = { errs: [...errs, 'goto: ' + String(e).slice(0, 200)] };
  }
  await page.close();
}
await browser.close();
server.close();
fs.writeFileSync(path.join(dir, `report-${theme}.json`), JSON.stringify(report, null, 1));
const bad = Object.entries(report).filter(([, v]) => v.errs.length);
console.log(`rendered ${files.length}, with errors ${bad.length}`);
for (const [f, v] of bad) console.log(f, '\n  ' + v.errs.slice(0, 4).join('\n  '));
