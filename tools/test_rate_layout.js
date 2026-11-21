// C2 回归测试：从 _unpacked/webroot/script.js 里提取真实函数执行，
// 不复制实现，确保测的就是 WebUI 实际使用的代码。
// 运行：node tools/test_rate_layout.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const srcPath = path.join(__dirname, '..', '_unpacked', 'webroot', 'script.js');
const src = fs.readFileSync(srcPath, 'utf8');
const originalConf = fs.readFileSync(
  path.join(__dirname, '..', '_unpacked', 'rate_code.conf'), 'utf8');

function extract(name) {
  const re = new RegExp(`\\n  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`);
  const m = src.match(re);
  if (!m) throw new Error(`cannot extract ${name}() from script.js`);
  return m[0];
}

const cpMatch = src.match(/const COMMAND_PATTERN = (\/\^.*?\$\/);/);
assert(cpMatch, 'COMMAND_PATTERN not found');
const COMMAND_PATTERN = new Function('return ' + cpMatch[1])();

const state = { rates: new Map(), rateLayout: [] };
const api = new Function('COMMAND_PATTERN', 'state',
  extract('parseRates') + '\n' + extract('parseRateLayout') + '\n' +
  extract('serializeRates') + '\n' +
  'return { parseRates, parseRateLayout, serializeRates };')(COMMAND_PATTERN, state);

const { parseRates, parseRateLayout, serializeRates } = api;
const results = [];
function check(label, fn) {
  fn();
  results.push(label);
  console.log('PASS', label);
}

function reset(text) {
  state.rates = parseRates(text);
  state.rateLayout = parseRateLayout(text);
}

// 1. 原文件无改动保存，必须逐字节一致（注释块、空行、顺序全部保留）
check('no-op save is byte-identical to source file', () => {
  reset(originalConf);
  assert.strictEqual(serializeRates().text, originalConf);
});

// 2. 删除映射：其上方注释作为孤立注释保留，该 rate 行消失
check('deleting a rate keeps its orphaned comment and removes the line', () => {
  reset(originalConf);
  state.rates.delete('241');
  const out = serializeRates();
  assert(out.text.includes('#特殊兼容指令'), 'comment must survive');
  assert(!/^241=/m.test(out.text), 'deleted rate line must be gone');
  assert(/^125=/m.test(out.text) && /^600=/m.test(out.text), 'other rates must remain');
  assert.strictEqual((out.text.match(/#特殊兼容指令/g) || []).length, 3);
});

// 3. 新增映射追加到文件末尾，且只出现一次
check('new rate is appended once at the end', () => {
  reset(originalConf);
  state.rates.set('700', 'touchHidlTest -c wo 0 26 1');
  const out = serializeRates();
  assert(out.text.trimEnd().endsWith('700=touchHidlTest -c wo 0 26 1'));
  assert.strictEqual((out.text.match(/^700=/gm) || []).length, 1);
  assert(out.text.includes('#兼容性指令放在此处下面会被默认隐藏'), 'original comments kept');
});

// 4. 写盘成功后提交 layout，连续保存不会重复追加
check('committing layout prevents duplicate appends on a second save', () => {
  reset(originalConf);
  state.rates.set('700', 'touchHidlTest -c wo 0 26 1');
  const first = serializeRates();
  state.rateLayout = first.layout;
  const second = serializeRates();
  assert.strictEqual(second.text, first.text);
  assert.strictEqual((second.text.match(/^700=/gm) || []).length, 1);
});

// 5. 重复 rate 行去重，只输出第一个
check('duplicate rate lines are deduplicated', () => {
  const dup = '#a\n125=touchHidlTest -c wo 0 26 0\n# mid\n125=touchHidlTest -c wo 0 26 1\n';
  reset(dup);
  const out = serializeRates();
  assert.strictEqual((out.text.match(/^125=/gm) || []).length, 1);
  assert(out.text.includes('# mid'), 'comment between duplicates kept');
});

// 6. layout 为空时退化为按数字排序的全量输出
check('empty layout falls back to full sorted output', () => {
  reset(originalConf);
  state.rateLayout = [];
  const out = serializeRates();
  const nums = [...out.text.matchAll(/^(\d{1,4})=/gm)].map((m) => Number(m[1]));
  assert.deepStrictEqual(nums, [...nums].sort((a, b) => a - b));
  assert.strictEqual(nums.length, state.rates.size);
  assert(!out.text.includes('#'), 'no comments in fallback mode, matching legacy behaviour');
});

// 7. 无法识别的行与空行原样保留
check('unrecognised and blank lines are preserved as raw', () => {
  const weird = '# head\nnot-a-rate\n\n125=touchHidlTest -c wo 0 26 0\n  # indented\n';
  reset(weird);
  const out = serializeRates();
  for (const fragment of ['# head', 'not-a-rate', '  # indented']) {
    assert(out.text.includes(fragment), `missing raw line: ${fragment}`);
  }
  assert.strictEqual(parseRateLayout(weird).filter((e) => e.type === 'raw').length, 4);
});

// 8. rateLayout 不得进入脏检查 / 快照，否则注释变化会误触发「未保存」
check('snapshot() and updateDirty() do not reference rateLayout', () => {
  const snap = extract('snapshot');
  const dirty = extract('updateDirty');
  assert(!snap.includes('rateLayout'), 'snapshot() must not use rateLayout');
  assert(!dirty.includes('rateLayout'), 'updateDirty() must not use rateLayout');
});

console.log(`\n${results.length}/8 checks passed`);
