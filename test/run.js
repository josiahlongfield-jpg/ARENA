// Headless driver: node test/run.js <script.json> [outdir]
// The script is a list of steps: ["begin"], ["sim", s], ["eval", "js"], ["shot", "name"], ["log", "js"]
// Serve test/ first: python3 -m http.server 8766 --bind 127.0.0.1 (from the test folder)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const outDir = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:8766/game.html');
  await page.waitForFunction(() => window.__ta, null, { timeout: 30000 });
  for (const s of steps) {
    const [cmd, arg] = s;
    if (cmd === 'begin') await page.evaluate(() => { __ta.begin(); __ta.norender(true); });
    else if (cmd === 'sim') await page.evaluate(a => __ta.sim(a), arg);
    else if (cmd === 'eval') await page.evaluate(arg);
    else if (cmd === 'log') console.log(JSON.stringify(await page.evaluate(arg)));
    else if (cmd === 'shot') { await page.evaluate(() => __ta.render()); await page.screenshot({ path: `${outDir}/${arg}.png` }); console.log('shot', arg); }
  }
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
})();
