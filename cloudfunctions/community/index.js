const cloud = require('wx-server-sdk');
const { createCommunity } = require('./core');
const { createRepository } = require('./repository');
const { createTextChecker } = require('./moderation');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const repo = createRepository(cloud.database({ throwOnNotFound: false }));

function imageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 2 * 1024 * 1024) return false;
  return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) ||
    /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii')) ||
    (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
}
const handle = createCommunity({
  repo,
  // Re-enable only after an asynchronous image review lifecycle is implemented.
  allowAvatarUploads: false,
  verifyText: createTextChecker(cloud.openapi && cloud.openapi.security),
  onServiceError(details) { console.error('[community] service failed', details); },
  async verifyAvatar(fileId, context) {
    // File IDs identify an environment and a bucket; reject external environments.
    const environment = String(fileId).slice(8).split('/')[0].split('.')[0];
    if (context.env && environment !== context.env) return false;
    try { return imageBuffer((await cloud.downloadFile({ fileID: fileId })).fileContent); }
    catch (error) { return false; }
  }
});
exports.main = async (event) => {
  const context = cloud.getWXContext();
  return handle(event, { openid: context.OPENID, env: context.ENV });
};
