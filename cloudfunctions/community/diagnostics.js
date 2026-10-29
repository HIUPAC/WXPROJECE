// Classify errors without logging credentials, request data, or private content.
function diagnostic(error, action) {
  const message = String(error && (error.errMsg || error.message) || '');
  const code = String(error && (error.code || error.errCode) || 'UNKNOWN');
  const requestId = String(error && (error.requestId || error.reqId || error.requestID) || '');
  let reason = 'SERVICE_ERROR';
  if (/DATABASE_COLLECTION_NOT_EXIST|collection.*(?:does not exist|not exist|not found)/i.test(code + ' ' + message)) reason = 'COLLECTION_MISSING';
  else if (/MODULE_NOT_FOUND|Cannot find module/i.test(code + ' ' + message)) reason = 'DEPENDENCY_MISSING';
  else if (/permission|denied|forbidden|unauthorized/i.test(code + ' ' + message)) reason = 'PERMISSION_DENIED';
  else if (/timeout|network|超时|网络/i.test(code + ' ' + message)) reason = 'NETWORK_ERROR';
  else if (/index.*(?:required|not found|not exist)|索引/i.test(code + ' ' + message)) reason = 'INDEX_ERROR';
  else if (error && error.name === 'TypeError') reason = 'RUNTIME_ERROR';
  const collection = (message.match(/\bcommunity_(?:users|identities|sessions|notes|views|rates|uploads)\b/) || [])[0] || '';
  return { action: /^[A-Za-z]{1,40}$/.test(action || '') ? action : 'unknown', reason, collection,
    code: /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : 'UNKNOWN',
    requestId: /^[A-Za-z0-9_-]{1,100}$/.test(requestId) ? requestId : '' };
}
module.exports = { diagnostic };
