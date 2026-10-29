const community = require('./community');
const content = require('../data/play-content');
const KEY = 'herb-origin:play:v1';
const ERROR = '学习记录保存失败，请检查设备存储后重试';
const copy = value => JSON.parse(JSON.stringify(value));
const day = () => Math.floor((Date.now() + 8 * 3600000) / 86400000);
const scope = () => (community.getUser() || {}).id || 'guest';
function empty() { return { schemaVersion: 1, quiz: { runs: 0, best: 0, last: null }, match: { runs: 0, bestMoves: 0, lastRunId: '' }, observations: [], openedDays: [] }; }
function read() {
  try {
    const state = wx.getStorageSync(KEY + ':' + encodeURIComponent(scope()));
    if (!state) return { ok: true, state: empty() };
    if (state.schemaVersion !== 1 || !state.quiz || !Number.isSafeInteger(state.quiz.runs) || !Number.isSafeInteger(state.quiz.best) ||
      state.quiz.runs < 0 || state.quiz.best < 0 || state.quiz.best > 5 || !state.match || !Number.isSafeInteger(state.match.runs) || state.match.runs < 0 ||
      !Number.isSafeInteger(state.match.bestMoves) || state.match.bestMoves < 0 || !Array.isArray(state.observations) ||
      state.observations.some(row => !row || !Number.isInteger(row.day) || !content.missions.some(m => m.id === row.missionId) || typeof row.text !== 'string') ||
      !Array.isArray(state.openedDays) || state.openedDays.some(value => !Number.isInteger(value))) return { ok: false, error: '学习记录读取失败，请检查设备存储' };
    if (state.observations.length > 7 || new Set(state.observations.map(row => row.day)).size !== state.observations.length ||
      new Set(state.observations.map(row => row.missionId)).size !== state.observations.length ||
      state.observations.some(row => row.text.trim().length < 20 || row.text.length > 500) ||
      state.openedDays.length > 366 || new Set(state.openedDays).size !== state.openedDays.length) return { ok: false, error: '学习记录读取失败，请检查设备存储' };
    const last = state.quiz.last;
    if (last && (typeof last.runId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(last.runId) || !gradeQuiz(last.ids, last.answers).ok)) return { ok: false, error: '学习记录读取失败，请检查设备存储' };
    return { ok: true, state: { schemaVersion: 1,
      quiz: { runs: state.quiz.runs, best: state.quiz.best, last: last ? { runId: last.runId, ids: last.ids.slice(), answers: last.answers.slice(), score: gradeQuiz(last.ids, last.answers).score, date: typeof last.date === 'string' ? last.date : '' } : null },
      match: { runs: state.match.runs, bestMoves: state.match.bestMoves, lastRunId: typeof state.match.lastRunId === 'string' ? state.match.lastRunId : '' },
      observations: state.observations.map(row => ({ day: row.day, missionId: row.missionId, text: row.text, date: typeof row.date === 'string' ? row.date : '' })),
      openedDays: state.openedDays.slice() } };
  } catch (error) { return { ok: false, error: '学习记录读取失败，请检查设备存储' }; }
}
function write(state) {
  try { wx.setStorageSync(KEY + ':' + encodeURIComponent(scope()), copy(state)); return { ok: true }; }
  catch (error) { return { ok: false, error: ERROR }; }
}
function shuffle(list, random = Math.random) {
  const values = list.slice();
  for (let index = values.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [values[index], values[target]] = [values[target], values[index]]; }
  return values;
}
function createQuiz(topic = 'all', random = Math.random) {
  const valid = content.topics.some(item => item.id === topic) ? topic : 'all';
  return shuffle(content.questions.filter(question => valid === 'all' || question.topic === valid), random).slice(0, 5).map(copy);
}
function gradeQuiz(ids, answers) {
  if (!Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== 5 || !Array.isArray(answers) || answers.length !== 5) return { ok: false, error: '请完成全部五题' };
  const questions = ids.map(id => content.questions.find(question => question.id === id));
  if (questions.some((question, index) => !question || !Number.isInteger(answers[index]) || answers[index] < 0 || answers[index] >= question.options.length)) return { ok: false, error: '答题记录不完整' };
  const score = questions.reduce((sum, question, index) => sum + (question.answer === answers[index] ? 1 : 0), 0);
  return { ok: true, score, percent: score * 20, review: questions.map((question, index) => ({ ...copy(question), selected: answers[index], correct: question.answer === answers[index] })) };
}
function saveQuiz(runId, ids, answers) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(runId)) return { ok: false, error: '答题标识无效' };
  const graded = gradeQuiz(ids, answers);
  if (!graded.ok) return graded;
  const result = read(); if (!result.ok) return result;
  const state = result.state;
  if (state.quiz.last && state.quiz.last.runId === runId) return gradeQuiz(state.quiz.last.ids, state.quiz.last.answers);
  state.quiz.runs += 1; state.quiz.best = Math.max(state.quiz.best, graded.score);
  state.quiz.last = { runId, ids: ids.slice(), answers: answers.slice(), score: graded.score, date: new Date().toISOString() };
  const saved = write(state); return saved.ok ? graded : saved;
}
function createDeck(random = Math.random) {
  return shuffle(shuffle(content.pairs, random).slice(0, 6).flatMap(pair => [
    { id: pair.id + '-term', pairId: pair.id, text: pair.term, type: '术语', open: false, matched: false },
    { id: pair.id + '-meaning', pairId: pair.id, text: pair.meaning, type: '说明', open: false, matched: false },
  ]), random);
}
function saveMatch(runId, moves, pairIds) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(runId) || !Number.isInteger(moves) || moves < 6 || moves > 1000 ||
    !Array.isArray(pairIds) || pairIds.length !== 6 || new Set(pairIds).size !== 6 || pairIds.some(id => !content.pairs.some(pair => pair.id === id))) return { ok: false, error: '配对记录不完整' };
  const result = read(); if (!result.ok) return result;
  const state = result.state;
  if (state.match.lastRunId === runId) return { ok: true };
  state.match.runs += 1; state.match.bestMoves = state.match.bestMoves ? Math.min(state.match.bestMoves, moves) : moves; state.match.lastRunId = runId;
  return write(state);
}
function saveObservation(missionId, value) {
  const mission = content.missions.find(item => item.id === missionId);
  const text = typeof value === 'string' ? value.trim() : '';
  if (!mission || text.length < 20 || text.length > 500) return { ok: false, error: '请写下 20–500 字的实际观察记录' };
  const result = read(); if (!result.ok) return result;
  const state = result.state, today = day();
  const existing = state.observations.find(row => row.day === today);
  if (existing && existing.missionId !== missionId) return { ok: false, error: '今天已有一条观察，明天再完成新的任务' };
  if (!existing && state.observations.some(row => row.missionId === missionId)) return { ok: false, error: '这个任务已完成，请选择另一个任务' };
  const row = { day: today, missionId, text, date: new Date().toISOString() };
  if (existing) state.observations[state.observations.indexOf(existing)] = row; else state.observations.push(row);
  const saved = write(state); return saved.ok ? { ok: true, observation: row } : saved;
}
function todayCard() { return copy(content.inspirations[((day() % content.inspirations.length) + content.inspirations.length) % content.inspirations.length]); }
function openDaily() {
  const result = read(); if (!result.ok) return result;
  const state = result.state, today = day();
  if (!state.openedDays.includes(today)) { state.openedDays = state.openedDays.concat(today).slice(-366); const saved = write(state); if (!saved.ok) return saved; }
  return { ok: true, card: todayCard() };
}
function getSummary() {
  const result = read();
  const state = result.ok ? result.state : empty();
  const badges = [
    { title: '初识草木', earned: state.quiz.runs > 0, hint: '完成一次五题挑战' },
    { title: '学习进步', earned: state.quiz.best >= 4, hint: '一轮答对至少四题' },
    { title: '词汇搭档', earned: state.match.runs > 0, hint: '完成一次术语配对' },
    { title: '耐心观察', earned: state.observations.length >= 3, hint: '三个日期完成观察' },
    { title: '七日记录者', earned: state.observations.length >= 7, hint: '七个日期完成七个任务' },
    { title: '灵感收集者', earned: state.openedDays.length >= 7, hint: '七个日期打开灵感卡' },
  ];
  return { error: result.ok ? '' : result.error, quizRuns: state.quiz.runs, quizBest: state.quiz.best, matchRuns: state.match.runs,
    matchBest: state.match.bestMoves, observationCount: state.observations.length, todayObservation: state.observations.find(row => row.day === day()) || null,
    observations: state.observations, dailyOpened: state.openedDays.includes(day()), dailyCount: state.openedDays.length,
    badges, badgeCount: badges.filter(badge => badge.earned).length };
}
function getBackup() { const result = read(); return result.ok ? result.state : null; }
module.exports = { content, scope, day, createQuiz, gradeQuiz, saveQuiz, createDeck, saveMatch, saveObservation, todayCard, openDaily, getSummary, getBackup };
