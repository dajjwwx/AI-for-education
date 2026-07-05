
// ===== 粒子系统 =====
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
let W, H;

function resizeCanvas() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const colors = ['#e94560', '#00d4ff', '#a855f7', '#ffd700'];

class Particle {
  constructor() { this.reset(); this.y = Math.random() * H; }
  reset() {
    this.x = Math.random() * W;
    this.y = H + 10;
    this.size = Math.random() * 2.5 + 0.5;
    this.speedY = Math.random() * 0.8 + 0.2;
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.color = colors[Math.floor(Math.random() * colors.length)];
    this.opacity = Math.random() * 0.5 + 0.1;
    this.twinkle = Math.random() * 0.02;
    this.twinkleDir = 1;
  }
  update() {
    this.y -= this.speedY;
    this.x += this.speedX;
    this.opacity += this.twinkle * this.twinkleDir;
    if (this.opacity > 0.6 || this.opacity < 0.05) this.twinkleDir *= -1;
    if (this.y < -10) this.reset();
  }
  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.globalAlpha = this.opacity;
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    ctx.fill();
  }
}

function initParticles() {
  particles = [];
  const count = Math.min(80, Math.floor(W / 20));
  for (let i = 0; i < count; i++) particles.push(new Particle());
}
initParticles();

function animateParticles() {
  ctx.clearRect(0, 0, W, H);
  particles.forEach(p => { p.update(); p.draw(); });
  // 连线
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = particles[i].color;
        ctx.globalAlpha = (1 - dist / 120) * 0.08;
        ctx.lineWidth = 0.5;
        ctx.shadowBlur = 0;
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(animateParticles);
}
animateParticles();
window.addEventListener('resize', initParticles);

// ===== 幻灯片控制 =====
// 幻灯片顺序数组：原始幻灯片用数字，QR扫码幻灯片用 'qr-N'
const slideOrder = [
  1, 2, 3, 4, 'qr-1',           // 开场 + 答题
  5, 6, 7, 8, 9, 10, 11, 'qr-2', // 六大能力 + 答题
  12, 13, 14, 15, 16, 'qr-3',     // 教师角色 + 答题
  17, 18, 19, 'qr-4',             // AI赋能 + 答题
  20, 21, 22, 23, 24, 25, 'qr-5', // 教学方法 + 答题
  26, 27, 'qr-6',                 // 结语 + 答题
  28                              // 致谢
];
let currentIdx = 0;
const total = slideOrder.length;
let qrPollTimer = null;

function updateProgress() {
  document.getElementById('progress').style.width = ((currentIdx + 1) / total * 100) + '%';
}

function showSlide(idx) {
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
}

function nextSlide() { if (currentIdx < total - 1) showSlide(currentIdx + 1); }
function prevSlide() { if (currentIdx > 0) showSlide(currentIdx - 1); }

document.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextSlide(); }
  if (e.key === 'ArrowLeft') prevSlide();
  if (e.key === 'Home') showSlide(0);
  if (e.key === 'End') showSlide(total - 1);
});

// 触摸滑动支持
let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; });
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) { dx > 0 ? prevSlide() : nextSlide(); }
});

// ===== QR扫码幻灯片实时数据 =====
async function loadQRStats(quizId) {
  try {
    const res = await fetch('/api/stats/' + quizId);
    const data = await res.json();
    renderQRStats(quizId, data);
  } catch (e) {
    // 静默失败，服务器可能未启动
  }
}

function renderQRStats(quizId, data) {
  const container = document.getElementById('qr-stats-' + quizId);
  if (!container) return;

  if (data.totalResponses === 0) {
    container.innerHTML = `
      <div class="live-empty">
        <div class="icon">⏳</div>
        <p>等待扫码答题...</p>
      </div>
    `;
    return;
  }

  // 统计行
  const avgColor = data.avgScore >= 80 ? '#4ade80' : data.avgScore >= 60 ? '#ffd700' : '#e94560';
  let html = `
    <div class="live-stats-row">
      <div class="live-stat">
        <div class="val" style="color:#00d4ff">${data.totalResponses}</div>
        <div class="lbl">答题人数</div>
      </div>
      <div class="live-stat">
        <div class="val" style="color:${avgColor}">${data.avgScore}</div>
        <div class="lbl">平均分</div>
      </div>
    </div>
  `;

  // 逐题正确率
  html += '<div class="live-q-stats">';
  for (const q of data.questionStats) {
    const rate = q.correctRate;
    const color = rate >= 80 ? '#4ade80' : rate >= 60 ? '#ffd700' : '#e94560';
    html += `
      <div class="live-q-bar">
        <span class="qnum">Q${q.questionId}</span>
        <div class="qtrack"><div class="qfill" style="width:${rate}%;background:${color}"></div></div>
        <span class="qrate" style="color:${color}">${rate}%</span>
      </div>
    `;
  }
  html += '</div>';

  container.innerHTML = html;
}

updateProgress();

// ===== QR码加载：用时间戳强制每个二维码独立请求，杜绝浏览器缓存 =====
window.addEventListener('load', function() {
  setTimeout(function() {
    for (let i = 1; i <= 6; i++) {
      const img = document.getElementById('qrcode-' + i);
      if (img && img.dataset.qrSrc) {
        // 每个二维码加不同时间戳，确保浏览器6次独立请求
        const finalSrc = img.dataset.qrSrc + '?t=' + Date.now() + '_' + i;
        console.log('[QR] Loading qrcode-' + i + ' from:', finalSrc);
        img.src = finalSrc;
      }
    }
  }, 100);
});
