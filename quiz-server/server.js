const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3000;

// ===== 中间件 =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 静态文件服务：全部不缓存（讲座期间频繁更新，必须每次拿到最新版本）
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

// ===== 数据存储（内存 + 文件持久化） =====
const DATA_FILE = path.join(__dirname, 'data.json');
let submissions = {};

// 启动时加载已有数据
try {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  submissions = JSON.parse(raw);
} catch (e) {
  submissions = {};
  for (const quiz of questionsData.quizzes) {
    submissions[quiz.id] = [];
  }
}

// 确保每个quiz都有数据结构
for (const quiz of questionsData.quizzes) {
  if (!submissions[quiz.id]) submissions[quiz.id] = [];
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(submissions, null, 2), 'utf-8');
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
const BASE_URL = `http://${LOCAL_IP}:${PORT}`;

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

  // 返回题目但不返回正确答案和解析
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
  // answers 格式: { "1": "B", "2": ["A","C"], ... }

  // 计算分数和详细结果
  let correctCount = 0;
  const details = [];

  for (const q of quiz.questions) {
    const userAnswer = answers[String(q.id)] || answers[q.id];
    let isCorrect = false;

    if (q.type === 'single') {
      isCorrect = userAnswer === q.correct;
    } else {
      // 多选：需要完全匹配
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

  // 生成个性化推荐
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

  // 保存提交记录
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
  saveData();

  // 返回详细结果
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
  const quizId = parseInt(req.params.id);
  const quiz = questionsData.quizzes.find(q => q.id === quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const subs = submissions[quizId] || [];

  // 基本统计
  const totalResponses = subs.length;
  const scores = subs.map(s => s.score);
  const avgScore = totalResponses > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / totalResponses)
    : 0;
  const maxScore = totalResponses > 0 ? Math.max(...scores) : 0;
  const minScore = totalResponses > 0 ? Math.min(...scores) : 0;

  // 分数段分布
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

  // 逐题正确率
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

    // 错误选项分布
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
        // 漏选
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

  // 常见错误分析
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
    const scores = subs.map(s => s.score);
    const avgScore = subs.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / subs.length)
      : 0;
    return {
      id: quiz.id,
      title: quiz.title,
      section: quiz.section,
      totalResponses: subs.length,
      avgScore: avgScore
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

    // 转换data URL为buffer
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // 禁用缓存（避免浏览器加载到旧的相同二维码）
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
