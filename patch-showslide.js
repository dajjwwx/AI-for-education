const fs = require('fs');
const path = 'C:/Users/Administrator/WorkBuddy/2026-07-01-00-53-31/quiz-server/public/slides.html';
let c = fs.readFileSync(path, 'utf8');

const oldShowSlide = `function showSlide(idx) {
  if (idx < 0 || idx >= total) return;
  document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
  const slideId = slideOrder[idx];
  const target = document.getElementById('slide-' + slideId);
  if (target) {
    target.classList.add('active');
    target.querySelectorAll('.anim-up').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight;
      el.style.animation = '';
    });
  }
  currentIdx = idx;
  updateProgress();

  // QR码幻灯片：启动实时数据轮询（二维码由服务端img自动加载）
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
  if (typeof slideId === 'string' && slideId.startsWith('qr-')) {
    const quizId = parseInt(slideId.split('-')[1]);
    loadQRStats(quizId);
    qrPollTimer = setInterval(() => loadQRStats(quizId), 3000);
  }
}`;

const newShowSlide = `function showSlide(idx) {
  if (idx < 0 || idx >= total) return;
  console.log('[showSlide] idx:', idx, 'slideId:', slideOrder[idx]);
  try {
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    const slideId = slideOrder[idx];
    const target = document.getElementById('slide-' + slideId);
    if (target) {
      target.classList.add('active');
      target.querySelectorAll('.anim-up').forEach(el => {
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = '';
      });
    } else {
      console.warn('[showSlide] Slide not found:', 'slide-' + slideId);
    }
    currentIdx = idx;
    updateProgress();
    // 更新 slide-num 显示
    const nums = document.querySelectorAll('.slide-num');
    nums.forEach(el => {
      if (el.closest('.slide') === target) {
        el.textContent = (idx + 1) + ' / ' + total;
      }
    });
  } catch (e) {
    console.error('[showSlide] Error:', e);
  }

  // QR码幻灯片：启动实时数据轮询（二维码由服务端img自动加载）
  try {
    if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
    const slideId = slideOrder[idx];
    if (typeof slideId === 'string' && slideId.startsWith('qr-')) {
      const quizId = parseInt(slideId.split('-')[1]);
      loadQRStats(quizId);
      qrPollTimer = setInterval(() => loadQRStats(quizId), 3000);
    }
  } catch (e) {
    console.error('[showSlide] QR stats error:', e);
  }
}`;

if (c.includes(oldShowSlide)) {
  c = c.replace(oldShowSlide, newShowSlide);
  fs.writeFileSync(path, c, 'utf8');
  console.log('Patched showSlide successfully!');
} else {
  console.log('ERROR: oldShowSlide pattern not found!');
  // Try to find the function
  const idx = c.indexOf('function showSlide');
  if (idx >= 0) {
    console.log('Found showSlide at char:', idx);
    console.log('Context:', c.substring(idx, idx + 200));
  }
}
