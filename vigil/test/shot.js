// Headless screenshot driver for Vigil pages.
// usage: NODE_PATH=/opt/node22/lib/node_modules node vigil/test/shot.js <url> <out.png> [steps.json | '<json>']
// Steps run in order after the page sets window.__ready: ["wait", ms], ["waitFor", expr], ["eval", expr] (result printed),
// ["key", code], ["click", selector], ["shot", path]. The final screenshot goes to <out.png>.
// three.js comes from the repo's local r128 copy (no CDN here) and web fonts are skipped.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [url, out, stepsArg] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node shot.js <url> <out.png> [steps]'); process.exit(2); }
const THREE_JS = path.join(__dirname, '..', '..', 'test', 'three.min.js');
const steps = !stepsArg ? [] : fs.existsSync(stepsArg) ? JSON.parse(fs.readFileSync(stepsArg, 'utf8')) : JSON.parse(stepsArg);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.route('**/three.min.js', r => r.fulfill({ path: THREE_JS, contentType: 'application/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000, polling: 250 });
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const [cmd, arg] of steps) {
    const ts = Date.now();
    if (cmd === 'wait') await page.waitForTimeout(arg);
    else if (cmd === 'waitFor') await page.waitForFunction(arg, null, { timeout: 180000, polling: 250 });
    else if (cmd === 'eval') { const r = await page.evaluate(arg); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
    else if (cmd === 'key') await page.keyboard.press(arg);
    else if (cmd === 'click') await page.click(arg);
    else if (cmd === 'shot') { await page.screenshot({ path: arg }); console.log('shot', arg, `(${Date.now() - ts} ms)`); }
    else console.log('unknown step', cmd);
  }
  await page.screenshot({ path: out });
  console.log('wrote', out, `total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
