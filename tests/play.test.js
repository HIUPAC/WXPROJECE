const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const content = require('../miniprogram/data/play-content');
const catalog = require('../miniprogram/data/catalog');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function fixture() {
  const values = new Map(), calls = [], timers = new Map();
  const mock = { now: Date.parse('2026-10-09T02:00:00Z'), user: null, failRead: false, failWrite: false };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [mock.now])); }
    static now() { return mock.now; }
  }
  const wx = { getStorageSync(key) { if (mock.failRead) throw Error('read failed'); return clone(values.get(key)); },
    setStorageSync(key, value) { if (mock.failWrite) throw Error('write failed'); values.set(key, clone(value)); },
    showToast: options => calls.push(['toast', options.title]), pageScrollTo() {}, navigateBack() {}, switchTab() {} };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/services/play.js'), 'utf8'), {
    module, wx, Date: Clock, require: target => target === './community' ? { getUser: () => mock.user } : content,
  });
  const play = module.exports;
  function page(options = {}) {
    let definition, timerSequence = 0;
    const navigation = { push: url => calls.push(['push', url]), openDetail: (kind, id) => calls.push(['detail', kind, id]),
      editNote: (...args) => calls.push(['note', ...clone(args)]) };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/play/index.js'), 'utf8'), {
      Page: value => { definition = value; }, wx, Date: Clock,
      setTimeout(fn) { const id = ++timerSequence; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
      require: target => target.endsWith('/services/play') ? play : target.endsWith('/services/navigation') ? navigation : catalog,
    });
    const p = { ...definition, data: clone(definition.data), setData(delta) { Object.assign(this.data, clone(delta)); } };
    p.onLoad(options); p.onShow(); return p;
  }
  return { play, page, mock, values, calls, timers };
}
const tap = dataset => ({ currentTarget: { dataset } });
const observation = '今天在公共步道观察同一片叶，边缘有小缺口，背面未能看见，先保留为待确认的问题。';

test('all learning games have complete original content and valid reference links', () => {
  assert.equal(content.questions.length, 30);
  assert.equal(new Set(content.questions.map(q => q.id)).size, 30);
  for (const topic of content.topics.filter(topic => topic.id !== 'all')) {
    assert.equal(content.questions.filter(q => q.topic === topic.id).length, 5);
  }
  for (const question of content.questions) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4);
    assert.ok(question.explanation.length >= 10);
  }
  for (const item of [...content.questions, ...content.missions, ...content.inspirations]) {
    const parts = item.relatedKey.split(':'); assert.ok(catalog.findItem(parts[0], parts[1]), item.id);
  }
  assert.equal(content.pairs.length, 12); assert.equal(content.missions.length, 7); assert.equal(content.inspirations.length, 14);
});

test('quizzes save derived scores, reject incomplete answers and retry a round without adding a second result', () => {
  const { play } = fixture();
  const questions = play.createQuiz('photo', () => 0.5), ids = questions.map(q => q.id), answers = questions.map(q => q.answer);
  assert.equal(questions.length, 5); assert.ok(questions.every(q => q.topic === 'photo'));
  assert.equal(play.saveQuiz('round-00001', ids, answers.slice(1)).ok, false);
  assert.equal(play.saveQuiz('round-00001', [ids[0], ...ids.slice(0, 4)], answers).ok, false);
  assert.equal(play.saveQuiz('round-00001', ids, answers).score, 5);
  assert.equal(play.saveQuiz('round-00001', ids, answers.map(answer => (answer + 1) % 4)).score, 5);
  assert.equal(play.getSummary().quizRuns, 1); assert.equal(play.getSummary().quizBest, 5);
  play.saveQuiz('round-00002', ids, answers.map(answer => (answer + 1) % 4));
  assert.equal(play.getSummary().quizRuns, 2); assert.equal(play.getSummary().quizBest, 5);
});

test('failed game writes and unreadable saved data never award progress or overwrite existing storage', () => {
  const { play, mock, values } = fixture();
  const questions = play.createQuiz(), ids = questions.map(q => q.id), answers = questions.map(q => q.answer);
  mock.failWrite = true;
  assert.equal(play.saveQuiz('round-00001', ids, answers).ok, false);
  assert.equal(play.saveObservation('m1', observation).ok, false); assert.equal(play.openDaily().ok, false);
  assert.equal(play.getSummary().badgeCount, 0); assert.equal(values.size, 0);
  mock.failWrite = false; assert.equal(play.saveQuiz('round-00001', ids, answers).ok, true);
  const saved = clone(values.get('herb-origin:play:v1:guest'));
  mock.failRead = true; assert.equal(play.saveQuiz('round-00002', ids, answers).ok, false);
  assert.deepEqual(values.get('herb-origin:play:v1:guest'), saved); assert.equal(play.getBackup(), null);
  mock.failRead = false; values.set('herb-origin:play:v1:guest', { schemaVersion: 99 });
  assert.equal(play.openDaily().ok, false); assert.deepEqual(values.get('herb-origin:play:v1:guest'), { schemaVersion: 99 });
});

test('memory decks contain six distinct complementary pairs and save one best attempt per completed round', () => {
  const { play, mock } = fixture();
  const deck = play.createDeck(() => 0.4), ids = [...new Set(deck.map(card => card.pairId))];
  assert.equal(deck.length, 12); assert.equal(ids.length, 6);
  for (const id of ids) assert.deepEqual(deck.filter(card => card.pairId === id).map(card => card.type).sort(), ['术语', '说明']);
  deck[0].text = 'edited'; assert.ok(!play.createDeck(() => 0.4).some(card => card.text === 'edited'));
  assert.equal(play.saveMatch('match-00001', 5, ids).ok, false);
  assert.equal(play.saveMatch('match-00001', 12, ids).ok, true);
  play.saveMatch('match-00001', 6, ids); assert.equal(play.getSummary().matchBest, 12);
  mock.failWrite = true; assert.equal(play.saveMatch('match-00002', 6, ids).ok, false);
  assert.equal(play.getSummary().matchBest, 12);
  mock.failWrite = false; play.saveMatch('match-00002', 6, ids);
  assert.equal(play.getSummary().matchBest, 6); assert.equal(play.getSummary().matchRuns, 2);
});

test('observations allow only one task per Beijing date, edit today and preserve historical entries across midnight', () => {
  const { play, mock } = fixture(); mock.now = Date.parse('2026-10-09T15:59:59Z');
  assert.equal(play.saveObservation('m1', '还不够二十字').ok, false);
  assert.equal(play.saveObservation('m1', observation).ok, true);
  assert.equal(play.saveObservation('m1', observation + '追加今天的复查。').ok, true);
  assert.equal(play.getSummary().observationCount, 1);
  assert.equal(play.saveObservation('m2', observation).ok, false);
  const firstDay = play.day(); mock.now += 1000;
  assert.equal(play.day(), firstDay + 1); assert.equal(play.getSummary().todayObservation, null);
  assert.equal(play.saveObservation('m1', observation).ok, false);
  assert.equal(play.saveObservation('m2', observation).ok, true);
  for (let i = 2; i < 7; i++) { mock.now += 2 * 86400000; assert.equal(play.saveObservation(content.missions[i].id, observation).ok, true); }
  assert.equal(play.getSummary().observationCount, 7);
  assert.ok(play.getSummary().badges.find(badge => badge.title === '七日记录者').earned);
});

test('daily cards stay stable after reentry, count unique dates and isolate guest, demo and real accounts', () => {
  const { play, mock } = fixture();
  const first = clone(play.openDaily().card); assert.deepEqual(clone(play.openDaily().card), first);
  assert.equal(play.getSummary().dailyCount, 1);
  for (let i = 0; i < 6; i++) { mock.now += 86400000; play.openDaily(); }
  assert.equal(play.getSummary().dailyCount, 7); assert.equal(play.getSummary().badgeCount, 1);
  mock.user = { id: 'demo-official', isDemo: true };
  assert.equal(play.getSummary().dailyCount, 0); play.openDaily();
  mock.user = { id: 'student/甲' }; assert.equal(play.getSummary().dailyCount, 0);
  play.saveObservation('m1', observation);
  mock.user = null; assert.equal(play.getSummary().dailyCount, 7); assert.equal(play.getSummary().observationCount, 0);
  mock.user = { id: 'demo-official' }; assert.equal(play.getSummary().dailyCount, 1); assert.equal(play.getSummary().observationCount, 0);
});

test('backups include only the current learning scope and known saved fields', () => {
  const { play, values } = fixture(); play.openDaily();
  const state = values.get('herb-origin:play:v1:guest');
  state.password = 'secret'; state.session = { token: 'secret' }; state.match.token = 'secret';
  const backup = play.getBackup(); assert.ok(!JSON.stringify(backup).includes('secret'));
  backup.openedDays.push(999); assert.equal(play.getSummary().dailyCount, 1);
  state.openedDays.push(state.openedDays[0]);
  assert.equal(play.openDaily().ok, false); assert.equal(state.openedDays.length, 2);
});

test('the real quiz page locks answers, links courses and retries failed saves with the same round', () => {
  const { page, play, calls, mock } = fixture(), p = page({ mode: 'quiz', topic: 'photo' });
  p.startQuiz(); p.nextQuestion(); assert.equal(p.data.quizIndex, 0);
  for (let i = 0; i < 5; i++) {
    const answer = p.data.question.answer; p.chooseAnswer(tap({ index: answer }));
    p.chooseAnswer(tap({ index: (answer + 1) % 4 })); assert.equal(p.data.selected, answer);
    p.openReference(tap({ key: p.data.question.relatedKey }));
    if (i === 4) mock.failWrite = true;
    p.nextQuestion();
  }
  assert.equal(p.data.quizResult.score, 5); assert.equal(p.data.quizSaved, false); assert.equal(play.getSummary().quizRuns, 0);
  mock.failWrite = false; p.saveQuiz(); p.saveQuiz();
  assert.equal(p.data.quizSaved, true); assert.equal(play.getSummary().quizRuns, 1);
  assert.ok(calls.some(call => call[0] === 'detail' && call[1] === 'course'));
  assert.equal(p.data.summary.observations, undefined);
});

test('the real memory page completes six pairs and cancels hidden or stale mismatch callbacks', () => {
  const { page, play, timers } = fixture(), p = page({ mode: 'match' });
  const ids = [...new Set(p.data.deck.map(card => card.pairId))];
  for (const id of ids) {
    const indexes = p.data.deck.map((card, i) => card.pairId === id ? i : -1).filter(i => i >= 0);
    p.flipCard(tap({ index: indexes[0] })); p.flipCard(tap({ index: indexes[0] }));
    p.flipCard(tap({ index: indexes[1] }));
  }
  assert.equal(p.data.matches, 6); assert.equal(p.data.moves, 6); assert.equal(p.data.matchSaved, true);
  assert.equal(play.getSummary().matchRuns, 1); p.saveMatch(); assert.equal(play.getSummary().matchRuns, 1);
  p.startMatch(); const different = p.data.deck.findIndex(card => card.pairId !== p.data.deck[0].pairId);
  p.flipCard(tap({ index: 0 })); p.flipCard(tap({ index: different })); assert.equal(p.data.locked, true);
  const callback = [...timers.values()][0]; p.onHide(); assert.equal(timers.size, 0);
  p.onShow(); p.startMatch(); p.flipCard(tap({ index: 0 })); callback();
  assert.equal(p.data.deck[0].open, true); assert.equal(p.data.moves, 0);
  p.onUnload();
});

test('observation page retains failed input, opens a private note seed and makes historical records read-only', () => {
  const { page, mock, calls, play } = fixture(), p = page({ mode: 'observe' });
  p.observationInput({ detail: { value: observation } }); mock.failWrite = true; p.saveObservation();
  assert.equal(p.data.observationSaved, false); assert.equal(p.data.observationText, observation);
  mock.failWrite = false; p.saveObservation(); assert.equal(play.getSummary().observationCount, 1);
  p.writeObservation(); const note = calls.find(call => call[0] === 'note');
  assert.equal(note[1], ''); assert.equal(note[3].ownerId, 'guest'); assert.equal(note[3].body, observation);
  mock.now += 86400000; p.onShow(); assert.equal(p.data.observationReadOnly, true);
  p.observationInput({ detail: { value: '不能更改历史记录' } }); assert.equal(p.data.observationText, observation);
  p.saveObservation(); assert.equal(play.getSummary().observationCount, 1);
});

test('switching accounts clears personal game text and prevents old callbacks from saving into the new account', () => {
  const { page, mock, play, calls } = fixture(), p = page({ mode: 'observe' });
  p.observationInput({ detail: { value: observation } }); mock.user = { id: 'u-other' };
  p.saveObservation(); p.writeObservation();
  assert.equal(play.getSummary().observationCount, 0); assert.ok(!calls.some(call => call[0] === 'note'));
  p.onShow(); assert.equal(p.data.mode, 'hub'); assert.equal(p.data.observationText, ''); assert.equal(p.data.mission, null);
  p.enter('daily'); p.openDaily(); assert.equal(p.data.dailyOpened, true);
  mock.user = null; p.onShow(); assert.equal(p.data.dailyOpened, false); assert.equal(p.data.dailyCard, null);
});
