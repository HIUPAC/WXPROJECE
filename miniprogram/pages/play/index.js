const play = require('../../services/play');
const navigation = require('../../services/navigation');
const { findItem } = require('../../data/catalog');
function runId() { return 'play-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
function publicSummary(summary) {
  const { observations, todayObservation, ...display } = summary;
  return display;
}
Page({
  data: {
    mode: 'hub', title: '草木游学场', summary: null, topics: play.content.topics, topic: 'all',
    modules: [
      { mode: 'quiz', title: '知识闯关', icon: 'book', copy: '每轮五题，答后看解析，再回到课程复习。', label: '约 3 分钟' },
      { mode: 'match', title: '术语翻牌', icon: 'leaf', copy: '把术语与说明配成六组，练习理解与记忆。', label: '约 5 分钟' },
      { mode: 'observe', title: '七日观察', icon: 'pen', copy: '七个任务，七次真实记录，积累观察方法。', label: '每天 5 分钟' },
      { mode: 'daily', title: '每日灵感卡', icon: 'compass', copy: '每天一个小问题，开始今天的观察与记录。', label: '每日一张' },
    ],
    quizStarted: false, question: null, quizIndex: 0, selected: -1, answered: false, quizResult: null, quizSaved: false, quizError: '',
    deck: [], moves: 0, matches: 0, locked: false, matchDone: false, matchSaved: false, matchError: '',
    missions: [], missionId: '', mission: null, observationText: '', observationSaved: false, observationReadOnly: false, observationError: '', todayDone: false,
    dailyCard: null, dailyOpened: false, dailyError: '',
  },
  onLoad(options = {}) {
    this.ownerId = play.scope();
    this.refresh();
    if (play.content.topics.some(topic => topic.id === options.topic)) this.setData({ topic: options.topic });
    if (['quiz', 'match', 'observe', 'daily'].includes(options.mode)) this.enter(options.mode);
  },
  onShow() {
    this.hidden = false;
    if (this.ownerId && this.ownerId !== play.scope()) {
      this.cancelFlip();
      this.ownerId = play.scope();
      this.setData({ mode: 'hub', title: '草木游学场', quizStarted: false, quizResult: null, observationText: '', observationSaved: false,
        deck: [], matchDone: false, dailyOpened: false, dailyCard: null, topic: 'all', missionId: '', mission: null });
    }
    this.ownerId = play.scope();
    this.refresh();
  },
  refresh() {
    const summary = play.getSummary();
    const missions = play.content.missions.map(mission => {
      const saved = summary.observations.find(row => row.missionId === mission.id);
      return { ...mission, completed: Boolean(saved), date: saved ? new Date(saved.day * 86400000).toISOString().slice(0, 10) : '' };
    });
    this.setData({ summary: publicSummary(summary), missions, todayDone: Boolean(summary.todayObservation), dailyOpened: summary.dailyOpened,
      dailyCard: summary.dailyOpened ? play.todayCard() : null,
      observationReadOnly: summary.observations.some(row => row.missionId === this.data.missionId && row.day !== play.day()) });
  },
  checkOwner() {
    if (this.ownerId === play.scope()) return true;
    wx.showToast({ title: '账号已切换，请重新打开游学场', icon: 'none' }); return false;
  },
  chooseModule(event) { this.enter(event.currentTarget.dataset.mode); },
  enter(mode) {
    if (!this.checkOwner() || !['quiz', 'match', 'observe', 'daily'].includes(mode)) return;
    this.cancelFlip();
    const module = this.data.modules.find(item => item.mode === mode);
    this.setData({ mode, title: module.title });
    if (mode === 'match') this.startMatch();
    if (mode === 'observe') {
      const summary = play.getSummary();
      const target = summary.todayObservation || summary.observations[0];
      const mission = summary.todayObservation ? play.content.missions.find(item => item.id === target.missionId) :
        play.content.missions.find(item => !summary.observations.some(row => row.missionId === item.id)) || play.content.missions[0];
      this.selectMission(mission.id);
    }
    this.refresh();
    this.scrollToStart();
  },
  onBack() {
    if (this.data.mode !== 'hub') { this.cancelFlip(); this.setData({ mode: 'hub', title: '草木游学场' }); this.refresh(); this.scrollToStart(); return; }
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
  scrollToStart() { if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 180 }); },
  chooseTopic(event) {
    const topic = event.currentTarget.dataset.topic;
    if (!play.content.topics.some(item => item.id === topic)) return;
    this.setData({ topic, quizStarted: false, quizResult: null, quizError: '' });
  },
  startQuiz() {
    if (!this.checkOwner()) return;
    this.quizQuestions = play.createQuiz(this.data.topic);
    this.quizAnswers = []; this.quizRunId = runId();
    this.setData({ quizStarted: true, quizResult: null, question: this.quizQuestions[0], quizIndex: 0, selected: -1, answered: false, quizSaved: false, quizError: '' });
    this.scrollToStart();
  },
  chooseAnswer(event) {
    if (!this.checkOwner() || this.data.answered || this.data.quizResult) return;
    const selected = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(selected) || selected < 0 || selected >= this.data.question.options.length) return;
    this.quizAnswers[this.data.quizIndex] = selected;
    this.setData({ selected, answered: true });
  },
  nextQuestion() {
    if (!this.checkOwner() || !this.data.answered || this.data.quizResult) return;
    if (this.data.quizIndex < 4) {
      const quizIndex = this.data.quizIndex + 1;
      this.setData({ quizIndex, question: this.quizQuestions[quizIndex], selected: -1, answered: false }); this.scrollToStart(); return;
    }
    const result = play.gradeQuiz(this.quizQuestions.map(question => question.id), this.quizAnswers);
    if (!result.ok) { this.setData({ quizError: result.error }); return; }
    this.setData({ quizResult: result, quizSaved: false }); this.saveQuiz();
  },
  saveQuiz() {
    if (!this.checkOwner() || !this.data.quizResult || this.data.quizSaved) return;
    const result = play.saveQuiz(this.quizRunId, this.quizQuestions.map(question => question.id), this.quizAnswers);
    this.setData({ quizSaved: result.ok, quizError: result.ok ? '' : result.error });
    if (result.ok) this.refresh();
  },
  startMatch() {
    if (!this.checkOwner()) return;
    this.cancelFlip(); this.matchRunId = runId(); this.firstCard = null;
    this.setData({ deck: play.createDeck(), moves: 0, matches: 0, locked: false, matchDone: false, matchSaved: false, matchError: '' });
    this.scrollToStart();
  },
  flipCard(event) {
    if (!this.checkOwner() || this.data.locked || this.data.matchDone || this.hidden) return;
    const index = Number(event.currentTarget.dataset.index), card = this.data.deck[index];
    if (!card || card.open || card.matched) return;
    const deck = this.data.deck.map(item => ({ ...item })); deck[index].open = true;
    if (this.firstCard === null) { this.firstCard = index; this.setData({ deck }); return; }
    const first = this.firstCard; this.firstCard = null;
    const moves = this.data.moves + 1;
    if (deck[first].pairId === card.pairId && deck[first].type !== card.type) {
      deck[first].matched = true; deck[index].matched = true;
      const matches = this.data.matches + 1;
      this.setData({ deck, moves, matches, matchDone: matches === 6 });
      if (matches === 6) this.saveMatch();
    } else {
      this.setData({ deck, moves, locked: true });
      const generation = this.flipGeneration = (this.flipGeneration || 0) + 1;
      this.flipTimer = setTimeout(() => {
        if (this.hidden || generation !== this.flipGeneration || !this.checkOwner()) return;
        const next = this.data.deck.map(item => ({ ...item, open: item.matched }));
        this.setData({ deck: next, locked: false }); this.flipTimer = null;
      }, 850);
    }
  },
  cancelFlip() {
    clearTimeout(this.flipTimer); this.flipTimer = null;
    this.flipGeneration = (this.flipGeneration || 0) + 1; this.firstCard = null;
    if (this.data.deck.length) this.setData({ deck: this.data.deck.map(item => ({ ...item, open: item.matched })), locked: false });
  },
  saveMatch() {
    if (!this.checkOwner() || !this.data.matchDone || this.data.matchSaved) return;
    const ids = [...new Set(this.data.deck.filter(card => card.matched).map(card => card.pairId))];
    const result = play.saveMatch(this.matchRunId, this.data.moves, ids);
    this.setData({ matchSaved: result.ok, matchError: result.ok ? '' : result.error });
    if (result.ok) this.refresh();
  },
  chooseMission(event) { this.selectMission(event.currentTarget.dataset.id); },
  selectMission(id) {
    if (!this.checkOwner()) return;
    const mission = play.content.missions.find(item => item.id === id); if (!mission) return;
    const saved = play.getSummary().observations.find(row => row.missionId === id);
    this.setData({ mission, missionId: id, observationText: saved ? saved.text : '', observationSaved: Boolean(saved),
      observationReadOnly: Boolean(saved && saved.day !== play.day()), observationError: '' });
  },
  observationInput(event) { if (!this.data.observationReadOnly) this.setData({ observationText: String(event.detail.value || '').slice(0, 500), observationSaved: false, observationError: '' }); },
  saveObservation() {
    if (!this.checkOwner() || !this.data.mission || this.data.observationReadOnly) return;
    const result = play.saveObservation(this.data.missionId, this.data.observationText);
    this.setData({ observationSaved: result.ok, observationError: result.ok ? '' : result.error });
    if (result.ok) { wx.showToast({ title: '观察已保存', icon: 'success' }); this.refresh(); }
  },
  openDaily() {
    if (!this.checkOwner()) return;
    const result = play.openDaily();
    this.setData({ dailyError: result.ok ? '' : result.error });
    if (result.ok) { this.setData({ dailyCard: result.card, dailyOpened: true }); this.refresh(); }
  },
  openReference(event) {
    const key = event.currentTarget.dataset.key;
    const parts = typeof key === 'string' ? key.split(':') : [];
    if (parts.length === 2 && findItem(parts[0], parts[1])) navigation.openDetail(parts[0], parts[1]);
  },
  writeObservation() {
    if (!this.checkOwner() || !this.data.mission) return;
    const mission = this.data.mission;
    navigation.editNote('', mission.relatedKey, { ownerId: this.ownerId, title: '观察任务 · ' + mission.title,
      body: this.data.observationText.trim() || mission.prompt });
  },
  writeInspiration() {
    if (!this.checkOwner() || !this.data.dailyCard) return;
    const card = this.data.dailyCard;
    navigation.editNote('', card.relatedKey, { ownerId: this.ownerId, title: '今日灵感 · ' + card.title,
      body: '今天的观察任务：' + card.task + '\n\n日期与对象：\n实际发现：\n待确认问题：\n下一次计划：' });
  },
  onHide() { this.hidden = true; this.cancelFlip(); },
  onUnload() { this.onHide(); },
  onShareAppMessage() { return { title: '百草源 · 免费体验草木游学场', path: '/pages/play/index' }; },
});
