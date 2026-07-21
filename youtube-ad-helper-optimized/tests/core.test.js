'use strict';

const assert = require('node:assert/strict');
const Core = require('../core.js');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('只接受精确的 YouTube Studio HTTPS 地址', () => {
  assert.equal(Core.isStudioUrl('https://studio.youtube.com/video/abc'), true);
  assert.equal(Core.isStudioUrl('http://studio.youtube.com/video/abc'), false);
  assert.equal(Core.isStudioUrl('https://studio.youtube.com.evil.example/'), false);
  assert.equal(Core.isStudioUrl('not-a-url'), false);
});

test('严格验证整数配置', () => {
  assert.equal(Core.normalizeConfig({ mode: 'manual', startTime: '10', endBuffer: '60', interval: '300' }).ok, true);
  assert.equal(Core.normalizeConfig({ mode: 'manual', startTime: '1.5', endBuffer: '60', interval: '300' }).ok, false);
  assert.equal(Core.normalizeConfig({ mode: 'manual', startTime: '-1', endBuffer: '60', interval: '300' }).ok, false);
  assert.equal(Core.normalizeConfig({ mode: 'manual', startTime: '10', endBuffer: '60', interval: '0' }).ok, false);
});

test('自动模式根据视频时长选档', () => {
  const config = { mode: 'auto', tier1: 300, tier2: 480, tier3: 600 };
  assert.equal(Core.selectInterval(1800, config), 300);
  assert.equal(Core.selectInterval(1801, config), 480);
  assert.equal(Core.selectInterval(3599, config), 480);
  assert.equal(Core.selectInterval(3600, config), 600);
});

test('计划不进入结尾安全区', () => {
  const plan = Core.buildSchedule({ duration: 600, startTime: 120, interval: 120, endBuffer: 60 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.times, [120, 240, 360, 480]);
  assert.equal(plan.times.includes(600), false);
});

test('拒绝不足八分钟的视频', () => {
  const plan = Core.buildSchedule({ duration: 479, startTime: 60, interval: 120, endBuffer: 60 });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /8 分钟/);
});

test('拒绝超过最大数量的计划', () => {
  const plan = Core.buildSchedule({ duration: 7200, startTime: 0, interval: 1, endBuffer: 0, maxSlots: 100 });
  assert.equal(plan.ok, false);
  assert.equal(plan.times.length, 100);
});

test('解析页面时间并拒绝无效秒数', () => {
  assert.equal(Core.parseDisplayTime('01:02:03:00'), 3723);
  assert.equal(Core.parseDisplayTime('62:03:00'), 3723);
  assert.equal(Core.parseDisplayTime('01:99:00'), null);
  assert.equal(Core.parseDisplayTime('foo:bar:baz'), null);
  assert.equal(Core.parseAnyTime('播放头 1 小时 2 分钟 3 秒'), 3723);
  assert.equal(Core.parseAnyTime('playhead 1 hour 2 minutes 3 seconds'), 3723);
});

test('按页面格式生成时间字符串', () => {
  assert.equal(Core.formatTime(3723, 4), '1:02:03:00');
  assert.equal(Core.formatTime(3723, 3), '62:03:00');
  assert.equal(Core.formatClock(3723), '1:02:03');
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`✗ ${name}\n${error.stack}\n`);
  }
}

if (failed > 0) process.exitCode = 1;
else process.stdout.write(`\n${tests.length} 项测试全部通过。\n`);
