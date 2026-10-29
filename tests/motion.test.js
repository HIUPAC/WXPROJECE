const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const writes = [], callbacks = [], cleared = [], timers = new Map();
  let sequence = 0;
  const context = { module: { exports: {} },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { cleared.push(id); timers.delete(id); }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/services/motion.js'), 'utf8'), context);
  const motion = context.module.exports;
  const page = { data: { uiPhase: '' }, setData(delta, callback) {
    writes.push({ ...delta });
    Object.assign(this.data, delta);
    if (callback) callbacks.push(callback);
  } };
  let headerDefinition;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/components/page-header/index.js'), 'utf8'), {
    Component(value) { headerDefinition = value; }, require: () => motion, getCurrentPages: () => [page], wx: {}
  });
  return { motion, page, writes, callbacks, cleared, timers, headerDefinition };
}

test('page entry starts after the data commit and removes its transform after the animation', () => {
  const { motion, page, writes, callbacks, timers } = fixture();
  motion.enter(page);
  assert.deepEqual(writes, [{ uiPhase: '' }]);
  assert.equal(timers.size, 0);
  callbacks.shift()();
  assert.equal(page.data.uiPhase, 'ui-enter');
  assert.equal(timers.size, 1);
  const timer = timers.get(page._uiMotionTimer);
  assert.equal(timer.delay, 300);
  timer.callback();
  assert.equal(page.data.uiPhase, '');
  assert.equal(page._uiMotionTimer, null);
  assert.deepEqual(writes, [{ uiPhase: '' }, { uiPhase: 'ui-enter' }, { uiPhase: '' }]);
});

test('hiding a page before its pending data commit prevents animation writes and timers', () => {
  const { page, writes, callbacks, timers, headerDefinition } = fixture();
  const header = {};
  headerDefinition.pageLifetimes.show.call(header);
  assert.equal(header._motionPage, page);
  headerDefinition.pageLifetimes.hide.call(header);
  callbacks.shift()();
  assert.deepEqual(writes, [{ uiPhase: '' }]);
  assert.equal(timers.size, 0);
});

test('hiding an animated page cancels its timer and rejects an already queued timer callback', () => {
  const { page, writes, callbacks, timers, cleared, headerDefinition } = fixture();
  const header = {};
  headerDefinition.pageLifetimes.show.call(header);
  callbacks.shift()();
  const id = page._uiMotionTimer;
  const staleCallback = timers.get(id).callback;
  headerDefinition.pageLifetimes.hide.call(header);
  assert.deepEqual(cleared, [id]);
  assert.equal(timers.size, 0);
  assert.equal(page._uiMotionTimer, null);
  const count = writes.length;
  staleCallback();
  assert.equal(writes.length, count);
});

test('unloading the header cancels animation and does not write to its detached page', () => {
  const { page, writes, callbacks, timers, headerDefinition } = fixture();
  const header = {};
  headerDefinition.pageLifetimes.show.call(header);
  callbacks.shift()();
  const staleCallback = timers.get(page._uiMotionTimer).callback;
  headerDefinition.lifetimes.detached.call(header);
  assert.equal(header._motionPage, null);
  assert.equal(timers.size, 0);
  const count = writes.length;
  staleCallback();
  assert.equal(writes.length, count);
});

test('unloading before the data commit prevents a detached page from starting animation', () => {
  const { writes, callbacks, timers, headerDefinition } = fixture();
  const header = {};
  headerDefinition.pageLifetimes.show.call(header);
  headerDefinition.lifetimes.detached.call(header);
  callbacks.shift()();
  assert.deepEqual(writes, [{ uiPhase: '' }]);
  assert.equal(timers.size, 0);
});

test('rapid reentry ignores old commits and old timers while preserving the current animation', () => {
  const { motion, page, writes, callbacks, timers } = fixture();
  motion.enter(page);
  motion.enter(page);
  callbacks.shift()();
  assert.equal(timers.size, 0);
  callbacks.shift()();
  const oldTimer = timers.get(page._uiMotionTimer).callback;
  motion.enter(page);
  assert.equal(timers.size, 0);
  callbacks.shift()();
  const currentId = page._uiMotionTimer;
  const count = writes.length;
  oldTimer();
  assert.equal(writes.length, count);
  assert.equal(page._uiMotionTimer, currentId);
  assert.equal(page.data.uiPhase, 'ui-enter');
  assert.equal(timers.size, 1);
  timers.get(currentId).callback();
  assert.equal(page.data.uiPhase, '');
});

test('missing pages and repeated cleanup are safe for absent native lifecycle targets', () => {
  const { motion, timers, writes } = fixture();
  assert.doesNotThrow(() => { motion.enter(null); motion.enter({}); motion.stop(null); motion.stop(undefined); });
  assert.equal(timers.size, 0);
  assert.equal(writes.length, 0);
});
