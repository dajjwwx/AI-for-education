const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('sql.js');

const app = express();
const PORT = 3000;

// ===== 中间件 =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// ===== 数据加载 =====
const questionsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8')
);

// ===== SQLite 数据库 =====
const DB_FILE = path.join(__dirname, 'data.db');
let db;
let submissions = {};

async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '匿名',
    answers TEXT NOT NULL,
    score INTEGER,
    correct_count INTEGER,
    total_questions INTEGER NOT NULL,
    wrong_question_ids TEXT,
    submitted_at TEXT NOT NULL
  )`);

  // 迁移：旧表可能 NOT NULL，重新创建以允许 NULL
  const tableInfo = db.exec("PRAGMA table_info(submissions)");
  if (tableInfo.length > 0) {
    const cols = tableInfo[0].values.map(v => v[1]);
    if (cols.includes('score') && cols.includes('correct_count') && cols.includes('wrong_question_ids')) {
      const scoreCol = tableInfo[0].values.find(v => v[1] === 'score');
      if (scoreCol && scoreCol[3] === 1) { // 1 = NOT NULL
        console.log('[DB] Migrating submissions table schema...');
        db.run("ALTER TABLE submissions RENAME TO submissions_old");
        db.run(`CREATE TABLE submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          quiz_id INTEGER NOT NULL,
          name TEXT NOT NULL DEFAULT '匿名',
          answers TEXT NOT NULL,
          score INTEGER,
          correct_count INTEGER,
          total_questions INTEGER NOT NULL,
          wrong_question_ids TEXT,
          submitted_at TEXT NOT NULL
        )`);
        db.run(`INSERT INTO submissions (id, quiz_id, name, answers, score, correct_count, total_questions, wrong_question_ids, submitted_at)
          SELECT id, quiz_id, name, answers, score, correct_count, total_questions, wrong_question_ids, submitted_at FROM submissions_old`);
        db.run("DROP TABLE submissions_old");
        const d = db.export();
        fs.writeFileSync(DB_FILE, Buffer.from(d));
        console.log('[DB] Schema migration complete');
      }
    }
  }

  // 从数据库加载到内存
  for (const quiz of questionsData.quizzes) {
    submissions[quiz.id] = [];
  }

  // 迁移旧 data.json 到 SQLite
  const DATA_FILE = path.join(__dirname, 'data.json');
  if (fs.existsSync(DATA_FILE)) {
    try {
      const oldRaw = fs.readFileSync(DATA_FILE, 'utf-8');
      const oldData = JSON.parse(oldRaw);
      const count = db.exec('SELECT COUNT(*) as cnt FROM submissions');
      const existingCount = count.length > 0 ? count[0].values[0][0] : 0;
      if (existingCount === 0 && Object.keys(oldData).length > 0) {
        const insertStmt = db.prepare(`INSERT INTO submissions
          (quiz_id, name, answers, score, correct_count, total_questions, wrong_question_ids, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const [qid, subs] of Object.entries(oldData)) {
          for (const sub of subs) {
            insertStmt.run([
              parseInt(qid),
              sub.name,
              JSON.stringify(sub.answers),
              sub.score,
              sub.correctCount,
              sub.totalQuestions,
              JSON.stringify(sub.wrongQuestionIds),
              sub.submittedAt
            ]);
          }
        }
        insertStmt.free();
        const data = db.export();
        fs.writeFileSync(DB_FILE, Buffer.from(data));
        // 重命名旧文件
        fs.renameSync(DATA_FILE, DATA_FILE + '.bak');
        console.log(`[DB] Migrated old data.json to SQLite`);
      }
    } catch (e) {
      console.log('[DB] No old data.json to migrate or migration skipped:', e.message);
    }
  }

  const stmt = db.prepare('SELECT * FROM submissions ORDER BY id ASC');
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (!submissions[row.quiz_id]) submissions[row.quiz_id] = [];
    submissions[row.quiz_id].push({
      name: row.name,
      answers: JSON.parse(row.answers),
      score: row.score,
      correctCount: row.correct_count,
      totalQuestions: row.total_questions,
      wrongQuestionIds: JSON.parse(row.wrong_question_ids),
      submittedAt: row.submitted_at
    });
  }
  stmt.free();
  console.log(`[DB] Loaded ${Object.values(submissions).flat().length} submissions from SQLite`);
}

function saveSubmission(quizId, submission) {
  const stmt = db.prepare(`INSERT INTO submissions
    (quiz_id, name, answers, score, correct_count, total_questions, wrong_question_ids, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run([
    quizId,
    submission.name,
    JSON.stringify(submission.answers),
    submission.score,
    submission.correctCount,
    submission.totalQuestions,
    JSON.stringify(submission.wrongQuestionIds),
    submission.submittedAt
  ]);
  stmt.free();
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
}

// ===== 获取本机IP =====
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const LOCAL_IP = getLocalIP();
const BASE_URL = process.env.BASE_URL || `http://lecture.yuekegu.com`;

// ===== API 路由 =====

// 获取所有quiz概览
app.get('/api/quizzes', (req, res) => {
  const overview = questionsData.quizzes.map(q => ({
    id: q.id,
    title: q.title,
    section: q.section,
    questionCount: q.questions.length,
    responseCount: (submissions[q.id] || []).length
  }));
  res.json(overview);
});

// 获取某个quiz的题目（不含正确答案）
app.get('/api/quiz/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const quiz = questionsData.quizzes.find(q => q.id === id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const safeQuestions = quiz.questions.map(q => ({
    id: q.id,
    type: q.type,
    question: q.question,
    options: q.options
  }));

  res.json({
    id: quiz.id,
    title: quiz.title,
    section: quiz.section,
    questions: safeQuestions
  });
});

// 提交答案
app.post('/api/submit/:id', (req, res) => {
  const quizId = parseInt(req.params.id);
  const quiz = questionsData.quizzes.find(q => q.id === quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const { name, answers } = req.body;

  // 判断是否为调查问卷（所有题无正确答案）
  const isSurvey = quiz.questions.every(q => q.correct === null);

  if (isSurvey) {
    // 调查问卷：不评分，仅记录答案
    const details = quiz.questions.map(q => ({
      questionId: q.id,
      question: q.question,
      type: q.type,
      options: q.options,
      userAnswer: answers[String(q.id)] || answers[q.id] || null
    }));

    const submission = {
      name: name || '匿名',
      answers: answers,
      score: null,
      correctCount: null,
      totalQuestions: quiz.questions.length,
      wrongQuestionIds: [],
      submittedAt: new Date().toISOString()
    };

    if (!submissions[quizId]) submissions[quizId] = [];
    submissions[quizId].push(submission);
    saveSubmission(quizId, submission);

    res.json({
      isSurvey: true,
      totalQuestions: quiz.questions.length,
      details: details
    });
    return;
  }

  let correctCount = 0;
  const details = [];

  for (const q of quiz.questions) {
    const userAnswer = answers[String(q.id)] || answers[q.id];
    let isCorrect = false;

    if (q.type === 'single') {
      isCorrect = userAnswer === q.correct;
    } else {
      if (Array.isArray(userAnswer) && Array.isArray(q.correct)) {
        const sorted1 = [...userAnswer].sort();
        const sorted2 = [...q.correct].sort();
        isCorrect = sorted1.length === sorted2.length &&
                    sorted1.every((v, i) => v === sorted2[i]);
      }
    }

    if (isCorrect) correctCount++;

    details.push({
      questionId: q.id,
      question: q.question,
      type: q.type,
      options: q.options,
      userAnswer: userAnswer,
      correctAnswer: q.correct,
      isCorrect: isCorrect,
      explanation: q.explanation,
      errorAnalysis: q.errorAnalysis,
      recommendation: q.recommendation
    });
  }

  const totalQuestions = quiz.questions.length;
  const score = Math.round((correctCount / totalQuestions) * 100);

  const wrongQuestions = details.filter(d => !d.isCorrect);
  let overallRecommendation = '';

  if (score >= 80) {
    overallRecommendation = '🎉 优秀！您已充分掌握本部分内容。建议继续学习下一部分，并尝试在实际教学中实践。';
  } else if (score >= 60) {
    overallRecommendation = '👍 良好！基本掌握了核心内容。建议重点复习以下答错的题目涉及的知识点。';
  } else {
    overallRecommendation = '📚 还需加强学习。建议重新回顾本部分讲座内容，观看推荐视频后再来答题。';
  }

  const specificRecommendations = wrongQuestions.map(q => ({
    question: q.question,
    recommendation: q.recommendation
  }));

  const submission = {
    name: name || '匿名',
    answers: answers,
    score: score,
    correctCount: correctCount,
    totalQuestions: totalQuestions,
    wrongQuestionIds: wrongQuestions.map(q => q.questionId),
    submittedAt: new Date().toISOString()
  };

  if (!submissions[quizId]) submissions[quizId] = [];
  submissions[quizId].push(submission);
  saveSubmission(quizId, submission);

  res.json({
    score: score,
    correctCount: correctCount,
    totalQuestions: totalQuestions,
    details: details,
    overallRecommendation: overallRecommendation,
    specificRecommendations: specificRecommendations
  });
});

// 获取某个quiz的统计
app.get('/api/stats/:id', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const quizId = parseInt(req.params.id);
  const quiz = questionsData.quizzes.find(q => q.id === quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const subs = submissions[quizId] || [];

  // 判断是否为调查问卷
  const isSurvey = quiz.questions.every(q => q.correct === null);

  if (isSurvey) {
    // 调查问卷统计：选项分布
    const totalResponses = subs.length;

    const questionStats = quiz.questions.map(q => {
      const optionCounts = {};
      for (const opt of q.options) {
        optionCounts[opt.label] = 0;
      }

      for (const sub of subs) {
        const ans = sub.answers[String(q.id)] || sub.answers[q.id];
        if (q.type === 'single') {
          if (ans && optionCounts[ans] !== undefined) {
            optionCounts[ans]++;
          }
        } else if (Array.isArray(ans)) {
          for (const a of ans) {
            if (optionCounts[a] !== undefined) {
              optionCounts[a]++;
            }
          }
        }
      }

      const distribution = q.options.map(opt => ({
        label: opt.label,
        text: opt.text,
        count: optionCounts[opt.label] || 0,
        percent: totalResponses > 0 ? Math.round((optionCounts[opt.label] / totalResponses) * 100) : 0
      }));

      return {
        questionId: q.id,
        question: q.question,
        type: q.type,
        options: q.options,
        distribution: distribution,
        totalResponses: totalResponses
      };
    });

    res.json({
      quizId: quizId,
      quizTitle: quiz.title,
      isSurvey: true,
      totalResponses: totalResponses,
      questionStats: questionStats,
      recentSubmissions: subs.slice(-5).reverse().map(s => ({
        name: s.name,
        submittedAt: s.submittedAt
      }))
    });
    return;
  }

  const totalResponses = subs.length;
  const scores = subs.map(s => s.score);
  const avgScore = totalResponses > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / totalResponses)
    : 0;
  const maxScore = totalResponses > 0 ? Math.max(...scores) : 0;
  const minScore = totalResponses > 0 ? Math.min(...scores) : 0;

  const distribution = {
    '90-100': 0,
    '80-89': 0,
    '60-79': 0,
    '0-59': 0
  };
  for (const s of scores) {
    if (s >= 90) distribution['90-100']++;
    else if (s >= 80) distribution['80-89']++;
    else if (s >= 60) distribution['60-79']++;
    else distribution['0-59']++;
  }

  const questionStats = quiz.questions.map(q => {
    const correct = subs.filter(s => {
      const ans = s.answers[String(q.id)] || s.answers[q.id];
      if (q.type === 'single') return ans === q.correct;
      if (Array.isArray(ans) && Array.isArray(q.correct)) {
        const s1 = [...ans].sort();
        const s2 = [...q.correct].sort();
        return s1.length === s2.length && s1.every((v, i) => v === s2[i]);
      }
      return false;
    }).length;

    const rate = totalResponses > 0 ? Math.round((correct / totalResponses) * 100) : 0;

    const wrongOptions = {};
    for (const sub of subs) {
      const ans = sub.answers[String(q.id)] || sub.answers[q.id];
      if (q.type === 'single') {
        if (ans !== q.correct) {
          const key = ans || '未答';
          wrongOptions[key] = (wrongOptions[key] || 0) + 1;
        }
      } else if (Array.isArray(ans)) {
        for (const a of ans) {
          if (!q.correct.includes(a)) {
            wrongOptions[a] = (wrongOptions[a] || 0) + 1;
          }
        }
        for (const c of q.correct) {
          if (!ans.includes(c)) {
            wrongOptions['漏选' + c] = (wrongOptions['漏选' + c] || 0) + 1;
          }
        }
      }
    }

    return {
      questionId: q.id,
      question: q.question,
      type: q.type,
      correctAnswer: q.correct,
      correctCount: correct,
      correctRate: rate,
      wrongOptions: wrongOptions,
      errorAnalysis: q.errorAnalysis,
      recommendation: q.recommendation
    };
  });

  const lowRateQuestions = questionStats.filter(q => q.correctRate < 60);
  const commonErrors = lowRateQuestions.map(q => ({
    question: q.question,
    correctRate: q.correctRate,
    errorAnalysis: q.errorAnalysis,
    recommendation: q.recommendation
  }));

  res.json({
    quizId: quizId,
    quizTitle: quiz.title,
    totalResponses: totalResponses,
    avgScore: avgScore,
    maxScore: maxScore,
    minScore: minScore,
    distribution: distribution,
    questionStats: questionStats,
    commonErrors: commonErrors,
    recentSubmissions: subs.slice(-5).reverse().map(s => ({
      name: s.name,
      score: s.score,
      submittedAt: s.submittedAt
    }))
  });
});

// 获取所有quiz的统计概览
app.get('/api/stats', (req, res) => {
  const overview = questionsData.quizzes.map(quiz => {
    const subs = submissions[quiz.id] || [];
    const isSurvey = quiz.questions.every(q => q.correct === null);
    const scores = subs.map(s => s.score).filter(s => s !== null);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
    return {
      id: quiz.id,
      title: quiz.title,
      section: quiz.section,
      totalResponses: subs.length,
      avgScore: avgScore,
      isSurvey: isSurvey
    };
  });
  res.json(overview);
});

// 生成QR码图片
app.get('/api/qr/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const url = `${BASE_URL}/${type}/${id}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#0a0a1a', light: '#ffffff' }
    });

    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.type('png');
    res.send(buffer);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'QR code generation failed', message: err.message });
  }
});

// 获取服务器地址信息
app.get('/api/config', (req, res) => {
  res.json({
    baseUrl: BASE_URL,
    ip: LOCAL_IP,
    port: PORT
  });
});

// 页面路由
app.get('/', (req, res) => {
  res.redirect('/slides.html');
});

app.get('/quiz/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 启动服务器
async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   AI教育讲座扫码答题系统 已启动              ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║   讲座课件: ${BASE_URL}/slides.html`);
    console.log(`║   数据看板: ${BASE_URL}/dashboard`);
    console.log(`║   本机IP:   ${LOCAL_IP}`);
    console.log('║   学生扫码后将自动打开答题页面              ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log('按 Ctrl+C 停止服务器');
  });
}

start();
