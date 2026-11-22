'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.COLOROS_PLAYWRIGHT || 'playwright');

const profile = 'schema=1\nbackend=shell\n[rules]\n# original\nglobal_sample_rate=125\ncom.example.game=360\n[rates]\n125=touchHidlTest -c wo 0 26 0\n360=touchHidlTest -c wo 0 26 12c\n[monitor]\nfallback_enabled=0\npoll_interval=3\nfallback_method=polling\n[names]\ncom.example.game=示例应用\n';
const status = 'state=running\nenabled=1\nexperimental=1\nscreen=awake\nrate=360\ntarget=360\nglobal=125\nforeground_package=com.example.game\nmode=events\nbackend=shell\n';
const longPackage = `com.aaa.${'d'.repeat(70)}.app`;
const apps = ['com.example.tools', 'com.example.detect', 'com.example.reader',
  'com.example.draw', 'com.example.editor', 'com.example.sound', longPackage];
const url = pathToFileURL(path.resolve(__dirname, '../module/webroot/index.html')).href;

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.COLOROS_BROWSER || undefined });
  try {
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ profile, status, apps }) => {
      window.calls = [];
      // An IME can shrink and pan the visual viewport without resizing the layout viewport.
      const viewport = window.visualViewport;
      window.setVisibleHeight = (height, offsetTop) => {
        if (height == null) {
          delete viewport.height;
          delete viewport.offsetTop;
        } else {
          Object.defineProperties(viewport, {
            height: { configurable: true, value: height },
            offsetTop: { configurable: true, value: offsetTop },
          });
        }
        viewport.dispatchEvent(new Event('resize'));
      };
      let storedProfile = profile;
      const originalSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, milliseconds, ...args) => originalSetTimeout(fn, milliseconds === 15000 ? 80 : milliseconds, ...args);
      window.ksu = { getPackagesInfo: ids => JSON.parse(ids).flatMap(packageName => {
        const label = { 'com.example.tools': '工具箱', 'com.example.detect': 'Device Finder' }[packageName];
        return label ? [{ packageName, label }] : [];
      }), exec(command, options, callback) {
        const [, op, payload] = command.match(/service\.sh' (\w+)(?: '([^']+)')?/);
        window.calls.push(op);
        let output = '';
        if (op === 'config') output = storedProfile;
        if (op === 'status') output = status;
        if (op === 'apps' && window.failAppList) {
          originalSetTimeout(() => {
            window[callback](1, '', 'Application list unavailable');
            window.appListFailed = true;
          }, 10);
          return;
        }
        if (op === 'apps') output = apps.map(pkg => `package:${pkg}`).join('\n');
        if (op === 'logs') output = 'rate=360 foreground=com.example.game';
        if (op === 'save') storedProfile = new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)));
        originalSetTimeout(() => window[callback](0, output, ''), 10);
      } };
    }, { profile, status, apps });
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

    const ruleDialog = page.locator('#rule-dialog');
    const appInput = page.getByRole('combobox', { name: '应用包名' });
    const appList = page.locator('#installed-apps');
    const appOptions = appList.getByRole('option');
    const add = ruleDialog.getByRole('button', { name: '添加', exact: true });
    await page.evaluate(() => { window.failAppList = true; });
    await page.locator('#add-rule').click();
    await page.waitForFunction(() => window.appListFailed);
    await appInput.fill('com.example.offline');
    assert.equal(await appList.isVisible(), false);
    await add.click();
    await page.locator('#rule-list').getByText('com.example.offline', { exact: true }).waitFor();
    await page.evaluate(() => { window.failAppList = false; });

    await page.locator('#add-rule').click();
    assert.equal(await appList.isVisible(), false);
    await ruleDialog.getByRole('button', { name: '已安装应用' }).tap();
    await appList.getByText('工具箱', { exact: true }).waitFor();
    assert.equal(await appOptions.count(), apps.length);
    await appInput.fill('d');
    assert.equal(await appOptions.count(), apps.length - 1);
    await page.evaluate(() => window.setVisibleHeight(284, 32));
    const layout = await ruleDialog.evaluate(dialog => {
      const list = dialog.querySelector('#installed-apps');
      const input = dialog.querySelector('#app-input');
      const rateLabel = dialog.querySelector('label[for="app-rate-trigger"]');
      const first = list.firstElementChild;
      const { top, bottom } = dialog.getBoundingClientRect();
      const box = list.getBoundingClientRect();
      const firstBox = first.getBoundingClientRect();
      return {
        withinViewport: top >= 32 && bottom <= 316,
        inFlow: box.top >= input.getBoundingClientRect().bottom && box.bottom <= rateLabel.getBoundingClientRect().top,
        firstVisible: firstBox.top >= box.top && firstBox.bottom <= box.bottom && firstBox.bottom <= bottom,
        scrolls: list.scrollHeight > list.clientHeight && box.height < 160,
        wraps: first.firstElementChild.getBoundingClientRect().height > list.children[2].firstElementChild.getBoundingClientRect().height,
        fitsWidth: list.scrollWidth === list.clientWidth,
      };
    });
    assert.deepEqual(layout, { withinViewport: true, inFlow: true, firstVisible: true, scrolls: true, wraps: true, fitsWidth: true });
    await appInput.press('ArrowUp');
    assert.equal(await appOptions.last().getAttribute('aria-selected'), 'true');
    assert.ok(await appList.evaluate(list => list.scrollTop > 0));
    await appInput.press('Escape');
    assert.equal(await appList.isVisible(), false);
    assert.equal(await ruleDialog.isVisible(), true);
    assert.equal(await appInput.inputValue(), 'd');
    await appInput.fill('DEVICE FINDER');
    assert.equal(await appOptions.count(), 1);
    await appInput.press('ArrowDown');
    assert.equal(await appInput.getAttribute('aria-activedescendant'), await appOptions.first().getAttribute('id'));
    await appInput.press('Enter');
    assert.equal(await appInput.inputValue(), 'com.example.detect');
    assert.equal(await ruleDialog.isVisible(), true);
    assert.equal(await appList.isVisible(), false);

    await appInput.fill('工具');
    await appOptions.getByText('工具箱', { exact: true }).tap();
    assert.equal(await appInput.inputValue(), 'com.example.tools');
    assert.equal(await appList.isVisible(), false);
    assert.equal(await appInput.evaluate(input => document.activeElement === input), true);
    // Clicking the rate while suggestions are expanded must still work after relayout.
    await ruleDialog.getByRole('button', { name: '已安装应用' }).tap();
    await appList.waitFor();
    await page.locator('#app-rate-trigger').click();
    assert.equal(await appList.isVisible(), false);
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#app-rate').inputValue(), '125');
    await add.click();
    await page.locator('#rule-list').getByText('工具箱', { exact: true }).waitFor();
    await page.evaluate(() => window.setVisibleHeight());

    await page.locator('#add-rule').click();
    assert.equal(await appInput.inputValue(), '');
    assert.equal(await appList.isVisible(), false);
    await appInput.fill('d');
    await appInput.press('Tab');
    assert.equal(await appList.isVisible(), false);
    await appInput.fill('com.example.unlisted');
    assert.equal(await appList.isVisible(), false);
    await add.click();
    await page.getByText('com.example.unlisted', { exact: true }).waitFor();
    await page.getByRole('button', { name: '目标档 工具箱: 125 Hz' }).click();
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
    console.log('PASS 320px layout, themed dropdowns, viewport-aware app picker, rule editing, hidden refresh, unsaved protection, logs, theme, and language');
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
