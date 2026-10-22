/**
 * Student-portal · 独立运行服务（零依赖，node server/server.js 即可）
 * ===================================================================
 * 一个进程干三件事：
 *   1. 静态托管「学习路径画布」  →  /
 *   2. 静态托管「复习与检测」    →  /review/（构建产物，base=/review/）
 *   3. 内置迷你后端             →  /api/*（JSON 文件存储，不依赖 MySQL / 原项目）
 *
 * 数据落在 server/data/db.json，首次启动自动用 seed-questions.json 初始化。
 * ===================================================================
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CANVAS_DIR = path.join(ROOT, 'dist');
const REVIEW_DIR = path.join(ROOT, 'review');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(__dirname, 'seed-questions.json');
const PORT = Number(process.env.PORT || 5173);

// ==================== 常量（与原项目 reviewService 保持一致） ====================

const FORGETTING_CURVE = [1, 2, 4, 7, 15, 30];
const MASTERED_REVIEW_DAYS = 30;
const TYPE_NAMES = { 1: '判断题', 2: '单选题', 3: '多选题', 4: '填空题', 5: '简答题' };
const DIFFICULTY_NAMES = { 1: '容易', 2: '较易', 3: '中等', 4: '较难', 5: '困难' };
const GUIDE_LEVELS = [
  { level: 1, title: '第 1 层 · 定位考点', hint: '先确认这道题在考什么，别急着看选项。' },
  { level: 2, title: '第 2 层 · 思路提示', hint: '给一点方向，先自己推一遍。' },
  { level: 3, title: '第 3 层 · 答案与解析', hint: '揭晓答案，并讲清楚为什么。' },
];
const MAX_GUIDE_LEVEL = GUIDE_LEVELS.length;

// ==================== 小工具 ====================

const pad = (n) => String(n).padStart(2, '0');
const toDateTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const toDateString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (days) => { const d = new Date(); d.setDate(d.getDate() + Number(days || 0)); return toDateTime(d); };
const daysUntil = (str) => {
  const t = new Date(String(str).replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
};
const stageLabel = (stage, mastered) => {
  if (mastered) return '已掌握';
  const idx = Math.min(Math.max(Number(stage) || 0, 0), FORGETTING_CURVE.length - 1);
  return `第 ${idx + 1} / ${FORGETTING_CURVE.length} 阶`;
};
const stripOptionKey = (t) => String(t || '').replace(/^\s*[A-Fa-f]\s*[.、)）:：\-]\s*/, '').trim();

const parseOptions = (raw) => {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw) && raw.length) {
    return raw.map((o, i) => {
      if (o && typeof o === 'object') {
        const k = String(o.key ?? o.opt ?? o.option ?? o.label ?? '').trim() || String.fromCharCode(65 + i);
        const t = String(o.text ?? o.value ?? o.content ?? o.answer ?? '').trim();
        return { key: k.toUpperCase().slice(0, 1) || String.fromCharCode(65 + i), text: stripOptionKey(t) };
      }
      return { key: String.fromCharCode(65 + i), text: stripOptionKey(String(o).trim()) };
    }).filter((o) => o.text);
  }
  const str = String(raw).trim();
  if (!str) return [];
  const lines = str.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.map((line, i) => {
      const m = line.match(/^([A-Fa-f])\s*[.、)）:：\-]?\s*(.*)$/);
      return m ? { key: m[1].toUpperCase(), text: stripOptionKey(m[2].trim()) }
               : { key: String.fromCharCode(65 + i), text: stripOptionKey(line) };
    }).filter((o) => o.text);
  }
  const regex = /([A-Fa-f])\s*[.、)）:：\-]?\s*([^A-F].*?)(?=\s*[A-Fa-f]\s*[.、)）:：\-]|$)/g;
  const matches = [];
  let m;
  while ((m = regex.exec(str)) !== null) matches.push({ key: m[1].toUpperCase(), text: stripOptionKey(m[2].trim()) });
  return matches.length ? matches : [{ key: 'A', text: stripOptionKey(str) }];
};

/** 判分（移植自 practiceService.checkAnswer） */
const checkAnswer = (type, userAnswer, correctAnswer) => {
  if (type === 1) {
    const bool = (v) => {
      const text = String(v || '').trim().toLowerCase();
      const t = ['t', 'true', '正确', '对', '是', '√', '1', '✓', '✔', '对的', '是的', '正确的'];
      const f = ['f', 'false', '错误', '错', '否', '×', '0', '✗', '✘', 'x', '不对', '不是', '错的', '错误的'];
      const stripped = text.replace(/\s+|。|\./g, '');
      if (t.includes(text) || t.includes(stripped)) return 'T';
      if (f.includes(text) || f.includes(stripped)) return 'F';
      return text.toUpperCase();
    };
    return bool(userAnswer) === bool(correctAnswer);
  }
  if (type === 3) {
    const norm = (s) => String(s || '').replace(/[;；,，、]/g, '').replace(/\s+/g, '').toUpperCase().replace(/[^A-Z]/g, '').split('').sort().join('');
    return norm(userAnswer) === norm(correctAnswer);
  }
  if (type === 4) {
    const normOne = (s) => String(s || '').replace(/\s+/g, '')
      .replace(/[，。、；;：:！!？?·“”‘’（）()【】\[\]《》<>、\-—_/\\|,]/g, '')
      .toLowerCase().replace(/％/g, '%').replace(/．/g, '.');
    const splitMany = (s) => String(s || '').split(/\s*[;；|｜/／]\s*/).map((x) => x.trim()).filter(Boolean);
    const u = splitMany(userAnswer); const c = splitMany(correctAnswer);
    if (u.length > 1 && c.length > 1 && u.length === c.length) return u.every((x, i) => normOne(x) === normOne(c[i]));
    return normOne(userAnswer) === normOne(correctAnswer);
  }
  return String(userAnswer || '').trim().toUpperCase() === String(correctAnswer || '').trim().toUpperCase();
};

// ==================== 数据层 ====================

let db = null;

function seedDB() {
  const questions = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')).map((q) => ({
    id: String(q.id), 章节: q.章节, 题型: q.题型, 题目: q.题目, 选项: q.选项,
    答案: q.答案, 解析: q.解析, 难度: q.难度, 知识点: q.知识点, 科目: q.科目,
  }));
  // 给 6 道客观题造「历史答错」记录，作为演示错题本
  const wrongSeeds = [
    { id: '01103', userAnswer: 'F', wrongCount: 2 },
    { id: '01202', userAnswer: 'C', wrongCount: 1 },
    { id: '01206', userAnswer: 'D', wrongCount: 3 },
    { id: '01301', userAnswer: 'A', wrongCount: 1 },
    { id: '01303', userAnswer: 'AB', wrongCount: 2 },
    { id: '03402', userAnswer: '//', wrongCount: 1 },
  ];
  const wrongQuestions = wrongSeeds.map((w, i) => {
    const q = questions.find((x) => x.id === w.id);
    return {
      userId: 81, questionId: w.id, wrongCount: w.wrongCount,
      lastWrongAt: toDateTime(new Date(Date.now() - (i + 1) * 86400000 * 3)),
      userAnswer: w.userAnswer, examTitle: '示例测验 · 计算思维第 1 章',
      snapshot: { 题目: q.题目, 题型: q.题型 },
    };
  }).filter((w) => questions.some((x) => x.id === w.questionId));

  return {
    users: [{ id: 81, username: '123456', password: '123456', nickname: '演示学生', role: 'student', studentNo: '112233' }],
    tokens: {},
    questions,
    wrongQuestions,
    plans: [],
    records: [],
    seq: { record: 1 },
  };
}

function loadDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = seedDB();
    saveDB();
    console.log('  首次启动：已用示例数据初始化 server/data/db.json');
  }
}
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }

const findQuestion = (id) => db.questions.find((q) => q.id === String(id)) || null;
const shapeQuestion = (q, withAnswer = false) => {
  if (!q) return null;
  const type = Number(q.题型);
  return {
    questionId: String(q.id), title: q.题目, type, typeName: TYPE_NAMES[type] || '未知题型',
    options: parseOptions(q.选项), knowledge: q.知识点 || '',
    chapter: q.章节 === null || q.章节 === undefined ? null : Number(q.章节),
    difficulty: Number(q.难度) || 0, difficultyName: DIFFICULTY_NAMES[Number(q.难度)] || '',
    subject: q.科目 || '',
    ...(withAnswer ? { answer: q.答案 || '', explanation: q.解析 || '' } : {}),
  };
};

// ==================== 业务逻辑（移植自 reviewService） ====================

const getSummary = (userId) => {
  const now = toDateTime(new Date());
  const todayEnd = toDateTime(new Date(Date.now() + 86400000));
  const plans = db.plans.filter((p) => p.userId === userId);
  const due = plans.filter((p) => !p.mastered && p.nextReviewAt <= now).length;
  const today = plans.filter((p) => !p.mastered && p.nextReviewAt <= todayEnd).length;
  const mastered = plans.filter((p) => p.mastered).length;
  const upcomingMap = {};
  plans.forEach((p) => {
    if (!p.mastered && p.nextReviewAt > now && p.nextReviewAt <= toDateTime(new Date(Date.now() + 7 * 86400000))) {
      const day = p.nextReviewAt.slice(0, 10);
      upcomingMap[day] = (upcomingMap[day] || 0) + 1;
    }
  });
  return {
    dueCount: due, todayCount: today, masteredCount: mastered, totalCount: plans.length,
    upcoming: Object.keys(upcomingMap).sort().map((date) => ({ date, count: upcomingMap[date] })),
  };
};

const listPlans = (userId, options = {}) => {
  const page = Math.max(parseInt(options.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(options.pageSize) || 20, 1), 100);
  const now = toDateTime(new Date());
  let rows = db.plans.filter((p) => p.userId === userId);
  const scope = options.scope || 'all';
  if (scope === 'due') rows = rows.filter((p) => !p.mastered && p.nextReviewAt <= now);
  else if (scope === 'today') rows = rows.filter((p) => !p.mastered && p.nextReviewAt <= todayEndStr());
  else if (scope === 'upcoming') rows = rows.filter((p) => !p.mastered && p.nextReviewAt > now);
  else if (scope === 'mastered') rows = rows.filter((p) => p.mastered);
  else rows = rows.filter((p) => !p.mastered); // 与原项目一致：all = 未掌握
  rows = rows.slice().sort((a, b) => String(a.nextReviewAt).localeCompare(String(b.nextReviewAt)));
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  return {
    rows: rows.map(decoratePlan), total, page, pageSize, curve: FORGETTING_CURVE,
  };
};
const todayEndStr = () => toDateTime(new Date(Date.now() + 86400000));

const decoratePlan = (plan) => ({
  questionId: String(plan.questionId),
  source: plan.source,
  stage: Number(plan.stage),
  mastered: !!plan.mastered,
  stageLabel: stageLabel(plan.stage, plan.mastered),
  nextReviewAt: plan.nextReviewAt,
  daysUntil: daysUntil(plan.nextReviewAt),
  overdue: daysUntil(plan.nextReviewAt) < 0,
  lastResult: plan.lastResult ?? null,
  reviewCount: Number(plan.reviewCount) || 0,
  wrongCount: Number(plan.wrongCount) || 0,
  createdAt: plan.createdAt,
  question: shapeQuestion(findQuestion(plan.questionId)),
});

const enrollPlans = (userId, body) => {
  const ids = [...new Set((body.questionIds || []).map((v) => String(v || '').trim()).filter(Boolean))];
  if (!ids.length) throw makeError('请至少选择一道题', 400, 40001);
  if (ids.length > 200) throw makeError('一次最多加入 200 道题', 400, 40002);
  const now = toDateTime(new Date());
  const added = [];
  ids.forEach((id) => {
    if (!findQuestion(id)) return;
    let plan = db.plans.find((p) => p.userId === userId && p.questionId === id);
    if (!plan) {
      plan = { userId, questionId: id, source: body.source || 'library', stage: 0, mastered: false, nextReviewAt: now, lastResult: null, reviewCount: 0, wrongCount: 0, createdAt: now };
      db.plans.push(plan);
    } else {
      plan.nextReviewAt = now; plan.mastered = false; plan.stage = 0;
    }
    added.push(id);
  });
  saveDB();
  return { added: added.length, questionIds: added, nextReviewAt: now };
};

const removePlan = (userId, questionId) => {
  const before = db.plans.length;
  db.plans = db.plans.filter((p) => !(p.userId === userId && String(p.questionId) === String(questionId)));
  if (db.plans.length === before) throw makeError('该题目不在复习计划中', 404, 40401);
  saveDB();
  return { questionId: String(questionId), removed: true };
};

const addRecord = (userId, { questionId, mode, isCorrect, userAnswer, usedHint = 0, hintLevel = 0, stage = null }) => {
  const rec = {
    id: db.seq.record++, userId, questionId: String(questionId), mode,
    isCorrect: isCorrect === null || isCorrect === undefined ? null : !!isCorrect,
    userAnswer: userAnswer === null || userAnswer === undefined ? null : String(userAnswer),
    usedHint: usedHint ? 1 : 0, hintLevel: Number(hintLevel) || 0,
    stage: stage === null || stage === undefined ? null : Number(stage),
    createdAt: toDateTime(new Date()),
  };
  db.records.push(rec);
  return rec;
};

const submitReviewResult = (userId, questionId, body) => {
  const result = String(body.result || '').trim();
  if (!['remembered', 'forgot'].includes(result)) throw makeError("result 只能是 'remembered' 或 'forgot'", 400, 40003);
  const plan = db.plans.find((p) => p.userId === userId && String(p.questionId) === String(questionId));
  if (!plan) throw makeError('该题目尚未加入复习计划', 404, 40402);
  const remembered = result === 'remembered';
  const currentStage = Number(plan.stage) || 0;
  let stage = currentStage; let mastered = false; let intervalDays;
  if (remembered) {
    stage = currentStage + 1;
    if (stage >= FORGETTING_CURVE.length) { mastered = true; stage = FORGETTING_CURVE.length; intervalDays = MASTERED_REVIEW_DAYS; }
    else intervalDays = FORGETTING_CURVE[stage];
  } else { stage = 0; intervalDays = FORGETTING_CURVE[0]; }
  const nextReviewAt = addDays(intervalDays);
  Object.assign(plan, { stage, mastered, nextReviewAt, lastResult: result, reviewCount: (plan.reviewCount || 0) + (remembered ? 1 : 0), wrongCount: (plan.wrongCount || 0) + (remembered ? 0 : 1) });
  addRecord(userId, { questionId, mode: 'remind', isCorrect: remembered, userAnswer: result, stage: currentStage });
  saveDB();
  return { questionId: String(questionId), stage, mastered, stageLabel: stageLabel(stage, mastered), intervalDays, nextReviewAt, reviewCount: plan.reviewCount, wrongCount: plan.wrongCount };
};

const findLatestRecord = (userId, questionId, mode) => {
  const rows = db.records.filter((r) => r.userId === userId && r.questionId === String(questionId) && (!mode || r.mode === mode));
  return rows.length ? rows[rows.length - 1] : null;
};

const getRedoDetail = (userId, questionId) => {
  const q = findQuestion(questionId);
  if (!q) throw makeError('题目不存在', 404, 40403);
  const last = findLatestRecord(userId, questionId, 'redo');
  return {
    question: shapeQuestion(q),
    lastAttempt: last ? {
      isCorrect: last.isCorrect === null ? null : !!last.isCorrect,
      userAnswer: last.userAnswer, usedHint: !!last.usedHint,
      hintLevel: Number(last.hintLevel) || 0, createdAt: last.createdAt,
    } : null,
  };
};

const submitRedo = (userId, questionId, body) => {
  const q = findQuestion(questionId);
  if (!q) throw makeError('题目不存在', 404, 40403);
  const userAnswer = body.userAnswer;
  const isCorrect = checkAnswer(Number(q.题型), userAnswer, q.答案);
  const plan = db.plans.find((p) => p.userId === userId && String(p.questionId) === String(questionId));
  addRecord(userId, {
    questionId, mode: body.mode === 'guide' ? 'guide' : 'redo', isCorrect,
    userAnswer, usedHint: body.usedHint, hintLevel: body.hintLevel,
    stage: plan ? plan.stage : null,
  });
  saveDB();
  return { questionId: String(questionId), isCorrect, correctAnswer: q.答案, explanation: q.解析 || '暂无解析', userAnswer: String(userAnswer ?? '') };
};

const buildGuideContent = (question, level) => {
  const type = Number(question.题型);
  const options = parseOptions(question.选项);
  const answerRaw = String(question.答案 || '').trim();
  if (level <= 1) {
    const lines = [];
    lines.push(question.知识点 ? `本题考点：${question.知识点}` : '本题未标注知识点，先通读题干抓关键词。');
    lines.push(`题型：${TYPE_NAMES[type] || '未知'}　难度：${DIFFICULTY_NAMES[Number(question.难度)] || '未标注'}`);
    if (question.章节 !== null && question.章节 !== undefined) lines.push(`所属章节：第 ${question.章节} 章`);
    if (type === 3) lines.push('注意：这是多选题，答案不止一个，别漏选也别多选。');
    if (type === 1) lines.push('注意：判断题只有「对 / 错」两种可能，找题干里那个最容易设错的点。');
    return { title: GUIDE_LEVELS[0].title, lines };
  }
  if (level === 2) {
    const lines = [];
    if ([1, 2, 3].includes(type) && options.length) {
      const correctKeys = answerRaw.toUpperCase().split('').filter((c) => /[A-F]/.test(c));
      const wrongOptions = options.filter((o) => !correctKeys.includes(o.key));
      if (wrongOptions.length && options.length > 1) {
        const pick = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
        lines.push(`排除法：选项 ${pick.key}（${pick.text}）可以先排除。`);
      }
      if (type === 3) lines.push(`本题正确答案共有 ${correctKeys.length || '多'} 个选项。`);
      if (type === 2) lines.push('单选题：剩下的选项里，选与题干限定条件**完全吻合**的那一个，警惕「以偏概全」的干扰项。');
      if (type === 1) lines.push('判断题：把题干当成一句陈述，逐字检查有没有绝对化表述（如「一定」「全部」「只有」）。');
    } else {
      const answerText = stripOptionKey(answerRaw);
      if (answerText) {
        lines.push(`答案一共 ${answerText.length} 个字，第一个字是「${answerText[0]}」。`);
        lines.push('先按这个长度和首字回忆术语，再动笔。');
      } else lines.push('把题干里的关键条件圈出来，逐个对应到知识点定义上。');
    }
    if (question.知识点) lines.push(`回到知识点「${question.知识点}」的定义，看看它有几个要点。`);
    return { title: GUIDE_LEVELS[1].title, lines };
  }
  const lines = [];
  lines.push(`正确答案：${answerRaw || '（题库未录入答案）'}`);
  lines.push(question.解析 ? `解析：${question.解析}` : '这道题暂无解析，可以请教老师或同学。');
  return { title: GUIDE_LEVELS[2].title, lines, answer: answerRaw, explanation: question.解析 || '' };
};

const getGuide = (userId, questionId, query) => {
  const q = findQuestion(questionId);
  if (!q) throw makeError('题目不存在', 404, 40403);
  const lv = Math.min(Math.max(parseInt(query.level) || 1, 1), MAX_GUIDE_LEVEL);
  const content = buildGuideContent(q, lv);
  if (String(query.record) === '1') {
    addRecord(userId, { questionId, mode: 'guide', isCorrect: null, userAnswer: null, usedHint: 1, hintLevel: lv, stage: null });
    saveDB();
  }
  return {
    questionId: String(questionId), level: lv, maxLevel: MAX_GUIDE_LEVEL, levels: GUIDE_LEVELS,
    title: content.title, lines: content.lines,
    answer: content.answer || null, explanation: content.explanation || null,
    question: shapeQuestion(q),
  };
};

const listRecords = (userId, options = {}) => {
  const page = Math.max(parseInt(options.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(options.pageSize) || 20, 1), 100);
  let rows = db.records.filter((r) => r.userId === userId);
  if (options.mode) rows = rows.filter((r) => r.mode === options.mode);
  if (options.questionId) rows = rows.filter((r) => r.questionId === String(options.questionId));
  rows = rows.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  return {
    rows: rows.map((r) => {
      const q = findQuestion(r.questionId);
      return {
        id: Number(r.id), questionId: String(r.questionId), mode: r.mode,
        isCorrect: r.isCorrect === null ? null : !!r.isCorrect,
        userAnswer: r.userAnswer, usedHint: !!r.usedHint,
        hintLevel: Number(r.hintLevel) || 0, stage: r.stage === null ? null : Number(r.stage),
        createdAt: r.createdAt, questionTitle: q ? q.题目 : '', questionType: q ? Number(q.题型) : null,
      };
    }),
    total, page, pageSize,
  };
};

const wrongQuestions = (userId, options = {}) => {
  const page = Math.max(parseInt(options.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(options.pageSize) || 10, 1), 100);
  let rows = db.wrongQuestions.filter((w) => w.userId === userId);
  if (options.questionType) rows = rows.filter((w) => { const q = findQuestion(w.questionId); return q && Number(q.题型) === Number(options.questionType); });
  if (options.keyword) {
    const kw = String(options.keyword).toLowerCase();
    rows = rows.filter((w) => { const q = findQuestion(w.questionId); return q && (String(q.题目).toLowerCase().includes(kw) || String(q.知识点 || '').toLowerCase().includes(kw)); });
  }
  rows = rows.slice().sort((a, b) => String(b.lastWrongAt).localeCompare(String(a.lastWrongAt)));
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  return {
    list: rows.map((w) => {
      const q = findQuestion(w.questionId) || {};
      return {
        id: q.id, 题目: q.题目, 题型: q.题型, 选项: q.选项, 知识点: q.知识点,
        章节: q.章节, 难度: q.难度, 科目: q.科目,
        wrong_count: w.wrongCount, last_wrong_at: w.lastWrongAt,
        user_answer: w.userAnswer, exam_title: w.examTitle,
      };
    }),
    total,
  };
};

const makeError = (message, statusCode = 400, errorCode = 40001) => {
  const err = new Error(message); err.statusCode = statusCode; err.errorCode = errorCode; return err;
};

// ==================== HTTP 框架 ====================

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const ok = (res, data) => sendJSON(res, 200, { code: 0, message: '操作成功', data });
const fail = (res, err) => sendJSON(res, err.statusCode || 400, { code: err.errorCode || 40000, message: err.message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(makeError('请求体不是合法 JSON', 400, 40000)); } });
    req.on('error', reject);
  });
}

function authUser(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const uid = db.tokens[m[1]];
  if (!uid) return null;
  return db.users.find((u) => u.id === uid) || null;
}

// ==================== API 路由 ====================

async function handleAPI(req, res, pathname, query) {
  // ---- 登录（无需鉴权）----
  if (req.method === 'POST' && pathname === '/api/v1/auth/login') {
    const body = await readBody(req);
    const user = db.users.find((u) => u.username === String(body.username || '').trim());
    if (!user || user.password !== String(body.password || '')) throw makeError('账号或密码错误', 401, 40101);
    const token = crypto.randomBytes(24).toString('hex');
    db.tokens[token] = user.id; saveDB();
    return ok(res, { token, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } });
  }

  // ---- 错题本（学生）----
  if (req.method === 'GET' && pathname === '/api/v1/practice/wrong-questions') {
    const user = authUser(req);
    if (!user) throw makeError('未登录或登录已过期', 401, 40100);
    return ok(res, wrongQuestions(user.id, query));
  }

  // ---- 复习与检测（仅 student）----
  if (pathname.startsWith('/api/student/review')) {
    const user = authUser(req);
    if (!user) throw makeError('未登录或登录已过期', 401, 40100);
    if (user.role !== 'student') throw makeError('仅学生可访问复习模块', 403, 40300);

    if (req.method === 'GET' && pathname === '/api/student/review/summary') return ok(res, getSummary(user.id));

    if (req.method === 'GET' && pathname === '/api/student/review/plans') return ok(res, listPlans(user.id, query));
    if (req.method === 'POST' && pathname === '/api/student/review/plans') return ok(res, enrollPlans(user.id, await readBody(req)));

    let m;
    if ((m = pathname.match(/^\/api\/student\/review\/plans\/([^/]+)$/)) && req.method === 'DELETE') {
      return ok(res, removePlan(user.id, decodeURIComponent(m[1])));
    }
    if ((m = pathname.match(/^\/api\/student\/review\/plans\/([^/]+)\/result$/)) && req.method === 'POST') {
      return ok(res, submitReviewResult(user.id, decodeURIComponent(m[1]), await readBody(req)));
    }
    if ((m = pathname.match(/^\/api\/student\/review\/redo\/([^/]+)$/))) {
      const qid = decodeURIComponent(m[1]);
      if (req.method === 'GET') return ok(res, getRedoDetail(user.id, qid));
      if (req.method === 'POST') return ok(res, submitRedo(user.id, qid, await readBody(req)));
    }
    if ((m = pathname.match(/^\/api\/student\/review\/guide\/([^/]+)$/)) && req.method === 'GET') {
      return ok(res, getGuide(user.id, decodeURIComponent(m[1]), query));
    }
    if (pathname === '/api/student/review/records') {
      if (req.method === 'GET') return ok(res, listRecords(user.id, query));
      if (req.method === 'POST') {
        const body = await readBody(req);
        const rec = addRecord(user.id, body); saveDB();
        return ok(res, { id: rec.id });
      }
    }
    throw makeError('接口不存在', 404, 40404);
  }

  if (pathname === '/api/health') return ok(res, { status: 'ok', standalone: true });
  throw makeError('接口不存在', 404, 40404);
}

// ==================== 静态文件 ====================

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function handleStatic(res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    const p = path.join(CANVAS_DIR, 'index.html');
    if (fs.existsSync(p)) return serveStatic(res, p);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('画布 dist 不存在：学习画布_独立版/dist');
  }
  if (pathname.startsWith('/review/')) {
    let rel = pathname.slice('/review/'.length) || 'index.html';
    let p = path.normalize(path.join(REVIEW_DIR, rel));
    if (!p.startsWith(REVIEW_DIR)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(REVIEW_DIR, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('复习模块构建产物不存在：学习画布_独立版/review'); }
    return serveStatic(res, p);
  }
  if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  // 画布 dist 内的其余静态资源（/assets/*.js、/assets/*.css 等）
  let p = path.normalize(path.join(CANVAS_DIR, pathname));
  if (p.startsWith(CANVAS_DIR) && fs.existsSync(p) && fs.statSync(p).isFile()) {
    return serveStatic(res, p);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found');
}

// ==================== 服务器 ====================

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(u.pathname);
  const query = Object.fromEntries(u.searchParams.entries());
  try {
    if (pathname.startsWith('/api/')) return await handleAPI(req, res, pathname, query);
    return handleStatic(res, pathname);
  } catch (err) {
    if (!res.headersSent) return fail(res, err);
    res.end();
  }
});

loadDB();
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log('='.repeat(52));
  console.log('  学生门户（独立版）已启动');
  console.log(`  学习画布:   ${url}`);
  console.log(`  复习与检测: ${url}review/`);
  console.log(`  账号: 123456 / 123456（内置演示数据）`);
  console.log('  按 Ctrl+C 关闭');
  console.log('='.repeat(52));
  if (process.argv.includes('--open')) {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : 'open ' + url;
    exec(cmd);
  }
});
