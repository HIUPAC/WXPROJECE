const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommunity } = require('../cloudfunctions/community/core');

test('a missing registration collection yields a safe diagnostic and retains the generic user-facing failure', async () => {
  const logs = [];
  const error = new Error('collection community_rates does not exist; password=private-password; body=private-body');
  error.code = 'DATABASE_COLLECTION_NOT_EXIST';
  error.reqId = 'request-123';
  const handle = createCommunity({
    repo: { transaction: async () => { throw error; } },
    onServiceError: entry => logs.push(entry)
  });
  const result = await handle({ action: 'register', studentId: 'A001', phone: '13812345678', username: '林', password: 'private-password' }, { openid: 'wechat-1' });
  assert.equal(result.code, 'SERVICE_UNAVAILABLE');
  assert.equal(logs[0].action, 'register');
  assert.equal(logs[0].reason, 'COLLECTION_MISSING');
  assert.equal(logs[0].collection, 'community_rates');
  assert.equal(logs[0].requestId, 'request-123');
  assert.equal(JSON.stringify(logs).includes('private-password'), false);
  assert.equal(JSON.stringify(logs).includes('private-body'), false);
});

test('failure reporting cannot break the response if the logging sink throws', async () => {
  const handle = createCommunity({
    repo: { transaction: async () => { throw new TypeError('runtime failure'); } },
    onServiceError: () => { throw new Error('logging unavailable'); }
  });
  const result = await handle({ action: 'register', studentId: 'A001', phone: '13812345678', username: '林', password: 'password123' }, { openid: 'wechat-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SERVICE_UNAVAILABLE');
});
