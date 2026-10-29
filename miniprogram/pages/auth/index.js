const community = require('../../services/community');
const navigation = require('../../services/navigation');
const config = require('../../config');

Page({
  data: {
    mode: 'login', account: '', studentId: '', phone: '', username: '',
    password: '', confirmPassword: '', showPassword: false, submitting: false, demoEntering: false, error: '', agreed: false, localEdition: config.serviceMode === 'local',
  },

  onLoad(options = {}) {
    this.setData({ mode: options.mode === 'register' ? 'register' : 'login' });
  },

  changeMode(event) {
    if (this.data.submitting) return;
    const mode = event.currentTarget.dataset.mode;
    if (!['login', 'register'].includes(mode)) return;
    this.setData({ mode, error: '', password: '', confirmPassword: '', showPassword: false });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!['account', 'studentId', 'phone', 'username', 'password', 'confirmPassword'].includes(field)) return;
    this.setData({ [field]: event.detail.value, error: '' });
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  changeAgreement(event) {
    if (this.data.submitting) return;
    const values = event.detail && event.detail.value;
    this.setData({ agreed: Array.isArray(values) && values.includes('agree'), error: '' });
  },

  openLegal(event) {
    if (this.data.submitting) return;
    const type = event && event.currentTarget && event.currentTarget.dataset.type;
    navigation.push('/pages/legal/index?type=' + (type === 'privacy' ? 'privacy' : 'terms'));
  },

  continueLocally() {
    if (this.data.submitting) return;
    navigation.openNotes('local');
  },

  validationError() {
    const form = this.data;
    if (form.mode === 'login') {
      if (!form.account.trim()) return '请输入学号或手机号';
      if (!form.password) return '请输入密码';
      return '';
    }
    if (!/^[A-Za-z0-9]{4,32}$/.test(form.studentId.trim())) return '学号须为 4–32 位数字或字母';
    if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) return '请输入正确的 11 位手机号';
    const username = form.username.trim();
    if (!username || username.length > 20) return '用户名须为 1–20 字';
    if (form.password.length < 8 || form.password.length > 64) return '密码须为 8–64 位';
    if (form.password !== form.confirmPassword) return '两次输入的密码不一致';
    if (!form.agreed) return '请阅读用户协议和隐私说明，并自主勾选同意后注册';
    return '';
  },

  async submit() {
    if (this.data.submitting) return;
    if (this.data.localEdition) { this.setData({ error: '当前为本机学习版，云端注册和登录未开放。可继续游客手记或本机体验。' }); return; }
    const error = this.validationError();
    if (error) {
      this.setData({ error });
      return;
    }
    this.setData({ submitting: true, error: '' });
    const registering = this.data.mode === 'register';
    try {
      const result = registering
        ? await community.register({ studentId: this.data.studentId.trim(), phone: this.data.phone.trim(), username: this.data.username.trim(), password: this.data.password })
        : await community.login({ account: this.data.account.trim(), password: this.data.password });
      if (this.disposed) return;
      if (!result.ok) {
        this.setData({ error: result.error || '暂时无法登录，请重试' });
        return;
      }
      this.setData({ password: '', confirmPassword: '' });
      wx.showToast({ title: registering ? '注册成功，已登录' : '登录成功', icon: 'success' });
      this.leave();
    } catch (error) {
      if (!this.disposed) this.setData({ error: '网络暂时不可用，请稍后重试' });
    } finally {
      if (!this.disposed) this.setData({ submitting: false });
    }
  },

  async enterDemo() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, demoEntering: true, error: '' });
    try {
      const result = await community.enterDemo();
      if (this.disposed) return;
      if (!result.ok) { this.setData({ error: result.error || '暂时无法进入本机体验，请重试' }); return; }
      this.setData({ password: '', confirmPassword: '' });
      wx.showToast({ title: '已进入官方演示', icon: 'success' });
      this.leave();
    } catch (error) {
      if (!this.disposed) this.setData({ error: '演示数据读取失败，请稍后重试' });
    } finally {
      if (!this.disposed) this.setData({ submitting: false, demoEntering: false });
    }
  },

  onBack() {
    if (this.data.submitting) return;
    this.leave();
  },

  leave() {
    if (typeof getCurrentPages === 'function' && getCurrentPages().length < 2) {
      wx.switchTab({ url: '/pages/profile/index' });
      return;
    }
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/profile/index' }) });
  },

  onUnload() {
    this.disposed = true;
    this.data.password = '';
    this.data.confirmPassword = '';
  },
});
