// wx-server-sdk uses { data } for document writes, including inside transactions.
function createRepository(db, source = db) {
  function condition(filter) {
    const command = db.command;
    const clauses = [];
    if (filter.scope === 'my') clauses.push({ authorId: filter.userId });
    else if (filter.scope === 'public') clauses.push({ visibility: 'public' });
    else clauses.push(command.or({ visibility: 'public' }, { authorId: filter.userId }));
    if (filter.ids) clauses.push({ _id: command.in(filter.ids) });
    if (filter.relatedKey) clauses.push({ relatedKey: filter.relatedKey });
    if (filter.query) {
      const escaped = filter.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = db.RegExp({ regexp: escaped, options: 'i' });
      clauses.push(command.or({ title: regex }, { body: regex }));
    }
    return clauses.length === 1 ? clauses[0] : command.and(...clauses);
  }
  function query(collection, filter) { return source.collection(collection).where(condition(filter)); }
  function groups(ids) {
    const result = [];
    const uniqueIds = [...new Set(ids)];
    // Keep in-queries small and work with environments imposing stricter limits.
    for (let index = 0; index < uniqueIds.length; index += 20) result.push(uniqueIds.slice(index, index + 20));
    return result;
  }
  async function listNotes(collection, filter, { offset = 0, limit = 20 } = {}) {
    if (filter.ids) {
      const batches = await Promise.all(groups(filter.ids).map((ids) =>
        query(collection, Object.assign({}, filter, { ids })).limit(20).get()
      ));
      return batches.flatMap((result) => result.data || [])
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
        .slice(offset, offset + limit);
    }
    const result = await query(collection, filter).orderBy('updatedAt', 'desc').orderBy('_id', 'desc').skip(offset).limit(limit).get();
    return result.data || [];
  }
  async function countNotes(collection, filter) {
    if (filter.ids) {
      const results = await Promise.all(groups(filter.ids).map((ids) => query(collection, Object.assign({}, filter, { ids })).count()));
      return results.reduce((total, result) => total + result.total, 0);
    }
    return (await query(collection, filter).count()).total;
  }
  return {
    async get(collection, id) {
      try {
        const result = await source.collection(collection).doc(id).get();
        return result.data || null;
      } catch (error) {
        // Missing collections, network errors, and permission errors must surface.
        const message = String(error.errMsg || error.message || '');
        if (/document.*(?:does not exist|not exist|not found)|DOCUMENT_NOT_EXIST|文档不存在/i.test(message)) return null;
        throw error;
      }
    },
    async put(collection, id, value) {
      const data = Object.assign({}, value);
      delete data._id;
      delete data._openid;
      return source.collection(collection).doc(id).set({ data });
    },
    remove: (collection, id) => source.collection(collection).doc(id).remove(),
    listNotes, countNotes,
    transaction: (callback) => db.runTransaction((transaction) => callback(createRepository(db, transaction)), 5)
  };
}
module.exports = { createRepository };
