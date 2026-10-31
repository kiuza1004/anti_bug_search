/**
 * ARGON OPTICS // Ar-18 Tactical Bio-Scanner Engine v2.0
 * 온디바이스 실시간 모기·미세 곤충 광학 추적 및 스펙트럼 분석 엔진
 */

class ArgonBugScanner {
  constructor() {
    // 주요 DOM 참조
    this.viewportStage = document.getElementById('viewportStage');
    this.video = document.getElementById('cameraVideo');
    this.overlayCanvas = document.getElementById('detectionCanvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.scanlineSweep = document.getElementById('scanlineSweep');

    // 돋보기(Loupe) DOM
    this.magCard = document.getElementById('magnifierCard');
    this.magCanvas = document.getElementById('magnifierCanvas');
    this.magCtx = this.magCanvas.getContext('2d');
    this.magCaption = document.getElementById('magCaption');
    this.loupeCoord = document.getElementById('loupeCoord');
    this.loupeModeBadge = document.getElementById('loupeModeBadge');
    this.loupePowerBtn = document.getElementById('loupePowerBtn');
    this.resetPinBtn = document.getElementById('resetPinBtn');
    this.restoreMagBtn = document.getElementById('restoreMagBtn');

    // 상단 HUD 텔레메트리 DOM
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.stabBarFill = document.getElementById('stabBarFill');
    this.fpsCounter = document.getElementById('fpsCounter');
    this.targetCount = document.getElementById('targetCount');
    this.targetPill = document.getElementById('targetPill');
    this.alarmBanner = document.getElementById('alarmBanner');
    this.alarmTitle = document.getElementById('alarmTitle');
    this.alarmSub = document.getElementById('alarmSub');
    this.reticle = document.getElementById('reticle');
    this.reticleHint = document.getElementById('reticleHint');

    // 오프스크린 컴퓨터 비전 분석 캔버스
    this.procWidth = 320;
    this.procHeight = 240;
    this.procCanvas = document.createElement('canvas');
    this.procCanvas.width = this.procWidth;
    this.procCanvas.height = this.procHeight;
    this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true });

    // 시뮬레이션 모드용 가상 소스 캔버스
    this.simCanvas = document.createElement('canvas');
    this.simCanvas.width = 640;
    this.simCanvas.height = 480;
    this.simCtx = this.simCanvas.getContext('2d');
    this.isSimulation = false;
    this.simBugs = [];

    // 런타임 상태
    this.isScanning = false;
    this.stream = null;
    this.currentFacingMode = 'environment';
    this.currentMode = 'flight'; // 'flight' | 'spot' | 'trail'
    this.currentFilter = 'standard'; // 'standard' | 'argon' | 'night' | 'invert'
    this.sensitivity = 'mid'; // 'low' | 'mid' | 'high' | 'ultra'
    this.currentZoom = 1;
    this.loupeZoom = 4; // 4x or 8x
    this.pinnedPoint = null; // { x: 0~1, y: 0~1 } 사용자 터치 지정 좌표

    this.isTorchOn = false;
    this.soundEnabled = true;
    this.vibrateEnabled = true;

    // 오디오 & 햅틱 상태
    this.audioCtx = null;
    this.lastAlarmTime = 0;

    // 컴퓨터 비전 버퍼 & 추적 데이터
    this.prevGrayBuffer = null;
    this.bgFloatBuffer = null; // 지수이동평균(EMA) 배경 모델
    this.recentTrails = [];    // 비행 궤적 포인트
    this.heatmapPoints = [];   // 잔상 누적 히트맵 포인트
    this.detectedTargets = [];
    this.stabilityScore = 100;

    // FPS 측정
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.initSimulationEntities();
    this.bindEvents();
    this.handleResize();
  }

  // -------------------------------------------------------------
  // 시뮬레이션 데모용 가상 모기 엔티티 초기화
  // -------------------------------------------------------------
  initSimulationEntities() {
    this.simBugs = [
      // 비행 모기 1 (빠른 불규칙 지그재그 비행)
      { x: 0.35, y: 0.42, vx: 0.0045, vy: -0.0032, size: 3.2, flying: true, phase: 0 },
      // 비행 날파리 2
      { x: 0.68, y: 0.55, vx: -0.0038, vy: 0.0028, size: 2.5, flying: true, phase: 2.1 },
      // 벽면에 붙어 있는 정지 모기 1 (중앙 부근)
      { x: 0.52, y: 0.48, vx: 0, vy: 0, size: 3.8, flying: false, phase: 0 },
      // 벽면에 붙어 있는 정지 벌레 2
      { x: 0.44, y: 0.56, vx: 0, vy: 0, size: 3.0, flying: false, phase: 0 }
    ];
  }

  // -------------------------------------------------------------
  // UI 이벤트 바인딩
  // -------------------------------------------------------------
  bindEvents() {
    // 온보딩 모달: 실제 카메라 시작
    document.getElementById('initCamBtn').addEventListener('click', async () => {
      document.getElementById('startModal').classList.add('hidden');
      this.initAudioContext();
      await this.startCamera();
      this.toggleScanning(true);
    });

    // 온보딩 모달: 시뮬레이션 데모 시작
    document.getElementById('simModeBtn').addEventListener('click', () => {
      document.getElementById('startModal').classList.add('hidden');
      this.initAudioContext();
      this.startSimulationMode();
      this.toggleScanning(true);
    });

    // 메인 스캔 토글
    document.getElementById('startScanBtn').addEventListener('click', () => {
      this.initAudioContext();
      this.toggleScanning(!this.isScanning);
    });

    // 3대 탐지 모드 전환
    document.querySelectorAll('.mode-card').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchMode(btn.dataset.mode);
      });
    });

    // 4종 광학 비전 필터 전환
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.setOpticalFilter(chip.dataset.filter);
      });
    });

    // 민감도(Sensitivity) 세그먼트
    document.querySelectorAll('[data-sens]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-sens]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.sensitivity = btn.dataset.sens;
      });
    });

    // 광학/디지털 줌 세그먼트
    document.querySelectorAll('[data-zoom]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-zoom]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setZoom(parseFloat(btn.dataset.zoom));
      });
    });

    // 뷰포트 터치/클릭 -> 해당 지점 정밀 루페 락온 (Tap-to-Inspect)
    this.viewportStage.addEventListener('pointerdown', (e) => {
      // UI 버튼 클릭은 제외
      if (e.target.closest('button') || e.target.closest('aside') || e.target.closest('header') || e.target.closest('nav') || e.target.closest('.snapshot-toast')) {
        return;
      }
      const rect = this.viewportStage.getBoundingClientRect();
      const nx = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
      this.setPinnedLoupePoint(nx, ny);
    });

    // 루페 배율 전환 (4X <-> 8X)
    this.loupePowerBtn.addEventListener('click', () => {
      this.loupeZoom = this.loupeZoom === 4 ? 8 : 4;
      this.loupePowerBtn.textContent = `${this.loupeZoom}X`;
    });

    // 루페 수동 락온 해제 (AUTO 복귀)
    this.resetPinBtn.addEventListener('click', () => {
      this.clearPinnedLoupePoint();
    });

    // 루페 접기 / 열기
    document.getElementById('closeMagBtn').addEventListener('click', () => {
      this.magCard.classList.add('hidden');
      this.restoreMagBtn.classList.remove('hidden');
    });
    this.restoreMagBtn.addEventListener('click', () => {
      this.magCard.classList.remove('hidden');
      this.restoreMagBtn.classList.add('hidden');
    });

    // 전술 독 액션 버튼들
    document.getElementById('torchBtn').addEventListener('click', () => this.toggleTorch());

    document.getElementById('soundBtn').addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      document.getElementById('soundBtn').classList.toggle('active', this.soundEnabled);
      document.getElementById('soundWavePath').style.opacity = this.soundEnabled ? '1' : '0.2';
    });

    document.getElementById('vibrateBtn').addEventListener('click', () => {
      this.vibrateEnabled = !this.vibrateEnabled;
      document.getElementById('vibrateBtn').classList.toggle('active', this.vibrateEnabled);
    });

    document.getElementById('switchCamBtn').addEventListener('click', () => this.switchCamera());
    document.getElementById('snapshotBtn').addEventListener('click', () => this.takeSnapshot());

    document.getElementById('closeSnapToast').addEventListener('click', () => {
      document.getElementById('snapshotToast').classList.add('hidden');
    });

    window.addEventListener('resize', () => this.handleResize());
  }

  // -------------------------------------------------------------
  // 터치 지점 루페 고정 (Pinpoint Lock)
  // -------------------------------------------------------------
  setPinnedLoupePoint(nx, ny) {
    this.pinnedPoint = { x: nx, y: ny };
    this.loupeModeBadge.textContent = 'LOCK';
    this.loupeModeBadge.classList.add('pinned');
    this.resetPinBtn.classList.remove('hidden');
    this.magCard.classList.remove('hidden');
    this.restoreMagBtn.classList.add('hidden');
    this.reticleHint.textContent = '지점 고정됨 (우측 루페에서 AUTO 클릭 시 해제)';
    this.updateMagnifier(nx * this.procWidth, ny * this.procHeight, 'PINPOINT LOCK');
  }

  clearPinnedLoupePoint() {
    this.pinnedPoint = null;
    this.loupeModeBadge.textContent = 'AUTO';
    this.loupeModeBadge.classList.remove('pinned');
    this.resetPinBtn.classList.add('hidden');
    this.reticleHint.textContent = '화면을 터치하면 해당 지점을 정밀 확대합니다';
  }

  // -------------------------------------------------------------
  // Argon 소나 오디오 합성기 & 햅틱
  // -------------------------------------------------------------
  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playArgonSonarPing(confidence = 0.8) {
    if (!this.soundEnabled || !this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      // 표적 신뢰도에 따라 주파수 피치 변조 (1100Hz ~ 1950Hz)
      const baseFreq = 1100 + Math.min(1, confidence) * 650;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + 0.09);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + 0.12);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch (e) {
      // 오디오 컨텍스트 제한 시 무시
    }
  }

  triggerHaptic() {
    if (!this.vibrateEnabled || !navigator.vibrate) return;
    try {
      navigator.vibrate([45, 30, 65]);
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // 카메라 스트림 & 시뮬레이션 데모 관리
  // -------------------------------------------------------------
  async startCamera() {
    this.updateStatus('INITIALIZING OPTICS...', 'normal');
    this.isSimulation = false;

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.startSimulationMode();
      return;
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: this.currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();

      this.handleResize();
      this.updateStatus('OPTICS ONLINE // SCANNING', 'active');
      this.applyHardwareZoom(this.currentZoom);
    } catch (err) {
      console.warn('Camera fallback to simulation:', err);
      this.startSimulationMode();
    }
  }

  startSimulationMode() {
    this.isSimulation = true;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.updateStatus('SIMULATION MODE // DEMO', 'active');
  }

  switchCamera() {
    if (this.isSimulation) {
      // 시뮬레이션 중이면 실제 카메라 재시도
      this.startCamera();
      return;
    }
    this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    this.startCamera();
  }

  async toggleTorch() {
    if (!this.stream) {
      // 시뮬레이션 또는 스트림 없을 때는 야간 증폭 필터로 자동 토글 보조
      const nextFilter = this.currentFilter === 'night' ? 'standard' : 'night';
      document.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.filter === nextFilter);
      });
      this.setOpticalFilter(nextFilter);
      document.getElementById('torchBtn').classList.toggle('active', nextFilter === 'night');
      return;
    }

    const track = this.stream.getVideoTracks()[0];
    if (!track) return;

    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) {
        this.isTorchOn = !this.isTorchOn;
        await track.applyConstraints({
          advanced: [{ torch: this.isTorchOn }]
        });
        document.getElementById('torchBtn').classList.toggle('active', this.isTorchOn);
      } else {
        // 하드웨어 토치 미지원 기기는 야간 조도 증폭(Night Amplifier) 모드로 스마트 폴백
        this.isTorchOn = !this.isTorchOn;
        const targetFilter = this.isTorchOn ? 'night' : 'standard';
        document.querySelectorAll('.filter-chip').forEach(c => {
          c.classList.toggle('active', c.dataset.filter === targetFilter);
        });
        this.setOpticalFilter(targetFilter);
        document.getElementById('torchBtn').classList.toggle('active', this.isTorchOn);
      }
    } catch (e) {
      console.warn('Torch fallback:', e);
    }
  }

  setOpticalFilter(filterName) {
    this.currentFilter = filterName;
    this.video.className = `filter-${filterName}`;
  }

  setZoom(factor) {
    this.currentZoom = factor;
    this.applyHardwareZoom(factor);
    this.video.style.transform = `scale(${factor})`;
  }

  async applyHardwareZoom(factor) {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;
    try {
      const caps = track.getCapabilities();
      if (caps.zoom) {
        const z = Math.min(Math.max(factor, caps.zoom.min), caps.zoom.max);
        await track.applyConstraints({ advanced: [{ zoom: z }] });
      }
    } catch (e) {}
  }

  handleResize() {
    const rect = this.viewportStage.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.overlayCanvas.width = Math.floor(w * this.dpr);
    this.overlayCanvas.height = Math.floor(h * this.dpr);
    this.overlayCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cssWidth = w;
    this.cssHeight = h;
  }

  // -------------------------------------------------------------
  // 모드 & 스캔 상태 제어
  // -------------------------------------------------------------
  switchMode(mode) {
    this.currentMode = mode;
    document.querySelectorAll('.mode-card').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    if (mode === 'flight') {
      this.reticle.style.opacity = '0.42';
    } else if (mode === 'spot') {
      this.reticle.style.opacity = '0.95';
      this.magCard.classList.remove('hidden');
      this.restoreMagBtn.classList.add('hidden');
    } else if (mode === 'trail') {
      this.reticle.style.opacity = '0.3';
    }

    this.recentTrails = [];
    this.heatmapPoints = [];
    this.detectedTargets = [];
  }

  toggleScanning(enable) {
    this.isScanning = enable;
    const btn = document.getElementById('startScanBtn');
    const txt = document.getElementById('scanBtnText');
    const svg = document.getElementById('scanSvgIcon');

    if (this.isScanning) {
      btn.classList.add('scanning');
      txt.textContent = 'STOP';
      svg.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"/>';
      this.scanlineSweep.classList.add('scanning');
      this.updateStatus(this.isSimulation ? 'SIMULATION // ACTIVE' : 'ARGON SCAN // ACTIVE', 'active');
      this.requestLoop();
    } else {
      btn.classList.remove('scanning');
      txt.textContent = 'SCAN';
      svg.innerHTML = '<polygon points="7 5 19 12 7 19 7 5"/>';
      this.scanlineSweep.classList.remove('scanning');
      this.updateStatus('SCAN PAUSED', 'normal');
      this.clearOverlay();
    }
  }

  updateStatus(text, state = 'normal') {
    this.statusText.textContent = text;
    this.statusBadge.className = 'argon-status-pill';
    if (state === 'active') this.statusBadge.classList.add('active');
    if (state === 'alert') this.statusBadge.classList.add('alert');
  }

  // -------------------------------------------------------------
  // 메인 비전 프레임 루프
  // -------------------------------------------------------------
  requestLoop() {
    if (!this.isScanning) return;
    this.processFrame();
    requestAnimationFrame(() => this.requestLoop());
  }

  renderSimulationFrame() {
    const ctx = this.simCtx;
    const w = this.simCanvas.width;
    const h = this.simCanvas.height;
    const now = performance.now() * 0.001;

    // 벽지 질감 그라데이션 배경 생성
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.4, 30, w * 0.5, h * 0.5, w * 0.75);
    grad.addColorStop(0, '#cbd5e1');
    grad.addColorStop(1, '#64748b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 미세한 벽지 격자 노이즈 패턴
    ctx.fillStyle = 'rgba(15, 23, 42, 0.04)';
    for (let y = 0; y < h; y += 16) {
      ctx.fillRect(0, y, w, 1);
    }

    // 가상 모기 업데이트 및 그리기
    for (const bug of this.simBugs) {
      if (bug.flying) {
        // 불규칙 비행 가속도 변조
        bug.vx += Math.sin(now * 6.5 + bug.phase) * 0.0005;
        bug.vy += Math.cos(now * 5.2 + bug.phase) * 0.0005;
        // 속도 제한
        const speed = Math.hypot(bug.vx, bug.vy);
        if (speed > 0.008) {
          bug.vx = (bug.vx / speed) * 0.008;
          bug.vy = (bug.vy / speed) * 0.008;
        }
        bug.x += bug.vx;
        bug.y += bug.vy;

        if (bug.x < 0.12 || bug.x > 0.88) bug.vx *= -1;
        if (bug.y < 0.15 || bug.y > 0.85) bug.vy *= -1;
      }

      const bx = bug.x * w;
      const by = bug.y * h;

      // 모기 다리 및 날개 실루엣 렌더링 (루페 확대 시 실제 모기처럼 보이도록 정교하게 표현)
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(bug.flying ? Math.atan2(bug.vy, bug.vx) : 0.4);

      // 다리 6개
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, -3); ctx.lineTo(4, 3);
      ctx.moveTo(-4, 3);  ctx.lineTo(4, -3);
      ctx.moveTo(0, -4.5); ctx.lineTo(0, 4.5);
      ctx.stroke();

      // 몸통
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.ellipse(0, 0, bug.size * 1.2, bug.size * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  processFrame() {
    // FPS 업데이트
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      const fps = Math.min(60, Math.round((this.frameCount * 1000) / (now - this.lastFpsTime)));
      this.fpsCounter.textContent = fps;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    if (this.isSimulation) {
      this.renderSimulationFrame();
      this.procCtx.drawImage(this.simCanvas, 0, 0, this.procWidth, this.procHeight);
    } else {
      if (this.video.readyState < 2) return;
      this.procCtx.drawImage(this.video, 0, 0, this.procWidth, this.procHeight);
    }

    const frameData = this.procCtx.getImageData(0, 0, this.procWidth, this.procHeight);

    if (this.currentMode === 'flight') {
      this.analyzeFlightAndTrail(frameData, false);
    } else if (this.currentMode === 'trail') {
      this.analyzeFlightAndTrail(frameData, true);
    } else {
      this.analyzeStaticMicroSpots(frameData);
    }

    // 수동 고정 루페가 활성화되어 있으면 매 프레임 해당 지점 실시간 갱신
    if (this.pinnedPoint) {
      this.updateMagnifier(
        this.pinnedPoint.x * this.procWidth,
        this.pinnedPoint.y * this.procHeight,
        'PINPOINT LOCK'
      );
    }

    this.renderArgonHUD();
  }

  // -------------------------------------------------------------
  // 알고리즘 1 & 3: 비행 레이더 (KINETIC) & 잔상 누적 히트맵 (TRAIL)
  // -------------------------------------------------------------
  analyzeFlightAndTrail(currentFrame, accumulateHeatmap = false) {
    const rgba = currentFrame.data;
    const w = this.procWidth;
    const h = this.procHeight;
    const totalPixels = w * h;

    const curGray = new Uint8Array(totalPixels);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      curGray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    }

    if (!this.prevGrayBuffer || !this.bgFloatBuffer) {
      this.prevGrayBuffer = curGray;
      this.bgFloatBuffer = new Float32Array(curGray);
      return;
    }

    // 감도 파라미터 매핑 (4단계)
    const sensMap = {
      low:   { thresh: 34, minBox: 2, maxBox: 22 },
      mid:   { thresh: 25, minBox: 2, maxBox: 28 },
      high:  { thresh: 18, minBox: 1, maxBox: 32 },
      ultra: { thresh: 12, minBox: 1, maxBox: 36 }
    };
    const cfg = sensMap[this.sensitivity] || sensMap.mid;

    const step = 2;
    const diffPoints = [];
    let activeMotionPixels = 0;

    for (let y = 2; y < h - 2; y += step) {
      for (let x = 2; x < w - 2; x += step) {
        const idx = y * w + x;
        const g = curGray[idx];
        const prevG = this.prevGrayBuffer[idx];
        const bgG = this.bgFloatBuffer[idx];

        // 인접 프레임 차분과 EMA 배경 차분 결합
        const frameDiff = Math.abs(g - prevG);
        const bgDiff = Math.abs(g - bgG);
        const combinedDiff = Math.max(frameDiff, bgDiff * 0.85);

        // 배경 버퍼 서서히 업데이트
        this.bgFloatBuffer[idx] = bgG * 0.88 + g * 0.12;

        if (combinedDiff > cfg.thresh) {
          activeMotionPixels++;
          diffPoints.push({ x, y, strength: combinedDiff });
        }
      }
    }

    const sampledTotal = ((w - 4) / step) * ((h - 4) / step);
    const motionRatio = activeMotionPixels / sampledTotal;

    // 카메라 손떨림 안정도 점수 산출 (0 ~ 100%)
    this.stabilityScore = Math.max(0, Math.min(100, Math.round((1 - motionRatio * 6.5) * 100)));
    this.updateStabilityMeter(this.stabilityScore);

    const prevTargets = [...this.detectedTargets];
    this.detectedTargets = [];
    const now = performance.now();

    // 전역 흔들림이 13% 미만일 때만 미세 비행 곤충으로 인정 (손떨림 오탐 원천 차단)
    if (motionRatio < 0.13 && diffPoints.length > 0) {
      const clusters = this.clusterPoints(diffPoints, 16);

      for (const cl of clusters) {
        const bw = cl.maxX - cl.minX + step;
        const bh = cl.maxY - cl.minY + step;

        if (bw >= cfg.minBox && bw <= cfg.maxBox && bh >= cfg.minBox && bh <= cfg.maxBox) {
          const cx = ((cl.minX + cl.maxX) * 0.5) / w;
          const cy = ((cl.minY + cl.maxY) * 0.5) / h;

          // 이전 프레임 표적과 매칭하여 속도 벡터(vx, vy) 계산
          let vx = 0;
          let vy = 0;
          let bestDist = 0.12;
          for (const pt of prevTargets) {
            const d = Math.hypot(cx - pt.x, cy - pt.y);
            if (d < bestDist && d > 0.001) {
              bestDist = d;
              vx = cx - pt.x;
              vy = cy - pt.y;
            }
          }

          const conf = Math.min(0.99, 0.55 + (cl.points.length / 18) * 0.44);

          this.detectedTargets.push({
            x: cx,
            y: cy,
            w: bw / w,
            h: bh / h,
            vx,
            vy,
            type: 'kinetic',
            confidence: conf
          });

          this.recentTrails.push({ x: cx, y: cy, timestamp: now });

          if (accumulateHeatmap) {
            this.heatmapPoints.push({
              x: cx,
              y: cy,
              intensity: Math.min(1, cl.points.length / 10),
              timestamp: now
            });
          }
        }
      }
    }

    // 포착된 비행 표적이 있고 수동 루페 고정 상태가 아니면 1순위 표적을 루페로 자동 추적
    if (this.detectedTargets.length > 0 && !this.pinnedPoint) {
      const primary = this.detectedTargets[0];
      this.updateMagnifier(
        primary.x * w,
        primary.y * h,
        `KINETIC ${Math.round(primary.confidence * 100)}%`
      );
    }

    // 궤적 및 히트맵 수명 관리
    this.recentTrails = this.recentTrails.filter(t => now - t.timestamp < 2000);
    this.heatmapPoints = this.heatmapPoints.filter(hPt => now - hPt.timestamp < 8000);

    this.prevGrayBuffer = curGray;
    this.evaluateTacticalAlarm();
  }

  updateStabilityMeter(score) {
    this.stabBarFill.style.width = `${score}%`;
    if (score >= 70) {
      this.stabBarFill.style.backgroundColor = '#00ff9d';
    } else if (score >= 40) {
      this.stabBarFill.style.backgroundColor = '#ffb800';
    } else {
      this.stabBarFill.style.backgroundColor = '#ff2a6d';
    }
  }

  clusterPoints(points, radius) {
    const clusters = [];
    const visited = new Uint8Array(points.length);

    for (let i = 0; i < points.length; i++) {
      if (visited[i]) continue;
      visited[i] = 1;

      const cl = {
        minX: points[i].x,
        maxX: points[i].x,
        minY: points[i].y,
        maxY: points[i].y,
        points: [points[i]]
      };

      const stack = [points[i]];
      while (stack.length > 0) {
        const p = stack.pop();
        for (let j = 0; j < points.length; j++) {
          if (!visited[j]) {
            const q = points[j];
            if (Math.abs(p.x - q.x) <= radius && Math.abs(p.y - q.y) <= radius) {
              visited[j] = 1;
              stack.push(q);
              cl.points.push(q);
              if (q.x < cl.minX) cl.minX = q.x;
              if (q.x > cl.maxX) cl.maxX = q.x;
              if (q.y < cl.minY) cl.minY = q.y;
              if (q.y > cl.maxY) cl.maxY = q.y;
            }
          }
        }
      }
      clusters.push(cl);
    }
    return clusters;
  }

  // -------------------------------------------------------------
  // 알고리즘 2: 벽면 정지 미세 암점 탐지 (MICRO-SPOT)
  // -------------------------------------------------------------
  analyzeStaticMicroSpots(currentFrame) {
    const rgba = currentFrame.data;
    const w = this.procWidth;
    const h = this.procHeight;

    // 중앙 레티클 관심 영역 (ROI: 중앙 56% 영역 집중 스캔)
    const startX = Math.floor(w * 0.22);
    const endX = Math.floor(w * 0.78);
    const startY = Math.floor(h * 0.22);
    const endY = Math.floor(h * 0.78);

    const threshMap = { low: 46, mid: 33, high: 23, ultra: 15 };
    const contrastThresh = threshMap[this.sensitivity] || 33;

    const candidates = [];
    const step = 3;
    const ringRadius = 6;

    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        const idx = (y * w + x) * 4;
        const centerLum = (rgba[idx] * 77 + rgba[idx + 1] * 150 + rgba[idx + 2] * 29) >> 8;

        // 주변 8방향 링 샘플링으로 고립된 작은 어두운 점(모기)인지 판별
        const offsets = [
          [-ringRadius, 0], [ringRadius, 0], [0, -ringRadius], [0, ringRadius],
          [-ringRadius, -ringRadius], [ringRadius, -ringRadius],
          [-ringRadius, ringRadius], [ringRadius, ringRadius]
        ];

        let surroundSum = 0;
        let minSurround = 255;
        for (let k = 0; k < offsets.length; k++) {
          const nx = x + offsets[k][0];
          const ny = y + offsets[k][1];
          const nIdx = (ny * w + nx) * 4;
          const nLum = (rgba[nIdx] * 77 + rgba[nIdx + 1] * 150 + rgba[nIdx + 2] * 29) >> 8;
          surroundSum += nLum;
          if (nLum < minSurround) minSurround = nLum;
        }

        const avgSurround = surroundSum / 8;
        const delta = avgSurround - centerLum;

        // 중심점이 주변 평균보다 뚜렷하게 어둡고, 긴 선(벽지 모서리)이 아닌 점 형태일 때
        if (delta > contrastThresh && (minSurround - centerLum) > contrastThresh * 0.45) {
          candidates.push({ x, y, delta });
        }
      }
    }

    // 대비율(Delta) 순으로 내림차순 정렬 후 인접 중복 제거 (Non-Maximum Suppression)
    candidates.sort((a, b) => b.delta - a.delta);
    const selected = [];
    for (const c of candidates) {
      const tooClose = selected.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 18);
      if (!tooClose) {
        selected.push(c);
        if (selected.length >= 3) break; // 상위 3개 표적 락온
      }
    }

    this.detectedTargets = selected.map((s, idx) => ({
      x: s.x / w,
      y: s.y / h,
      w: 0.045,
      h: 0.045,
      type: 'spot',
      rank: idx + 1,
      contrast: Math.round(s.delta),
      confidence: Math.min(0.99, s.delta / 80)
    }));

    this.updateStabilityMeter(96);

    if (this.detectedTargets.length > 0 && !this.pinnedPoint) {
      const best = selected[0];
      this.updateMagnifier(best.x, best.y, `Δ CONTRAST +${Math.round(best.delta)}`);
    }

    this.evaluateTacticalAlarm();
  }

  // -------------------------------------------------------------
  // 정밀 광학 루페(Magnifier) 렌더링 (4x / 8x 지원)
  // -------------------------------------------------------------
  updateMagnifier(procX, procY, captionText) {
    if (!this.magCanvas) return;
    const mw = this.magCanvas.width;
    const mh = this.magCanvas.height;

    // 4X일 때는 36px 영역, 8X일 때는 18px 영역 크롭
    const cropSize = this.loupeZoom === 8 ? 18 : 36;
    const sx = Math.max(0, Math.min(this.procWidth - cropSize, procX - cropSize * 0.5));
    const sy = Math.max(0, Math.min(this.procHeight - cropSize, procY - cropSize * 0.5));

    this.magCtx.clearRect(0, 0, mw, mh);
    this.magCtx.imageSmoothingEnabled = false;

    const sourceElem = this.isSimulation ? this.simCanvas : this.procCanvas;
    const scaleX = sourceElem.width / this.procWidth;
    const scaleY = sourceElem.height / this.procHeight;

    this.magCtx.drawImage(
      sourceElem,
      sx * scaleX,
      sy * scaleY,
      cropSize * scaleX,
      cropSize * scaleY,
      0, 0, mw, mh
    );

    // Argon 루페 정밀 분석 링 오버레이
    this.magCtx.strokeStyle = this.pinnedPoint ? 'rgba(139, 92, 246, 0.8)' : 'rgba(0, 240, 255, 0.75)';
    this.magCtx.lineWidth = 1.5;
    this.magCtx.beginPath();
    this.magCtx.arc(mw * 0.5, mh * 0.5, 22, 0, Math.PI * 2);
    this.magCtx.stroke();

    if (captionText) {
      this.magCaption.textContent = captionText;
    }
    this.loupeCoord.textContent = `X:${Math.round(procX)} Y:${Math.round(procY)}`;
  }

  // -------------------------------------------------------------
  // 타겟 알람 & 텔레메트리 평가
  // -------------------------------------------------------------
  evaluateTacticalAlarm() {
    const count = this.detectedTargets.length;
    this.targetCount.textContent = count < 10 ? `0${count}` : `${count}`;
    this.targetPill.classList.toggle('locked', count > 0);

    const now = performance.now();
    if (count > 0) {
      this.statusBadge.className = 'argon-status-pill alert';
      this.statusText.textContent = `TARGET LOCKED (${count})`;
      this.alarmBanner.classList.add('show');

      if (this.currentMode === 'spot') {
        this.alarmTitle.textContent = `MICRO-SPOT LOCKED // 정지 표적 ${count}개`;
        this.alarmSub.textContent = '우측 하단 광학 루페로 확대 영상을 확인하세요';
      } else {
        this.alarmTitle.textContent = `KINETIC TARGET // 비행 모기 포착`;
        this.alarmSub.textContent = '이동 궤적 및 예상 진행 벡터를 추적 중입니다';
      }

      if (now - this.lastAlarmTime > 420) {
        const topConf = this.detectedTargets[0]?.confidence || 0.8;
        this.playArgonSonarPing(topConf);
        this.triggerHaptic();
        this.lastAlarmTime = now;
      }
    } else {
      this.statusBadge.className = 'argon-status-pill active';
      if (this.stabilityScore < 45) {
        this.statusText.textContent = 'STABILIZING CAMERA...';
      } else {
        this.statusText.textContent = this.isSimulation ? 'SIMULATION // SCANNING' : 'OPTICS ONLINE // SCANNING';
      }
      this.alarmBanner.classList.remove('show');
    }
  }

  // -------------------------------------------------------------
  // ARGON 전술 HUD 오버레이 렌더링
  // -------------------------------------------------------------
  renderArgonHUD() {
    const ctx = this.overlayCtx;
    const w = this.cssWidth || this.overlayCanvas.width;
    const h = this.cssHeight || this.overlayCanvas.height;
    const now = performance.now();

    ctx.clearRect(0, 0, w, h);

    // 시뮬레이션 모드일 때는 배경 비디오 대신 가상 캔버스를 화면에 렌더링
    if (this.isSimulation) {
      ctx.save();
      ctx.drawImage(this.simCanvas, 0, 0, w, h);
      ctx.restore();
    }

    // 1. [TRAIL-MAP 모드] 장노출 모션 히트맵 렌더링
    if (this.currentMode === 'trail' && this.heatmapPoints.length > 0) {
      for (const pt of this.heatmapPoints) {
        const age = now - pt.timestamp;
        const life = Math.max(0, 1 - age / 8000);
        const hx = pt.x * w;
        const hy = pt.y * h;
        const rad = 18 + pt.intensity * 16;

        const grad = ctx.createRadialGradient(hx, hy, 2, hx, hy, rad);
        grad.addColorStop(0, `rgba(255, 42, 109, ${life * 0.65})`);
        grad.addColorStop(0.5, `rgba(139, 92, 246, ${life * 0.38})`);
        grad.addColorStop(1, 'rgba(0, 240, 255, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(hx, hy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. 비행 궤적 네온 플라즈마 라인 렌더링
    if ((this.currentMode === 'flight' || this.currentMode === 'trail') && this.recentTrails.length > 1) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 1; i < this.recentTrails.length; i++) {
        const p1 = this.recentTrails[i - 1];
        const p2 = this.recentTrails[i];
        // 너무 멀리 점프한 별개 표적 간 연결 방지
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 0.2) continue;

        const age = now - p2.timestamp;
        const alpha = Math.max(0, 1 - age / 2000);

        ctx.strokeStyle = `rgba(0, 240, 255, ${alpha * 0.85})`;
        ctx.lineWidth = 2.5 * alpha + 1;
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }
    }

    // 3. 포착된 표적(Targets) 전술 락온 브라켓 & 속도 벡터 렌더링
    this.detectedTargets.forEach((t, idx) => {
      const tx = t.x * w;
      const ty = t.y * h;
      const r = Math.max(20, Math.min(44, t.w * w * 1.4));
      const isKinetic = t.type === 'kinetic';
      const mainColor = isKinetic ? '#ff2a6d' : '#00f0ff';

      ctx.save();
      ctx.strokeStyle = mainColor;
      ctx.fillStyle = mainColor;
      ctx.lineWidth = 1.8;

      // 외곽 코너 락온 박스 (Argon Tactical Bracket)
      const cLen = r * 0.45;
      ctx.beginPath();
      // 좌상
      ctx.moveTo(tx - r, ty - r + cLen); ctx.lineTo(tx - r, ty - r); ctx.lineTo(tx - r + cLen, ty - r);
      // 우상
      ctx.moveTo(tx + r - cLen, ty - r); ctx.lineTo(tx + r, ty - r); ctx.lineTo(tx + r, ty - r + cLen);
      // 좌하
      ctx.moveTo(tx - r, ty + r - cLen); ctx.lineTo(tx - r, ty + r); ctx.lineTo(tx - r + cLen, ty + r);
      // 우하
      ctx.moveTo(tx + r - cLen, ty + r); ctx.lineTo(tx + r, ty + r); ctx.lineTo(tx + r, ty + r - cLen);
      ctx.stroke();

      // 내부 회전/펄스 원
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = isKinetic ? 'rgba(255, 42, 109, 0.55)' : 'rgba(0, 240, 255, 0.55)';
      ctx.stroke();

      // 비행 속도 벡터 화살표 (예상 이동 방향 표시)
      if (isKinetic && (Math.abs(t.vx) > 0.001 || Math.abs(t.vy) > 0.001)) {
        const vxPx = t.vx * w * 5.5;
        const vyPx = t.vy * h * 5.5;
        ctx.strokeStyle = '#00ff9d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + vxPx, ty + vyPx);
        ctx.stroke();

        ctx.fillStyle = '#00ff9d';
        ctx.beginPath();
        ctx.arc(tx + vxPx, ty + vyPx, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 전술 데이터 태그 라벨
      ctx.font = '700 10px "JetBrains Mono", monospace';
      const tagCode = isKinetic
        ? `TGT-0${idx + 1} // FLY ${Math.round(t.confidence * 100)}%`
        : `TGT-0${idx + 1} // Δ${t.contrast}`;

      const textWidth = ctx.measureText(tagCode).width;
      ctx.fillStyle = 'rgba(5, 7, 12, 0.82)';
      ctx.fillRect(tx + r + 5, ty - 14, textWidth + 10, 18);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + r + 5, ty - 14, textWidth + 10, 18);

      ctx.fillStyle = '#f8fafc';
      ctx.fillText(tagCode, tx + r + 10, ty - 2);
      ctx.restore();
    });

    // 4. 사용자 터치 고정 지점(Pinpoint Lock) 마커 렌더링
    if (this.pinnedPoint) {
      const px = this.pinnedPoint.x * w;
      const py = this.pinnedPoint.y * h;

      ctx.save();
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px - 22, py); ctx.lineTo(px + 22, py);
      ctx.moveTo(px, py - 22); ctx.lineTo(px, py + 22);
      ctx.stroke();

      ctx.fillStyle = '#c4b5fd';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillText('LOUPE LOCK', px + 20, py - 6);
      ctx.restore();
    }
  }

  clearOverlay() {
    const w = this.cssWidth || this.overlayCanvas.width;
    const h = this.cssHeight || this.overlayCanvas.height;
    this.overlayCtx.clearRect(0, 0, w, h);
    this.targetCount.textContent = '00';
    this.targetPill.classList.remove('locked');
    this.alarmBanner.classList.remove('show');
  }

  // -------------------------------------------------------------
  // 고해상도 스냅샷 캡처 & 미니 프리뷰 토스트
  // -------------------------------------------------------------
  takeSnapshot() {
    const snapCanvas = document.createElement('canvas');
    const sw = this.isSimulation ? this.simCanvas.width : (this.video.videoWidth || 1280);
    const sh = this.isSimulation ? this.simCanvas.height : (this.video.videoHeight || 720);
    snapCanvas.width = sw;
    snapCanvas.height = sh;
    const ctx = snapCanvas.getContext('2d');

    // 1. 광학 필터 적용 후 비디오/시뮬레이션 원본 그리기
    const filterCss = getComputedStyle(this.video).filter;
    if (filterCss && filterCss !== 'none') {
      ctx.filter = filterCss;
    }
    if (this.isSimulation) {
      ctx.drawImage(this.simCanvas, 0, 0, sw, sh);
    } else {
      ctx.drawImage(this.video, 0, 0, sw, sh);
    }
    ctx.filter = 'none';

    // 2. HUD 오버레이 합성
    ctx.drawImage(this.overlayCanvas, 0, 0, sw, sh);

    // 3. Argon 텔레메트리 워터마크 바
    ctx.fillStyle = 'rgba(5, 7, 12, 0.78)';
    ctx.fillRect(0, sh - 42, sw, 42);
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 15px monospace';
    const stamp = new Date().toLocaleString('ko-KR');
    ctx.fillText(
      `ARGON OPTICS [Ar-18] // MODE: ${this.currentMode.toUpperCase()} // FILTER: ${this.currentFilter.toUpperCase()} // ${stamp}`,
      18,
      sh - 16
    );

    const dataUrl = snapCanvas.toDataURL('image/png');

    // 인앱 프리뷰 토스트 표시
    const toast = document.getElementById('snapshotToast');
    const thumb = document.getElementById('snapshotThumb');
    const dlLink = document.getElementById('snapshotDownloadLink');
    const fileName = `argon_scan_${Date.now()}.png`;

    thumb.src = dataUrl;
    dlLink.href = dataUrl;
    dlLink.download = fileName;
    toast.classList.remove('hidden');

    // 자동 다운로드 트리거
    const tempLink = document.createElement('a');
    tempLink.download = fileName;
    tempLink.href = dataUrl;
    tempLink.click();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.argonScanner = new ArgonBugScanner();
});
