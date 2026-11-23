/* The profile editor preserves comments, blank lines, and existing entry positions. */
function parseFields(text) {
  const result = Object.create(null);
  for (const line of text.split('\n')) {
    const delimiter = line.indexOf('=');
    if (delimiter > 0 && !line.trimStart().startsWith('#')) result[line.slice(0, delimiter)] = line.slice(delimiter + 1);
  }
  return result;
}

function rewriteEntries(text, entries) {
  const missing = new Map(entries);
  const lines = [];
  const source = text ? text.split('\n') : [];
  const last = new Map();
  const keyFor = line => !line.trimStart().startsWith('#') && line.includes('=') ? line.split('=', 1)[0] : null;
  source.forEach((line, index) => { const key = keyFor(line); if (key) last.set(key, index); });
  source.forEach((line, index) => {
    const key = keyFor(line);
    if (!key) lines.push(line);
    else if (last.get(key) === index && missing.has(key)) {
      lines.push(`${key}=${missing.get(key)}`);
      missing.delete(key);
    }
  });
  for (const [key, value] of missing) lines.push(`${key}=${value}`);
  return lines.join('\n');
}

function parseProfile(text) {
  const source = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const sections = Object.create(null);
  const markers = [...source.matchAll(/^\[(rules|rates|monitor|names)\]$/gm)];
  if (!source.startsWith('schema=1\n') || new Set(markers.map(match => match[1])).size !== 4) throw new Error('config_invalid');
  markers.forEach((match, index) => {
    const end = index + 1 < markers.length ? markers[index + 1].index - 1 : source.length;
    sections[match[1]] = source.slice(match.index + match[0].length + 1, end);
  });
  const rules = parseFields(sections.rules);
  const global = rules.global_sample_rate;
  delete rules.global_sample_rate;
  const monitor = parseFields(sections.monitor);
  return {
    global, rules: new Map(Object.entries(rules)), rates: sections.rates,
    names: new Map(Object.entries(parseFields(sections.names))), sections,
    fallback: monitor.fallback_enabled === '1', interval: monitor.poll_interval || '3',
    watch: sections.monitor.split('\n').filter(line => line.startsWith('fallback_app=')).map(line => line.slice(13)).join('\n'),
    backend: parseFields(source.slice(0, markers[0].index)).backend || 'shell',
  };
}

function serializeProfile(draft) {
  const rules = rewriteEntries(draft.sections.rules, [['global_sample_rate', draft.global], ...draft.rules]);
  const names = rewriteEntries(draft.sections.names, draft.names);
  const monitor = [
    `fallback_enabled=${draft.fallback ? '1' : '0'}`, `poll_interval=${draft.interval}`, 'fallback_method=polling',
    ...new Set(draft.watch.split('\n').map(line => line.trim()).filter(Boolean)),
  ].map((line, index) => index < 3 ? line : `fallback_app=${line}`).join('\n');
  return `schema=1\nbackend=${draft.backend}\n[rules]\n${rules}\n[rates]\n${draft.rates}\n[monitor]\n${monitor}\n[names]\n${names}\n`;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseFields, rewriteEntries, parseProfile, serializeProfile };

if (typeof document !== 'undefined') (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const path = '/data/adb/modules/ColorOSTouch/service.sh';
  const manager = window.ksu || window.magisk;
  const preview = !manager?.exec;
  const packagePattern = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
  const zh = {
    overview:'概览', rules:'规则', diagnostics:'诊断', preferences:'界面设置', theme:'主题', language:'语言', system:'系统', light:'浅色', dark:'深色', done:'完成', nav:'主导航',
    applied:'最近成功下发', enable:'启用触控优化', target:'目标档', global:'全局档', foreground:'前台应用', search:'搜索应用或包名', addRule:'新增规则', advanced:'高级设置',
    mappings:'触控命令映射', fallback:'为指定应用加强校准', watchlist:'应用包名（每行一个）', interval:'校准间隔（秒）', backend:'监听后端', shortcuts:'概览快捷操作',
    unsaved:'有未保存的修改', discard:'撤销', save:'保存', resync:'重新检测', refresh:'刷新状态', logs:'运行日志', loadLogs:'查看', copy:'复制', logEmpty:'日志按需读取',
    newRule:'新增应用规则', packageName:'应用包名', installedApps:'已安装应用', cancel:'取消', add:'添加', leavePrompt:'离开此页前，保存或放弃修改。', remove:'移除', empty:'没有匹配的应用规则',
    loading:'加载中', running:'运行中', paused:'息屏暂停', degraded:'降级运行', disabled:'已关闭', stopped:'服务未运行', starting:'启动中', stopping:'停止中', unknown:'未知',
    events:'事件监听', watchlistMode:'名单轮询', recovery:'监听恢复中', screen:'屏幕', awake:'亮屏', asleep:'息屏', mode:'检测方式', updated:'最后更新', reason:'诊断信息', release:'版本类型', official:'正式版',
    saved:'已保存', failed:'操作失败', config_invalid:'配置无效，请检查档位映射、包名和校准间隔', control_busy:'服务繁忙，请稍后重试', copied:'已复制', unavailable:'未找到日志',
    calcRule:'编辑规则', none:'无', turnOn:'开启服务', turnOff:'关闭服务', setGlobal:'切换全局档', foreground_unknown:'无法确认前台应用', event_stream_lost:'事件流中断，正在重连', apply_failed:'触控命令失败或超时',
    power_unknown:'无法确认屏幕状态', rust_unavailable:'此安装包或设备不支持 Rust 监听', rust_start_failed:'Rust 监听无法启动，正在重试', rust_failed:'Rust 监听启动失败，已切回 Shell', worker_exited:'工作进程已退出，正在重试',
    restart:'重试启动', resyncSent:'已请求重新检测', restore_failed:'停用时未能恢复全局档', compatibility:'兼容档', readOnly:'读取配置失败，请刷新重试', preview:'浏览器预览',
  };
  const en = {
    overview:'Overview', rules:'Rules', diagnostics:'Diagnostics', preferences:'Preferences', theme:'Theme', language:'Language', system:'System', light:'Light', dark:'Dark', done:'Done', nav:'Main navigation',
    applied:'Last applied', enable:'Enable touch optimization', target:'Target', global:'Global', foreground:'Foreground app', search:'Search apps or packages', addRule:'Add rule', advanced:'Advanced',
    mappings:'Touch command mappings', fallback:'Recheck selected apps more often', watchlist:'Package names, one per line', interval:'Recheck interval (seconds)', backend:'Listener backend', shortcuts:'Overview actions',
    unsaved:'Unsaved changes', discard:'Discard', save:'Save', resync:'Detect again', refresh:'Refresh status', logs:'Service log', loadLogs:'View', copy:'Copy', logEmpty:'Load logs on demand',
    newRule:'New app rule', packageName:'Package name', installedApps:'Installed apps', cancel:'Cancel', add:'Add', leavePrompt:'Save or discard your changes before leaving.', remove:'Remove', empty:'No matching rules',
    loading:'Loading', running:'Running', paused:'Screen off', degraded:'Degraded', disabled:'Off', stopped:'Service stopped', starting:'Starting', stopping:'Stopping', unknown:'Unknown',
    events:'Event stream', watchlistMode:'Watchlist polling', recovery:'Reconnecting', screen:'Screen', awake:'On', asleep:'Off', mode:'Detection', updated:'Last updated', reason:'Diagnostics', release:'Release', official:'Official',
    saved:'Saved', failed:'Operation failed', config_invalid:'Invalid profile. Check rate mappings, package names, and interval.', control_busy:'Service is busy. Try again shortly.', copied:'Copied', unavailable:'No log entries',
    calcRule:'Edit rules', none:'None', turnOn:'Enable service', turnOff:'Disable service', setGlobal:'Set global rate', foreground_unknown:'Foreground app could not be confirmed', event_stream_lost:'Event stream interrupted. Reconnecting.', apply_failed:'Touch command failed or timed out',
    power_unknown:'Screen state could not be confirmed', rust_unavailable:'Rust is unavailable on this build or device', rust_start_failed:'Rust listener could not start. Retrying.', rust_failed:'Rust listener failed. Switched to Shell.', worker_exited:'Worker stopped. Retrying.',
    restart:'Retry start', resyncSent:'Detection requested', restore_failed:'Could not restore the global setting on stop', compatibility:'Compatibility rate', readOnly:'Could not read profile. Refresh to retry.', preview:'Browser preview',
  };

  const readPref = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const writePref = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* Some managers disable storage. */ }
  };
  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  let locale = zh;
  const t = key => locale[key] ?? key;
  let profile, original, shortcuts, page = 'overview', timer, messageTimer;
  let busy = false, statusJob, appJob, requestId = 0, rawLog = '';
  let status = { state: 'loading' };
  const packages = new Map();
  const shortcutOptions = ['calcRule', 'resync', 'diagnostics', 'turnOn', 'turnOff', 'setGlobal', 'none'];
  const sampleProfile = 'schema=1\nbackend=shell\n[rules]\nglobal_sample_rate=125\ncom.tencent.tmgp.sgame=360\ncom.netease.party=240\n[rates]\n125=touchHidlTest -c wo 0 26 0\n240=touchHidlTest -c wo 0 26 1\n360=touchHidlTest -c wo 0 26 12c\n[monitor]\nfallback_enabled=0\npoll_interval=3\n[names]\ncom.tencent.tmgp.sgame=王者荣耀\ncom.netease.party=蛋仔派对\n';
  const sampleStatus = { enabled:'1', experimental:'1', state:'running', screen:'awake', foreground_package:'com.tencent.tmgp.sgame', rate:'360', target:'360', global:'125', backend:'shell', mode:'events' };
  let previewProfile = sampleProfile;
  function exec(op, payload) {
    if (preview) {
      if (op === 'config') return Promise.resolve(previewProfile);
      if (op === 'status') return Promise.resolve(Object.entries(sampleStatus).map(pair => pair.join('=')).join('\n'));
      if (op === 'enable' || op === 'disable') Object.assign(sampleStatus, { enabled: op === 'enable' ? '1' : '0', state: op === 'enable' ? 'running' : 'disabled' });
      if (op === 'save') {
        previewProfile = new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)));
        sampleStatus.global = parseProfile(previewProfile).global;
      }
      if (op === 'apps') return Promise.resolve('package:com.tencent.tmgp.sgame\npackage:com.netease.party\npackage:com.example.app');
      if (op === 'logs') return Promise.resolve('2026-11-21 14:32:09  rate=360 foreground=com.tencent.tmgp.sgame');
      return Promise.resolve('');
    }
    const command = `/system/bin/sh '${path}' ${op}${payload ? ` '${payload}'` : ''}`;
    return new Promise((resolve, reject) => {
      let timeout;
      const callback = `__colorosTouch${++requestId}`;
      const finish = (error, result) => {
        clearTimeout(timeout);
        delete window[callback];
        if (error) reject(error); else resolve(result || '');
      };
      window[callback] = (code, stdout, stderr) => finish(Number(code) === 0 ? null : new Error((stderr || '').trim() || 'failed'), stdout);
      timeout = setTimeout(() => finish(new Error('failed')), 12000);
      try {
        if (window.ksu) window.ksu.exec(command, '{}', callback);
        else window.magisk.exec(command, callback);
      } catch (error) { finish(error); }
    });
  }

  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function notify(key, error = false) {
    const element = $('message');
    element.textContent = locale[key] || (error ? t('failed') : key);
    element.dataset.error = String(error);
    element.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { element.hidden = true; }, 4500);
  }
  function rateLabel(value) { return value ? `${value} Hz` : '—'; }
  function appName(value) { return profile?.names.get(value) || packages.get(value) || value; }
  const dropdownMenu = $('dropdown-menu');
  const dropdownOptions = $('dropdown-options');
  const dropdowns = new WeakMap();
  let activeDropdown;
  let dropdownId = 0;

  // Keep each select as the value source for the existing form and settings handlers.
  function syncDropdown(select) {
    if (typeof dropdownMenu.showModal !== 'function') return;
    let field = dropdowns.get(select);
    if (!field) {
      const label = select.labels[0];
      const trigger = document.createElement('button');
      const value = document.createElement('span');
      trigger.type = 'button';
      trigger.className = 'dropdown-trigger';
      trigger.id = select.id ? `${select.id}-trigger` : `dropdown-trigger-${++dropdownId}`;
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', dropdownMenu.id);
      trigger.setAttribute('aria-expanded', 'false');
      trigger.append(value);
      trigger.onclick = () => openDropdown(field);
      trigger.onkeydown = event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        openDropdown(field);
      };
      select.before(trigger);
      select.hidden = true;
      if (label) label.htmlFor = trigger.id;
      field = { select, trigger, value, label };
      dropdowns.set(select, field);
    }
    field.name = field.label?.textContent.trim() || select.getAttribute('aria-label');
    field.value.textContent = select.selectedOptions[0]?.label || '—';
    field.trigger.setAttribute('aria-label', field.name ? `${field.name}: ${field.value.textContent}` : field.value.textContent);
    field.trigger.disabled = select.disabled || !Array.from(select.options).some(option => !option.disabled);
  }

  function positionDropdown() {
    if (!activeDropdown) return;
    const anchor = activeDropdown.trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const x = viewport?.offsetLeft || 0;
    const y = viewport?.offsetTop || 0;
    const width = viewport?.width || document.documentElement.clientWidth;
    const height = viewport?.height || document.documentElement.clientHeight;
    const margin = 8;
    const gap = 4;
    if (!anchor.width || anchor.bottom <= y || anchor.top >= y + height) {
      closeDropdown(false);
      return;
    }
    const below = y + height - anchor.bottom - gap - margin;
    const above = anchor.top - y - gap - margin;
    const menuWidth = Math.min(Math.max(anchor.width, 208), width - 2 * margin);
    dropdownMenu.style.width = `${menuWidth}px`;
    const naturalHeight = dropdownOptions.offsetHeight + 12;
    const opensAbove = below < naturalHeight && above > below;
    const space = opensAbove ? above : below;
    const menuHeight = Math.min(naturalHeight, space < 60 ? height - 2 * margin : space);
    const top = opensAbove ? anchor.top - gap - menuHeight : anchor.bottom + gap;
    dropdownMenu.style.maxHeight = `${menuHeight}px`;
    dropdownMenu.style.top = `${Math.max(y + margin, Math.min(top, y + height - margin - menuHeight))}px`;
    dropdownMenu.style.left = `${Math.max(x + margin, Math.min(anchor.right - menuWidth, x + width - margin - menuWidth))}px`;
  }

  function focusDropdownOption(option) {
    dropdownOptions.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1');
    option.tabIndex = 0;
    option.focus({ preventScroll: true });
    const rect = option.getBoundingClientRect();
    const bounds = dropdownMenu.getBoundingClientRect();
    if (rect.top < bounds.top + 6) dropdownMenu.scrollTop -= bounds.top + 6 - rect.top;
    else if (rect.bottom > bounds.bottom - 6) dropdownMenu.scrollTop += rect.bottom - bounds.bottom + 6;
  }

  function openDropdown(field) {
    if (activeDropdown || field.trigger.disabled) return;
    const { select, trigger, name } = field;
    const items = Array.from(select.options, (option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === select.selectedIndex));
      item.tabIndex = -1;
      item.disabled = option.disabled;
      item.textContent = option.label;
      item.onclick = () => {
        closeDropdown();
        if (select.selectedIndex === index) return;
        select.selectedIndex = index;
        syncDropdown(select);
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (!trigger.isConnected) $(trigger.id)?.focus({ preventScroll: true });
      };
      return item;
    });
    const initial = items.find(item => !item.disabled && item.getAttribute('aria-selected') === 'true')
      || items.find(item => !item.disabled);
    if (!initial) return;
    const accessibleName = name || trigger.getAttribute('aria-label');
    dropdownMenu.setAttribute('aria-label', accessibleName);
    dropdownOptions.setAttribute('aria-label', accessibleName);
    dropdownOptions.replaceChildren(...items);
    activeDropdown = field;
    trigger.setAttribute('aria-expanded', 'true');
    initial.tabIndex = 0;
    dropdownMenu.showModal();
    positionDropdown();
    if (activeDropdown) focusDropdownOption(initial);
  }

  function closeDropdown(restoreFocus = true) {
    if (!activeDropdown) return;
    const { trigger } = activeDropdown;
    activeDropdown = null;
    trigger.setAttribute('aria-expanded', 'false');
    dropdownMenu.close();
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function bindDropdown() {
    let typed = '';
    let lastKeyTime = 0;
    dropdownMenu.addEventListener('close', () => { typed = ''; });
    dropdownMenu.addEventListener('cancel', event => {
      event.preventDefault();
      closeDropdown();
    });
    dropdownMenu.addEventListener('click', event => {
      if (event.target !== dropdownMenu) return;
      const bounds = dropdownMenu.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) closeDropdown();
    });
    dropdownOptions.onkeydown = event => {
      const items = Array.from(dropdownOptions.querySelectorAll('button:enabled'));
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      let next;
      switch (event.key) {
        case 'ArrowDown': next = items[Math.min(index + 1, items.length - 1)]; break;
        case 'ArrowUp': next = items[Math.max(index - 1, 0)]; break;
        case 'Home': next = items[0]; break;
        case 'End': next = items[items.length - 1]; break;
        default: {
          if (event.key.length !== 1 || event.key === ' ' || event.altKey || event.ctrlKey || event.metaKey) return;
          const key = event.key.toLocaleLowerCase();
          const now = performance.now();
          typed = now - lastKeyTime > 600 || typed === key ? key : typed + key;
          lastKeyTime = now;
          const start = index + (typed.length === 1 ? 1 : 0);
          next = [...items.slice(start), ...items.slice(0, start)].find(item =>
            item.textContent.toLocaleLowerCase().startsWith(typed));
        }
      }
      event.preventDefault();
      if (next) focusDropdownOption(next);
    };
    window.addEventListener('resize', positionDropdown);
    window.addEventListener('scroll', positionDropdown);
    window.visualViewport?.addEventListener('resize', positionDropdown);
    window.visualViewport?.addEventListener('scroll', positionDropdown);
  }

  function options(element, selected) {
    const rates = Object.keys(parseFields(profile.rates)).filter(value => /^[1-9]\d{0,3}$/.test(value));
    if (selected && !rates.includes(selected)) rates.push(selected);
    element.replaceChildren(...rates.map(rate => new Option(rateLabel(rate), rate)));
    if (selected) element.value = selected;
    if (element.parentElement) syncDropdown(element);
  }
  function translate() {
    const language = $('language').value;
    locale = (language === 'system' ? !/^zh\b/i.test(navigator.language) : language === 'en') ? en : zh;
    document.documentElement.lang = locale === en ? 'en' : 'zh-CN';
    const theme = $('theme').value;
    const dark = theme === 'dark' || (theme === 'system' && themeMedia.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    for (const element of document.querySelectorAll('[data-i]')) element.textContent = t(element.dataset.i);
    for (const element of document.querySelectorAll('[data-label]')) element.setAttribute('aria-label', t(element.dataset.label));
    for (const id of ['theme', 'language', 'global-rate', 'app-rate']) syncDropdown($(id));
    $('search').placeholder = t('search');
    if (rawLog) $('log-output').textContent = rawLog;
    renderRules();
    renderStatus();
    renderShortcuts();
  }
  function dirty() {
    return Boolean(profile && (serializeProfile(profile) !== original || JSON.stringify(shortcuts) !== originalShortcuts));
  }
  let originalShortcuts;
  function updateDirty() {
    $('save-bar').hidden = !dirty();
    $('save').disabled = busy;
  }
  function renderRules() {
    if (!profile) return;
    $('rule-count').textContent = String(profile.rules.size);
    options($('global-rate'), profile.global);
    const search = $('search').value.trim().toLowerCase();
    const rows = [];
    for (const [pkg, rate] of profile.rules) {
      const name = appName(pkg);
      if (!`${name} ${pkg}`.toLowerCase().includes(search)) continue;
      const row = document.createElement('div');
      row.className = 'rule-row';
      const label = document.createElement('div');
      const title = document.createElement('span');
      title.textContent = name;
      label.append(title);
      if (name !== pkg) {
        const info = document.createElement('span');
        info.className = 'mono';
        info.textContent = pkg;
        label.append(info);
      }
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${t('target')} ${name}`);
      options(select, rate);
      select.onchange = () => { profile.rules.set(pkg, select.value); updateDirty(); };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove quiet';
      remove.setAttribute('aria-label', `${t('remove')} ${name}`);
      remove.textContent = '×';
      remove.onclick = () => { profile.rules.delete(pkg); renderRules(); updateDirty(); };
      row.append(label, select, remove);
      syncDropdown(select);
      rows.push(row);
    }
    if (!rows.length) {
      const blank = document.createElement('p');
      blank.className = 'empty';
      blank.textContent = t('empty');
      rows.push(blank);
    }
    $('rule-list').replaceChildren(...rows);
    if (activeDropdown && !activeDropdown.trigger.isConnected) closeDropdown(false);
  }
  function renderProfile() {
    if (!profile) return;
    $('global-rate').disabled = false;
    $('rates-text').value = profile.rates;
    $('fallback-enabled').checked = profile.fallback;
    $('fallback-items').value = profile.watch;
    $('poll-interval').value = profile.interval;
    renderRules();
    renderShortcuts();
    updateDirty();
  }
  function renderStatus() {
    const state = status.stopping === '1' ? 'stopping' : status.state || 'unknown';
    $('state').textContent = t(state);
    $('state').dataset.state = state;
    $('enabled').checked = status.enabled === '1';
    $('enabled').disabled = busy || status.enabled === undefined || state === 'stopping';
    $('applied').textContent = status.rate || '—';
    $('target').textContent = rateLabel(status.target);
    $('global').textContent = rateLabel(status.global || (original && parseProfile(original).global));
    const pkg = status.foreground_package;
    const name = status.foreground_name || appName(pkg);
    $('foreground').textContent = name || (status.screen === 'asleep' ? t('paused') : '—');
    $('package').textContent = name && name !== pkg ? pkg || '' : '';
    $('resync').disabled = busy || status.enabled !== '1';
    const rows = [
      ['state', t(state)], ['backend', status.backend || status.preferred_backend || '—'],
      ['release', t('official')],
      ['mode', status.mode ? t(status.mode === 'watchlist' ? 'watchlistMode' : status.mode) : '—'],
      ['screen', status.screen ? t(status.screen) : '—'],
      ['updated', status.updated ? new Date(Number(status.updated) * 1000).toLocaleString(document.documentElement.lang) : '—'],
      ['reason', [status.error, status.backend_error, preview ? 'preview' : ''].filter(Boolean).map(t).join(' · ') || '—'],
    ];
    $('details').replaceChildren(...rows.map(([key, value]) => {
      const term = document.createElement('dt');
      const definition = document.createElement('dd');
      term.textContent = key === 'state' ? (locale === en ? 'Status' : '服务状态') : t(key);
      definition.textContent = value;
      const row = document.createElement('div');
      row.append(term, definition);
      return row;
    }));
  }
  function renderShortcuts() {
    if (!shortcuts) return;
    const rates = parseFields(profile?.rates || '');
    $('shortcuts').replaceChildren(...shortcuts.filter(slot => slot.action !== 'none').map(slot => {
      const { action, rate } = slot;
      const button = document.createElement('button');
      button.textContent = action === 'setGlobal' ? `${t(action)} ${rateLabel(rate)}` : t(action);
      button.disabled = action === 'setGlobal' && !rates[rate];
      button.onclick = async () => {
        if (action === 'resync') return runResync();
        if (action === 'turnOn' || action === 'turnOff') return changeEnabled(action === 'turnOn');
        if (action === 'setGlobal') {
          if (!profile || busy || !(await allowLeave())) return;
          const previous = profile.global;
          profile.global = rate;
          if (!(await save())) profile.global = previous;
          renderProfile();
          return;
        }
        return navigate(action === 'calcRule' ? 'rules' : 'diagnostics');
      };
      return button;
    }));
    $('shortcut-selects').replaceChildren(...shortcuts.map((slot, index) => {
      const row = document.createElement('div');
      const select = document.createElement('select');
      select.id = `shortcut-action-${index}`;
      select.setAttribute('aria-label', `${t('shortcuts')} ${index + 1}`);
      select.replaceChildren(...shortcutOptions.map(value => new Option(t(value), value)));
      select.value = slot.action;
      select.onchange = () => { slot.action = select.value; updateDirty(); renderShortcuts(); };
      row.append(select);
      syncDropdown(select);
      if (slot.action === 'setGlobal' && profile) {
        const rateSelect = document.createElement('select');
        rateSelect.id = `shortcut-rate-${index}`;
        rateSelect.setAttribute('aria-label', `${t('global')} ${index + 1}`);
        options(rateSelect, slot.rate);
        rateSelect.onchange = () => { slot.rate = rateSelect.value; updateDirty(); renderShortcuts(); };
        row.append(rateSelect);
        syncDropdown(rateSelect);
      }
      return row;
    }));
    if (activeDropdown && !activeDropdown.trigger.isConnected) closeDropdown(false);
  }
  async function fetchProfile() {
    try {
      profile = parseProfile(await exec('config'));
      original = serializeProfile(profile);
      renderProfile();
      renderStatus();
      loadNames([...profile.rules.keys()]);
    } catch { notify('readOnly', true); }
  }
  async function loadNames(ids) {
    if (!window.ksu?.getPackagesInfo || !ids.length) return;
    try {
      for (let offset = 0; offset < ids.length; offset += 50) {
        let info = await window.ksu.getPackagesInfo(JSON.stringify(ids.slice(offset, offset + 50)));
        if (typeof info === 'string') info = JSON.parse(info);
        if (!Array.isArray(info) && info && typeof info === 'object') info = Object.values(info);
        if (Array.isArray(info)) for (const item of info) {
          if (!item || typeof item !== 'object') continue;
          const pkg = item.packageName || item.package_name || item.package || item.name;
          const name = item.appLabel || item.label || item.appName || item.applicationLabel || item.title;
          if (packagePattern.test(pkg) && typeof name === 'string') {
            const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 95);
            if (cleaned) packages.set(pkg, cleaned);
          }
        }
      }
      renderRules();
      renderStatus();
    } catch { /* Package labels are optional. */ }
  }
  const ruleDialog = $('rule-dialog');
  const appInput = $('app-input');
  const appPicker = $('app-picker');
  const appList = $('installed-apps');
  const appListToggle = $('app-list-toggle');
  let installedApps = [], suggestionsRequested = false, activeApp;
  const appIcons = new Map();
  const hasIconBridge = typeof window.ksu?.getPackagesIcons === 'function';
  const hasIconScheme = typeof window.ksu?.pm === 'function' || typeof window.ksu?.listPackages === 'function';
  const appIconObserver = (hasIconBridge || hasIconScheme) && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      if (appList.hidden) return;
      const visible = entries.filter(({ isIntersecting, target }) => isIntersecting && appList.contains(target));
      for (const { target } of visible) appIconObserver.unobserve(target);
      loadAppIcons(visible.map(({ target }) => target));
    }, { root: appList }) : null;

  function loadAppIcons(options) {
    const ids = options.map(option => option.dataset.pkg);
    const missing = hasIconBridge ? ids.filter(pkg => !appIcons.has(pkg)) : [];
    if (missing.length) {
      // The bridge encodes bitmaps synchronously; only request visible, uncached rows.
      for (const pkg of missing) appIcons.set(pkg, '');
      try {
        const icons = JSON.parse(window.ksu.getPackagesIcons(JSON.stringify(missing), 64));
        if (!Array.isArray(icons)) throw new TypeError('Invalid app icons response');
        const requested = new Set(missing);
        for (const entry of icons) {
          const { packageName, icon } = entry || {};
          if (requested.has(packageName) && typeof icon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(icon)) {
            appIcons.set(packageName, icon);
          }
        }
      } catch { /* Managers may not expose application icons. */ }
    }
    for (const option of options) {
      const pkg = option.dataset.pkg;
      const src = appIcons.get(pkg) || (hasIconScheme ? `ksu://icon/${pkg}` : '');
      if (!src) continue;
      const icon = option.querySelector('.app-suggestion-icon');
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('load', () => icon.replaceChildren(image), { once: true });
      image.addEventListener('error', () => appIcons.set(pkg, ''), { once: true });
      image.src = src;
    }
  }

  function positionRuleDialog() {
    const viewport = window.visualViewport;
    ruleDialog.style.setProperty('--rule-viewport-top', `${viewport?.offsetTop || 0}px`);
    ruleDialog.style.setProperty('--rule-viewport-height', `${viewport?.height || window.innerHeight}px`);
  }
  function setAppListVisible(visible) {
    appList.hidden = !visible;
    appInput.setAttribute('aria-expanded', String(visible));
    appListToggle.setAttribute('aria-expanded', String(visible));
  }
  function highlightApp(option) {
    activeApp?.setAttribute('aria-selected', 'false');
    activeApp = option;
    if (!option) {
      appInput.removeAttribute('aria-activedescendant');
      return;
    }
    option.setAttribute('aria-selected', 'true');
    appInput.setAttribute('aria-activedescendant', option.id);
    const bounds = option.getBoundingClientRect();
    const top = appList.getBoundingClientRect().top + appList.clientTop;
    const bottom = top + appList.clientHeight;
    if (bounds.top < top || bounds.height > appList.clientHeight) appList.scrollTop += bounds.top - top;
    else if (bounds.bottom > bottom) appList.scrollTop += bounds.bottom - bottom;
  }
  function closeAppList() {
    suggestionsRequested = false;
    highlightApp();
    appIconObserver?.disconnect();
    setAppListVisible(false);
  }
  function renderAppList(keepHighlight = false) {
    if (!ruleDialog.open || !suggestionsRequested) return;
    const previous = keepHighlight ? activeApp?.dataset.pkg : null;
    const query = appInput.value.trim().toLowerCase();
    const items = [];
    let nextActive;
    for (const pkg of installedApps) {
      const name = appName(pkg);
      if (!pkg.toLowerCase().includes(query) && !name.toLowerCase().includes(query)) continue;
      const option = document.createElement('div');
      option.id = `app-suggestion-${items.length}`;
      option.className = 'app-suggestion';
      option.dataset.pkg = pkg;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const icon = document.createElement('span');
      icon.className = 'app-suggestion-icon';
      icon.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('span');
      glyph.className = 'symbol app-icon';
      icon.append(glyph);
      const text = document.createElement('span');
      text.className = 'app-suggestion-text';
      const packageText = document.createElement('span');
      packageText.textContent = pkg;
      text.append(packageText);
      if (name !== pkg) {
        const label = document.createElement('small');
        label.textContent = name;
        text.append(label);
      }
      option.append(icon, text);
      if (pkg === previous) nextActive = option;
      items.push(option);
    }
    appIconObserver?.disconnect();
    appList.replaceChildren(...items);
    setAppListVisible(items.length > 0);
    if (!nextActive) appList.scrollTop = 0;
    highlightApp(nextActive);
    if (appIconObserver) for (const option of items) appIconObserver.observe(option);
  }
  function loadApps() {
    if (!appJob) appJob = exec('apps').then(async text => {
      installedApps = [...new Set(text.split('\n').map(line => line.replace(/^package:/, '').trim()).filter(pkg => packagePattern.test(pkg)))].sort();
      renderAppList(true);
      await loadNames(installedApps);
      renderAppList(true);
    }).catch(() => { appJob = undefined; });
    return appJob;
  }
  function chooseApp(option) {
    appInput.value = option.dataset.pkg;
    closeAppList();
    appInput.focus({ preventScroll: true });
  }
  function bindAppPicker() {
    const showList = () => { suggestionsRequested = true; renderAppList(); };
    appInput.addEventListener('input', event => { if (!event.isComposing) showList(); });
    appInput.addEventListener('compositionend', showList);
    appInput.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          if (appList.hidden) showList();
          if (appList.hidden) return;
          const down = event.key === 'ArrowDown';
          const next = activeApp
            ? (down ? activeApp.nextElementSibling : activeApp.previousElementSibling)
            : (down ? appList.firstElementChild : appList.lastElementChild);
          if (next) highlightApp(next);
          break;
        }
        case 'Enter':
          if (!activeApp) return;
          chooseApp(activeApp);
          break;
        case 'Escape':
          if (appList.hidden) return;
          closeAppList();
          break;
        case 'Tab': closeAppList(); return;
        default: return;
      }
      event.preventDefault();
    });
    appListToggle.addEventListener('mousedown', event => event.preventDefault());
    appListToggle.onclick = () => {
      if (suggestionsRequested) closeAppList();
      else showList();
      appInput.focus({ preventScroll: true });
    };
    appList.addEventListener('mousedown', event => {
      if (event.target.closest('.app-suggestion')) event.preventDefault();
    });
    appList.onclick = event => {
      const option = event.target.closest('.app-suggestion');
      if (option) chooseApp(option);
    };
    // Dismiss after the click target is known, before its handler opens another menu.
    ruleDialog.addEventListener('click', event => { if (!appPicker.contains(event.target)) closeAppList(); }, true);
    ruleDialog.addEventListener('cancel', event => {
      if (appList.hidden) return;
      event.preventDefault();
      closeAppList();
    });
    ruleDialog.addEventListener('close', () => { if (!ruleDialog.open) closeAppList(); });
    const reposition = () => { if (ruleDialog.open) positionRuleDialog(); };
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
  }
  function refreshStatus() {
    if (statusJob) return statusJob;
    statusJob = exec('status').then(text => {
      status = parseFields(text);
      renderStatus();
    }).catch(() => notify('failed', true)).finally(() => { statusJob = undefined; schedule(); });
    return statusJob;
  }
  function schedule() {
    clearTimeout(timer);
    if (page === 'overview' && !document.hidden && !busy && !statusJob) timer = setTimeout(refreshStatus, 15000);
  }
  function setBusy(value) { busy = value; renderStatus(); updateDirty(); schedule(); }
  async function save() {
    if (busy || !profile) return false;
    setBusy(true);
    try {
      const snapshot = serializeProfile(profile);
      const shortcutsSnapshot = JSON.stringify(shortcuts);
      const payload = encode(snapshot);
      if (payload.length > 60000) throw new Error('config_invalid');
      if (snapshot !== original) await exec('save', payload);
      original = snapshot;
      originalShortcuts = shortcutsSnapshot;
      writePref('touch-ui-shortcuts-v2', originalShortcuts);
      await refreshStatus();
      notify('saved');
      return true;
    } catch (error) {
      notify(error.message || 'failed', true);
      return false;
    } finally { setBusy(false); }
  }
  function discard() {
    if (!original) return;
    profile = parseProfile(original);
    shortcuts = JSON.parse(originalShortcuts);
    renderProfile();
  }
  async function allowLeave() {
    if (!dirty()) return true;
    if (busy || $('confirm-dialog').open) return false;
    const dialog = $('confirm-dialog');
    dialog.returnValue = 'cancel';
    const result = new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once:true }));
    dialog.showModal();
    switch (await result) {
      case 'save': return save();
      case 'discard': discard(); return true;
      default: return false;
    }
  }
  async function navigate(next) {
    if (next === page || !(await allowLeave())) return;
    page = next;
    for (const tab of document.querySelectorAll('[data-page]')) {
      const active = tab.dataset.page === page;
      $(tab.dataset.page).hidden = !active;
      if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
    schedule();
    if (next !== 'rules') refreshStatus();
  }
  async function changeEnabled(wanted) {
    if (busy || !(await allowLeave())) { renderStatus(); return; }
    setBusy(true);
    try { await exec(wanted ? 'enable' : 'disable'); await refreshStatus(); }
    catch (error) { notify(error.message || 'failed', true); }
    finally { setBusy(false); }
  }
  async function runResync() {
    if (busy || status.enabled !== '1') return;
    setBusy(true);
    try { await exec('resync'); await refreshStatus(); notify('resyncSent'); }
    catch (error) { notify(error.message || 'failed', true); }
    finally { setBusy(false); }
  }
  function bindDraft(id, key, property = 'value') {
    $(id).addEventListener('input', () => {
      if (!profile) return;
      profile[key] = $(id)[property];
      if (id === 'rates-text') { renderRules(); renderShortcuts(); }
      updateDirty();
    });
  }
  function bind() {
    bindDropdown();
    bindAppPicker();
    for (const tab of document.querySelectorAll('[data-page]')) tab.onclick = () => navigate(tab.dataset.page);
    bindDraft('global-rate', 'global');
    bindDraft('rates-text', 'rates');
    bindDraft('fallback-enabled', 'fallback', 'checked');
    bindDraft('fallback-items', 'watch');
    bindDraft('poll-interval', 'interval');
    $('search').oninput = renderRules;
    $('save').onclick = save;
    $('discard').onclick = discard;
    $('enabled').onchange = () => changeEnabled($('enabled').checked);
    $('resync').onclick = runResync;
    $('refresh').onclick = () => { if (!profile) fetchProfile(); refreshStatus(); };
    $('preferences').onclick = () => $('prefs-dialog').showModal();
    $('add-rule').onclick = () => {
      if (!profile) return;
      appInput.value = '';
      closeAppList();
      options($('app-rate'), profile.global);
      ruleDialog.scrollTop = 0;
      positionRuleDialog();
      ruleDialog.showModal();
      loadApps();
    };
    $('cancel-rule').onclick = () => ruleDialog.close();
    $('rule-form').onsubmit = event => {
      event.preventDefault();
      const pkg = appInput.value.trim();
      if (!packagePattern.test(pkg) || !$('app-rate').value) return;
      profile.rules.set(pkg, $('app-rate').value);
      if (packages.get(pkg)) profile.names.set(pkg, packages.get(pkg));
      ruleDialog.close();
      renderRules();
      updateDirty();
    };
    $('load-logs').onclick = async () => {
      $('load-logs').disabled = true;
      try {
        rawLog = (await exec('logs')).trim();
        $('log-output').textContent = rawLog || t('unavailable');
        $('copy-logs').disabled = !rawLog;
      } catch { notify('failed', true); }
      finally { $('load-logs').disabled = false; }
    };
    $('copy-logs').onclick = async () => {
      try { await navigator.clipboard.writeText(rawLog); notify('copied'); }
      catch {
        const range = document.createRange();
        range.selectNodeContents($('log-output'));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        if (document.execCommand('copy')) { selection.removeAllRanges(); notify('copied'); }
      }
    };
    for (const preference of ['theme', 'language']) {
      const key = `touch-ui-${preference}-mode`;
      $(preference).value = readPref(key, 'system');
      $(preference).onchange = () => { writePref(key, $(preference).value); translate(); };
    }
    themeMedia.addEventListener('change', translate);
    window.addEventListener('languagechange', translate);
    document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden) refreshStatus(); });
    window.addEventListener('beforeunload', event => {
      if (dirty()) { event.preventDefault(); event.returnValue = ''; }
    });
    history.replaceState({ colorosBase:true }, '');
    history.pushState({ colorosGuard:true }, '');
    window.addEventListener('popstate', async () => {
      if (!history.state?.colorosBase) return;
      history.pushState({ colorosGuard:true }, '');
      if (activeDropdown) { closeDropdown(); return; }
      if (page !== 'overview') { await navigate('overview'); return; }
      if (!(await allowLeave())) return;
      if (typeof manager?.exit === 'function') manager.exit();
      else if (preview) history.go(-2);
    });
  }

  function readShortcuts() {
    try {
      const current = JSON.parse(readPref('touch-ui-shortcuts-v2', 'null'));
      const legacy = JSON.parse(readPref('touch-ui-shortcuts', 'null'));
      const slots = current || legacy;
      if (Array.isArray(slots) && slots.length === 3) {
        return slots.map(slot => {
          const action = typeof slot === 'string' ? slot : slot?.action;
          const migrated = action === 'enable' ? 'turnOn' : action === 'disable' ? 'turnOff' : action;
          const rate = String(slot?.rate || '360');
          return { action: shortcutOptions.includes(migrated) ? migrated : 'none', rate: /^[1-9]\d{0,3}$/.test(rate) ? rate : '360' };
        });
      }
    } catch { /* Use default actions when preferences cannot be read. */ }
    return ['calcRule', 'resync', 'diagnostics'].map(action => ({ action, rate: '360' }));
  }
  shortcuts = readShortcuts();
  originalShortcuts = JSON.stringify(shortcuts);
  bind();
  translate();
  fetchProfile();
  refreshStatus();
})();
