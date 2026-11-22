'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.COLOROS_PLAYWRIGHT || 'playwright');

const profile = 'schema=1\nbackend=shell\n[rules]\n# original\nglobal_sample_rate=125\ncom.example.game=360\n[rates]\n125=touchHidlTest -c wo 0 26 0\n360=touchHidlTest -c wo 0 26 12c\n[monitor]\nfallback_enabled=0\npoll_interval=3\nfallback_method=polling\n[names]\ncom.example.game=示例应用\n';
const status = 'state=running\nenabled=1\nexperimental=1\nscreen=awake\nrate=360\ntarget=360\nglobal=125\nforeground_package=com.example.game\nmode=events\nbackend=shell\n';
const url = pathToFileURL(path.resolve(__dirname, '../module/webroot/index.html')).href;

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.COLOROS_BROWSER || undefined });
  try {
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 320, height: 780 }, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ profile, status }) => {
      window.calls = [];
      let storedProfile = profile;
      const originalSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, milliseconds, ...args) => originalSetTimeout(fn, milliseconds === 15000 ? 80 : milliseconds, ...args);
      window.ksu = { exec(command, options, callback) {
        const [, op, payload] = command.match(/service\.sh' (\w+)(?: '([^']+)')?/);
        window.calls.push(op);
        let output = '';
        if (op === 'config') output = storedProfile;
        if (op === 'status') output = status;
        if (op === 'apps') output = 'package:com.example.tools';
        if (op === 'logs') output = 'rate=360 foreground=com.example.game';
        if (op === 'save') storedProfile = new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)));
        originalSetTimeout(() => window[callback](0, output, ''), 10);
      } };
    }, { profile, status });
    await page.goto(url);
    await page.locator('#overview').getByText('示例应用', { exact: true }).waitFor();
    assert.equal(await page.locator('#applied').textContent(), '360');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.waitForFunction(() => window.calls.filter(call => call === 'status').length >= 2);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const beforeHidden = await page.evaluate(() => window.calls.length);
    await page.waitForTimeout(260);
    assert.equal(await page.evaluate(() => window.calls.length), beforeHidden);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.locator('nav [data-page="rules"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.locator('#advanced summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.locator('#advanced summary').click();
    const menu = page.locator('#dropdown-menu');
    const globalRate = page.locator('#global-rate-trigger');
    await globalRate.press('ArrowDown');
    assert.equal(await menu.getByRole('option', { selected: true }).textContent(), '125 Hz');
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#global-rate').inputValue(), '125');
    assert.equal(await globalRate.evaluate(button => document.activeElement === button), true);
    await globalRate.click();
    await page.keyboard.press('3');
    await page.keyboard.press('Enter');
    assert.equal(await globalRate.textContent(), '360 Hz');
    await page.locator('nav [data-page="diagnostics"]').click();
    await page.locator('#confirm-dialog').waitFor();
    await page.locator('#confirm-dialog button[value="cancel"]').click();
    assert.equal(await page.locator('#rules').isVisible(), true);
    await page.locator('#add-rule').click();
    await page.locator('#app-input').fill('com.example.tools');
    await page.locator('#app-rate-trigger').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#app-rate').inputValue(), '125');
    await page.locator('#rule-form button[type="submit"]').click();
    await page.getByText('com.example.tools', { exact: true }).waitFor();
    await page.getByRole('button', { name: '目标档 com.example.tools: 125 Hz' }).click();
    await menu.getByRole('option', { name: '360 Hz' }).click();
    await page.locator('#advanced summary').click();
    await page.locator('#shortcut-action-0-trigger').click();
    await menu.getByRole('option', { name: '切换全局档' }).click();
    assert.equal(await page.locator('#shortcut-action-0-trigger').evaluate(button => document.activeElement === button), true);
    await page.locator('#shortcut-rate-0-trigger').click();
    await menu.getByRole('option', { name: '125 Hz' }).click();
    assert.equal(await page.locator('#backend').count(), 0);
    await page.locator('#advanced summary').click();
    await page.locator('#save').click();
    await page.locator('#save-bar').waitFor({ state: 'hidden' });
    await page.locator('nav [data-page="diagnostics"]').click();
    await page.locator('#diagnostics').waitFor();
    const beforeLogs = await page.evaluate(() => window.calls.filter(call => call === 'logs').length);
    assert.equal(beforeLogs, 0);
    await page.locator('#load-logs').click();
    await page.getByText('rate=360 foreground=com.example.game', { exact: true }).waitFor();
    await page.locator('#preferences').click();
    await page.locator('#theme-trigger').click();
    await menu.getByRole('option', { name: '深色' }).click();
    await page.locator('#language-trigger').click();
    await menu.getByRole('option', { name: 'English' }).click();
    assert.equal(await page.locator('#theme-trigger').textContent(), 'Dark');
    await page.locator('#prefs-dialog button[value="done"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#101813');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    assert.deepEqual(errors, []);
    console.log('PASS 320px layout, themed dropdowns, keyboard and dismissal, hidden refresh, unsaved protection, rule editor, on-demand logs, theme, and language');
    if (process.env.COLOROS_PREVIEW) {
      const preview = await browser.newPage({ locale: 'zh-CN', viewport: { width: 390, height: 730 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
      await preview.goto(url);
      await preview.locator('#overview').getByText('王者荣耀', { exact: true }).waitFor();
      const previewPath = path.parse(process.env.COLOROS_PREVIEW);
      await preview.screenshot({ path: process.env.COLOROS_PREVIEW, animations: 'disabled' });
      await preview.locator('nav [data-page="rules"]').click();
      await preview.screenshot({ path: path.join(previewPath.dir, `${previewPath.name}-rules.png`), animations: 'disabled' });
      await preview.locator('#global-rate-trigger').click();
      await preview.screenshot({ path: path.join(previewPath.dir, `${previewPath.name}-dropdown.png`), animations: 'disabled' });
      await preview.keyboard.press('Escape');
      await preview.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await preview.locator('nav [data-page="diagnostics"]').click();
      await preview.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await preview.screenshot({ path: path.join(previewPath.dir, `${previewPath.name}-diagnostics-dark.png`), animations: 'disabled' });
    }
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
