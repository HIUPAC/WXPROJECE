// Every submitted chunk must receive an explicit pass. Unknown results fail closed.
function createTextChecker(api) {
  return async function check(content, context, scene = 4) {
    if (!api || typeof api.msgSecCheck !== 'function') return { status: 'unavailable' };
    const characters = Array.from(content);
    try {
      // The API accepts 2500 characters. Overlap also checks phrases across chunks.
      for (let offset = 0; offset < characters.length; offset += 2300) {
        const result = await api.msgSecCheck({ content: characters.slice(offset, offset + 2400).join(''),
          version: 2, scene, openid: context.openid });
        const code = result && (result.errCode === undefined ? result.errcode : result.errCode);
        if (code !== 0 || !result.result) return { status: 'unavailable' };
        if (result.result.suggest !== 'pass') return { status: 'blocked' };
      }
      return { status: 'pass' };
    } catch (error) { return { status: 'unavailable' }; }
  };
}
module.exports = { createTextChecker };
