// ─── IELTS Platform · Shared Data Layer ───────────────────────────────────
// All data lives in localStorage under "ielts_*" keys.

const DB = {
  // ── helpers ──────────────────────────────────────────────────────────────
  _get(k) { try { return JSON.parse(localStorage.getItem('ielts_' + k) || 'null'); } catch { return null; } },
  _set(k, v) { localStorage.setItem('ielts_' + k, JSON.stringify(v)); },

  // ── seed (first run) ──────────────────────────────────────────────────────
  seed() {
    if (this._get('seeded')) return;
    this._set('users', [
      { id: 1, username: 'root', password: '1234', role: 'admin', full_name: 'System Administrator', email: '', additives: '', created_at: new Date().toISOString() },
      { id: 2, username: 'student1', password: 'pass', role: 'student', full_name: 'Alice Demo', email: 'alice@demo.com', additives: '', created_at: new Date().toISOString() },
    ]);
    this._set('tests', [
      {
        id: 1, title: 'Practice Test 1',
        task1_image_data: '',
        task1_prompt: 'The chart below shows the green energy consumption in three countries from 2015 to 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
        task2_prompt: 'Some people believe that university education should be free for everyone. To what extent do you agree or disagree? Give reasons for your answer and include any relevant examples from your own knowledge or experience.',
        is_visible: 1
      }
    ]);
    this._set('submissions', []);
    this._set('next_uid', 3);
    this._set('next_tid', 2);
    this._set('next_sid', 1);
    this._set('seeded', true);
  },

  // ── auth ──────────────────────────────────────────────────────────────────
  login(username, password) {
    const users = this._get('users') || [];
    return users.find(u => u.username === username && u.password === password) || null;
  },
  currentUser() { return this._get('session_user') || null; },
  setSession(user) { this._set('session_user', user); },
  clearSession() { localStorage.removeItem('ielts_session_user'); },

  // ── users ─────────────────────────────────────────────────────────────────
  getUsers(role) {
    const all = this._get('users') || [];
    return role ? all.filter(u => u.role === role) : all;
  },
  getUserById(id) { return (this._get('users') || []).find(u => u.id === id) || null; },
  addUser(data) {
    const users = this._get('users') || [];
    if (users.find(u => u.username === data.username)) return false;
    const id = this._get('next_uid') || 10;
    users.push({ id, ...data, role: 'student', created_at: new Date().toISOString() });
    this._set('users', users);
    this._set('next_uid', id + 1);
    return true;
  },
  editUser(id, data) {
    const users = this._get('users') || [];
    const i = users.findIndex(u => u.id === id);
    if (i < 0) return;
    users[i] = { ...users[i], ...data };
    this._set('users', users);
    const sess = this.currentUser();
    if (sess && sess.id === id) this._set('session_user', users[i]);
  },
  deleteUser(id) {
    this._set('users', (this._get('users') || []).filter(u => u.id !== id));
    this._set('submissions', (this._get('submissions') || []).filter(s => s.user_id !== id));
  },

  // ── tests ─────────────────────────────────────────────────────────────────
  getTests(visibleOnly) {
    const all = this._get('tests') || [];
    return visibleOnly ? all.filter(t => t.is_visible) : all;
  },
  getTestById(id) { return (this._get('tests') || []).find(t => t.id === id) || null; },
  addTest(data) {
    const tests = this._get('tests') || [];
    const id = this._get('next_tid') || 10;
    tests.push({ id, ...data });
    this._set('tests', tests);
    this._set('next_tid', id + 1);
  },
  editTest(id, data) {
    const tests = this._get('tests') || [];
    const i = tests.findIndex(t => t.id === id);
    if (i < 0) return;
    // Preserve existing image if no new one provided
    if (!data.task1_image_data && tests[i].task1_image_data) {
      data.task1_image_data = tests[i].task1_image_data;
    }
    tests[i] = { ...tests[i], ...data };
    this._set('tests', tests);
  },
  toggleTest(id) {
    const tests = this._get('tests') || [];
    const t = tests.find(t => t.id === id);
    if (t) { t.is_visible = t.is_visible ? 0 : 1; this._set('tests', tests); }
  },
  deleteTest(id) {
    this._set('tests', (this._get('tests') || []).filter(t => t.id !== id));
    this._set('submissions', (this._get('submissions') || []).filter(s => s.test_id !== id));
  },

  // ── submissions ───────────────────────────────────────────────────────────
  getSubmissions(filters) {
    let all = this._get('submissions') || [];
    if (filters?.user_id) all = all.filter(s => s.user_id === filters.user_id);
    if (filters?.test_id) all = all.filter(s => s.test_id === filters.test_id);
    return all.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
  },
  hasSubmitted(user_id, test_id) {
    return (this._get('submissions') || []).some(s => s.user_id === user_id && s.test_id === test_id);
  },
  addSubmission(data) {
    const subs = this._get('submissions') || [];
    const id = this._get('next_sid') || 1;
    subs.push({ id, ...data, task1_scores: null, task2_scores: null, writing_band: null, submitted_at: new Date().toLocaleString() });
    this._set('submissions', subs);
    this._set('next_sid', id + 1);
  },
  deleteSubmission(id) {
    this._set('submissions', (this._get('submissions') || []).filter(s => s.id !== id));
  },

  // ── scoring ───────────────────────────────────────────────────────────────
  // IELTS band rounding: round to nearest 0.5
  _roundBand(x) { return Math.round(x * 2) / 2; },

  saveScores(submissionId, task1Raw, task2Raw) {
    const subs = this._get('submissions') || [];
    const i = subs.findIndex(s => s.id === submissionId);
    if (i < 0) return false;

    const t1Overall = this._roundBand((+task1Raw.TA + +task1Raw.CC + +task1Raw.LR + +task1Raw.GRA) / 4);
    const t2Overall = this._roundBand((+task2Raw.TR + +task2Raw.CC + +task2Raw.LR + +task2Raw.GRA) / 4);
    const writingBand = this._roundBand((t1Overall + 2 * t2Overall) / 3);

    subs[i] = {
      ...subs[i],
      task1_scores: { TA: +task1Raw.TA, CC: +task1Raw.CC, LR: +task1Raw.LR, GRA: +task1Raw.GRA, overall: t1Overall },
      task2_scores: { TR: +task2Raw.TR, CC: +task2Raw.CC, LR: +task2Raw.LR, GRA: +task2Raw.GRA, overall: t2Overall },
      writing_band: writingBand,
    };
    this._set('submissions', subs);
    return { t1Overall, t2Overall, writingBand };
  },

  // ── leaderboard ───────────────────────────────────────────────────────────
  getLeaderboard(testId) {
    const subs = (this._get('submissions') || []).filter(s => s.test_id === testId && s.writing_band != null);
    return subs
      .sort((a, b) => b.writing_band - a.writing_band)
      .map(s => ({ ...s, user: this.getUserById(s.user_id) }));
  },

  // ── stats ─────────────────────────────────────────────────────────────────
  statsForUser(uid) {
    const subs = this.getSubmissions({ user_id: uid });
    if (!subs.length) return null;
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const scored = subs.filter(s => s.writing_band != null);
    return {
      total: subs.length,
      avg_time: Math.round(avg(subs.map(s => s.time_spent_minutes || 0))),
      avg_words: Math.round(avg(subs.map(s => (s.task1_word_count || 0) + (s.task2_word_count || 0)))),
      avg_band: scored.length ? (avg(scored.map(s => s.writing_band))).toFixed(1) : null,
    };
  },
  statsGlobal() {
    const subs = this._get('submissions') || [];
    if (!subs.length) return { active_students: 0, total_submissions: 0, avg_time: 0, avg_words: 0 };
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const students = new Set(subs.map(s => s.user_id));
    return {
      active_students: students.size,
      total_submissions: subs.length,
      avg_time: Math.round(avg(subs.map(s => s.time_spent_minutes || 0))),
      avg_words: Math.round(avg(subs.map(s => (s.task1_word_count || 0) + (s.task2_word_count || 0)))),
    };
  },
};

// seed on load
DB.seed();

// ── Guard helpers ─────────────────────────────────────────────────────────────
function requireAuth(requiredRole) {
  const u = DB.currentUser();
  if (!u) { window.location.href = 'login.html'; return null; }
  if (requiredRole && u.role !== requiredRole) {
    window.location.href = u.role === 'admin' ? 'admin_dashboard.html' : 'student_dashboard.html';
    return null;
  }
  return u;
}
