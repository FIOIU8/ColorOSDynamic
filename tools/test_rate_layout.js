'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProfile, serializeProfile, rewriteEntries } = require('../module/webroot/script');

const rates = '# standard\n125=touchHidlTest -c wo 0 26 0\n\n# compat\n360=touchHidlTest -c wo 0 26 12c\n';
const sample = `schema=1\nbackend=shell\n[rules]\n# base\nglobal_sample_rate=125\ncom.example.game=360\n[rates]\n${rates}\n[monitor]\nfallback_enabled=1\npoll_interval=3\nfallback_method=polling\nfallback_app=com.example.game\n[names]\ncom.example.game=示例游戏\n`;

test('mapping text stays byte-identical', () => assert.equal(serializeProfile(parseProfile(sample)), sample));
test('map insertion is repeatable', () => {
  const profile = parseProfile(sample);
  profile.rules.set('com.example.other', '360');
  const result = serializeProfile(profile);
  assert.equal(result.match(/^com\.example\.other=360$/gm).length, 1);
  assert.equal(serializeProfile(parseProfile(result)), result);
});
test('deleted rules retain their comments', () => assert.equal(rewriteEntries('# app\ncom.example.game=360\n', []), '# app\n'));
test('last duplicate entry wins', () => assert.equal(rewriteEntries('x=1\n# comment\nx=2', [['x', '2']]), '# comment\nx=2'));
test('CRLF imports normalize for Android', () => assert.equal(serializeProfile(parseProfile(sample.replaceAll('\n', '\r\n'))), sample));
test('watchlist and Unicode names load', () => {
  const profile = parseProfile(sample);
  assert.equal(profile.watch, 'com.example.game');
  assert.equal(profile.names.get('com.example.game'), '示例游戏');
});
test('incomplete and unknown schemas are rejected', () => {
  assert.throws(() => parseProfile(sample.replace('[names]', '[legacy]')), /config_invalid/);
  assert.throws(() => parseProfile(sample.replace('schema=1', 'schema=2')), /config_invalid/);
});
test('backend setting and custom mapping comments survive reload', () => {
  const profile = parseProfile(sample);
  profile.backend = 'rust';
  const loaded = parseProfile(serializeProfile(profile));
  assert.equal(loaded.backend, 'rust');
  assert.equal(loaded.rates, rates);
});
