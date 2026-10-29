const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextChecker } = require('../cloudfunctions/community/moderation');

test('platform text checks cover long unicode content with overlapping bounded chunks', async () => {
  const requests = [];
  const checker = createTextChecker({ async msgSecCheck(value) { requests.push(value); return { errCode: 0, result: { suggest: 'pass' } }; } });
  const text = '🌿'.repeat(6000);
  assert.equal((await checker(text, { openid: 'wx-user' }, 4)).status, 'pass');
  assert.equal(requests.length, 3);
  assert.equal(requests.every(value => value.version === 2 && value.scene === 4 && value.openid === 'wx-user'), true);
  assert.equal(requests.every(value => Array.from(value.content).length <= 2400), true);
  assert.equal(requests.map(value => Array.from(value.content).length).reduce((sum, value) => sum + value, 0), 6200);
});

test('risky, review, quota failures, exceptions and missing APIs cannot authorize publication', async () => {
  for (const suggest of ['risky', 'review', undefined]) {
    const checker = createTextChecker({ async msgSecCheck() { return { errcode: 0, result: { suggest } }; } });
    assert.equal((await checker('内容', { openid: 'wx' })).status, 'blocked');
  }
  for (const response of [{ errcode: 45009, result: { suggest: 'pass' } }, { result: { suggest: 'pass' } }, null]) {
    const checker = createTextChecker({ async msgSecCheck() { return response; } });
    assert.equal((await checker('内容', { openid: 'wx' })).status, 'unavailable');
  }
  assert.equal((await createTextChecker(null)('内容', { openid: 'wx' })).status, 'unavailable');
  assert.equal((await createTextChecker({ async msgSecCheck() { throw new Error('timeout'); } })('内容', { openid: 'wx' })).status, 'unavailable');
});
