/**
 * BugFinder AI - Core Engine
 * 스마트폰 카메라 기반 모기 및 미세 곤충 실시간 탐지 엔진
 */

class BugFinderApp {
  constructor() {
    // DOM 요소
    this.video = document.getElementById('cameraVideo');
    this.overlayCanvas = document.getElementById('detectionCanvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    
    this.magCanvas = document.getElementById('magnifierCanvas');
    this.magCtx = this.magCanvas.getContext('2d');
    this.magCard = document.getElementById('magnifierCard');
    
    // HUD 요소
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.fpsCounter = document.getElementById('fpsCounter');
    this.targetCount = document.getElementById('targetCount');
    this.alarmBanner = document.getElementById('alarmBanner');
    this.reticle = document.getElementById('reticle');

    // 오프스크린 분석 캔버스 (성능 최적화용)
    this.procCanvas = document.createElement('canvas');
    this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true });
    this.procWidth = 320;
    this.procHeight = 240;
    this.procCanvas.width = this.procWidth;
    this.procCanvas.height = this.procHeight;

    // 상태 플래그 및 설정값
    this.isScanning = false;
    this.stream = null;
    this.currentFacingMode = 'environment'; // 후면 카메라 기본
    this.currentMode = 'flight'; // 'flight' (비행) 또는 'spot' (벽면 점)
    this.sensitivity = 'mid'; // 'low', 'mid', 'high'
    this.currentZoom = 1;
    this.isTorchOn = false;
    this.soundEnabled = true;
    this.vibrateEnabled = true;

    // 오디오 컨텍스트 (알림음 합성용)
    this.audioCtx = null;
    this.lastAlarmTime = 0;

    // 컴퓨터 비전 알고리즘용 상태
    this.prevFrameData = null;
    this.recentTrails = []; // 비행 궤적 추적용
    this.detectedTargets = [];
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();

    // 초기 이벤트 바인딩
    this.initEventListeners();
  }

  // -------------------------------------------------------------
  // 이벤트 리스너 등록
  // -------------------------------------------------------------
  initEventListeners() {
    // 시작 모달 버튼
    document.getElementById('initCamBtn').addEventListener('click', () => {
      document.getElementById('startModal').classList.add('hidden');
      this.initAudioContext();
      this.startCamera().then(() => {
        this.toggleScanning(true);
      });
    });

    // 스캔 토글 버튼
    document.getElementById('startScanBtn').addEventListener('click', () => {
      this.toggleScanning(!this.isScanning);
    });

    // 모드 탭 전환
    document.getElementById('flightModeBtn').addEventListener('click', () => this.switchMode('flight'));
    document.getElementById('spotModeBtn').addEventListener('click', () => this.switchMode('spot'));

    // 민감도 버튼
    document.querySelectorAll('[data-sens]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-sens]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.sensitivity = e.target.dataset.sens;
      });
    });

    // 줌 버튼
    document.querySelectorAll('[data-zoom]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-zoom]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.setZoom(parseFloat(e.target.dataset.zoom));
      });
    });

    // 플래시(토치) 토글
    document.getElementById('torchBtn').addEventListener('click', () => this.toggleTorch());

    // 사운드 토글
    document.getElementById('soundBtn').addEventListener('click', (e) => {
      this.soundEnabled = !this.soundEnabled;
      const btn = document.getElementById('soundBtn');
      btn.classList.toggle('active', this.soundEnabled);
      document.getElementById('soundIcon').textContent = this.soundEnabled ? '🔔' : '🔕';
    });

    // 진동 토글
    document.getElementById('vibrateBtn').addEventListener('click', (e) => {
      this.vibrateEnabled = !this.vibrateEnabled;
      const btn = document.getElementById('vibrateBtn');
      btn.classList.toggle('active', this.vibrateEnabled);
      document.getElementById('vibrateIcon').textContent = this.vibrateEnabled ? '📳' : '📴';
    });

    // 카메라 전환
    document.getElementById('switchCamBtn').addEventListener('click', () => this.switchCamera());

    // 스냅샷 캡처
    document.getElementById('snapshotBtn').addEventListener('click', () => this.takeSnapshot());

    // 확대경 닫기
    document.getElementById('closeMagBtn').addEventListener('click', () => {
      this.magCard.style.display = 'none';
    });

    // 리사이즈 핸들러
    window.addEventListener('resize', () => this.handleResize());
  }

  // -------------------------------------------------------------
  // Web Audio 알림음 합성
  // -------------------------------------------------------------
  initAudioContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playTargetTone() {
    if (!this.soundEnabled || !this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12); // 급상승 타겟 톤

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  triggerHaptic() {
    if (!this.vibrateEnabled || !navigator.vibrate) return;
    try {
      navigator.vibrate([60, 40, 60]);
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // 카메라 초기화 및 스트림 설정
  // -------------------------------------------------------------
  async startCamera() {
    this.updateStatus('카메라 연결 중...', 'normal');
    
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
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
      this.updateStatus('카메라 활성화됨', 'active');
      this.applyHardwareZoom(this.currentZoom);
    } catch (err) {
      console.error('Camera error:', err);
      this.updateStatus('카메라 권한 필요', 'alert');
      alert('카메라 접근 권한이 필요합니다. 브라우저 설정에서 카메라 권한을 허용해 주세요.');
    }
  }

  switchCamera() {
    this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    this.startCamera();
  }

  async toggleTorch() {
    if (!this.stream) return;
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
        alert('이 기기는 플래시(Torch) API를 지원하지 않습니다.');
      }
    } catch (e) {
      console.warn('Torch control error:', e);
      alert('플래시 제어 중 오류가 발생했습니다.');
    }
  }

  setZoom(zoomFactor) {
    this.currentZoom = zoomFactor;
    // 하드웨어 줌 시도, 미지원 시 CSS 캔버스 디지털 줌 적용
    this.applyHardwareZoom(zoomFactor);
    this.video.style.transform = `scale(${zoomFactor})`;
  }

  async applyHardwareZoom(factor) {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;

    try {
      const caps = track.getCapabilities();
      if (caps.zoom) {
        const targetZoom = Math.min(Math.max(factor, caps.zoom.min), caps.zoom.max);
        await track.applyConstraints({
          advanced: [{ zoom: targetZoom }]
        });
      }
    } catch (e) {
      // 무시 (소프트웨어 CSS 스케일로 커버)
    }
  }

  handleResize() {
    const rect = this.video.getBoundingClientRect();
    this.overlayCanvas.width = rect.width || window.innerWidth;
    this.overlayCanvas.height = rect.height || window.innerHeight;
  }

  // -------------------------------------------------------------
  // 모드 및 상태 제어
  // -------------------------------------------------------------
  switchMode(mode) {
    this.currentMode = mode;
    document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
    if (mode === 'flight') {
      document.getElementById('flightModeBtn').classList.add('active');
      this.reticle.style.opacity = '0.3';
    } else {
      document.getElementById('spotModeBtn').classList.add('active');
      this.reticle.style.opacity = '0.85';
      this.magCard.style.display = 'flex';
    }
    this.recentTrails = [];
    this.detectedTargets = [];
  }

  toggleScanning(enable) {
    this.isScanning = enable;
    const btn = document.getElementById('startScanBtn');
    const icon = document.getElementById('scanBtnIcon');
    const txt = document.getElementById('scanBtnText');

    if (this.isScanning) {
      btn.classList.add('scanning');
      icon.textContent = '⏹';
      txt.textContent = '탐지 중지';
      this.updateStatus('벌레 탐색 중...', 'active');
      this.requestFrameLoop();
    } else {
      btn.classList.remove('scanning');
      icon.textContent = '▶';
      txt.textContent = '탐지 시작';
      this.updateStatus('탐지 일시정지', 'normal');
      this.clearOverlay();
    }
  }

  updateStatus(text, state = 'normal') {
    this.statusText.textContent = text;
    this.statusBadge.className = 'status-badge ' + (state === 'active' ? 'active' : state === 'alert' ? 'alert' : '');
  }

  // -------------------------------------------------------------
  // 메인 프로세싱 루프
  // -------------------------------------------------------------
  requestFrameLoop() {
    if (!this.isScanning) return;
    this.processFrame();
    requestAnimationFrame(() => this.requestFrameLoop());
  }

  processFrame() {
    if (this.video.readyState < 2) return;

    // FPS 계산
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.fpsCounter.textContent = `FPS: ${fps}`;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // 오프스크린 캔버스에 비디오 프레임 복사
    this.procCtx.drawImage(this.video, 0, 0, this.procWidth, this.procHeight);
    const frameData = this.procCtx.getImageData(0, 0, this.procWidth, this.procHeight);

    if (this.currentMode === 'flight') {
      this.processFlightMotion(frameData);
    } else {
      this.processStaticSpot(frameData);
    }

    // 결과 렌더링
    this.renderOverlay();
  }

  // -------------------------------------------------------------
  // 알고리즘 1: [비행 모션 탐지] 프레임 차분 & 손떨림 노이즈 필터
  // -------------------------------------------------------------
  processFlightMotion(currentFrame) {
    if (!this.prevFrameData) {
      this.prevFrameData = currentFrame;
      return;
    }

    const cur = currentFrame.data;
    const prev = this.prevFrameData.data;
    const width = this.procWidth;
    const height = this.procHeight;

    // 민감도별 파라미터 매핑
    let diffThreshold = 28;
    let minClusterSize = 2;
    let maxClusterSize = 26; // 너무 크면 벌레가 아님 (손이나 사람)

    if (this.sensitivity === 'high') {
      diffThreshold = 20;
      minClusterSize = 1;
      maxClusterSize = 32;
    } else if (this.sensitivity === 'low') {
      diffThreshold = 36;
      minClusterSize = 3;
      maxClusterSize = 22;
    }

    let changedPixelCount = 0;
    const step = 2; // 성능을 위해 2px 간격 샘플링
    const diffGrid = [];

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = (y * width + x) * 4;
        // 그레이스케일 계산
        const grayCur = (cur[idx] * 299 + cur[idx + 1] * 587 + cur[idx + 2] * 114) / 1000;
        const grayPrev = (prev[idx] * 299 + prev[idx + 1] * 587 + prev[idx + 2] * 114) / 1000;

        const diff = Math.abs(grayCur - grayPrev);
        if (diff > diffThreshold) {
          changedPixelCount++;
          diffGrid.push({ x, y });
        }
      }
    }

    // 전역 움직임(손떨림) 감지: 화면 전체 픽셀의 12% 이상이 변하면 손떨림으로 간주하여 무시
    const totalSampledPixels = (width / step) * (height / step);
    const motionRatio = changedPixelCount / totalSampledPixels;

    this.detectedTargets = [];

    if (motionRatio < 0.12 && changedPixelCount > 0) {
      // 군집화(Clustering) 알고리즘: 인접한 변화 픽셀들을 바운딩 박스로 묶음
      const clusters = this.clusterMotionPoints(diffGrid, 18);

      for (const cl of clusters) {
        const boxWidth = cl.maxX - cl.minX + step;
        const boxHeight = cl.maxY - cl.minY + step;

        // 크기 조건 검사 (작은 곤충/모기 크기 필터링)
        if (boxWidth >= minClusterSize && boxWidth <= maxClusterSize &&
            boxHeight >= minClusterSize && boxHeight <= maxClusterSize) {
          
          const centerX = (cl.minX + cl.maxX) / 2;
          const centerY = (cl.minY + cl.maxY) / 2;

          this.detectedTargets.push({
            x: centerX / width,
            y: centerY / height,
            w: boxWidth / width,
            h: boxHeight / height,
            type: 'flying_bug',
            confidence: Math.min(1.0, cl.points.length / 8)
          });

          // 궤적 포인트 추가
          this.recentTrails.push({
            x: centerX / width,
            y: centerY / height,
            timestamp: performance.now()
          });
        }
      }
    }

    // 궤적 수명 관리 (최근 1.8초간의 궤적만 유지)
    const now = performance.now();
    this.recentTrails = this.recentTrails.filter(t => now - t.timestamp < 1800);

    // 현재 프레임을 이전 프레임으로 백업
    this.prevFrameData = currentFrame;

    this.evaluateAlarm();
  }

  clusterMotionPoints(points, maxDistance) {
    const clusters = [];
    const visited = new Uint8Array(points.length);

    for (let i = 0; i < points.length; i++) {
      if (visited[i]) continue;
      visited[i] = 1;

      const cluster = {
        minX: points[i].x,
        maxX: points[i].x,
        minY: points[i].y,
        maxY: points[i].y,
        points: [points[i]]
      };

      const queue = [points[i]];
      while (queue.length > 0) {
        const p1 = queue.pop();
        for (let j = 0; j < points.length; j++) {
          if (!visited[j]) {
            const p2 = points[j];
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            if (dist <= maxDistance) {
              visited[j] = 1;
              queue.push(p2);
              cluster.points.push(p2);
              if (p2.x < cluster.minX) cluster.minX = p2.x;
              if (p2.x > cluster.maxX) cluster.maxX = p2.x;
              if (p2.y < cluster.minY) cluster.minY = p2.y;
              if (p2.y > cluster.maxY) cluster.maxY = p2.y;
            }
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  // -------------------------------------------------------------
  // 알고리즘 2: [벽면 점 탐지] 국소 대비 및 미세 스팟 검출
  // -------------------------------------------------------------
  processStaticSpot(currentFrame) {
    const cur = currentFrame.data;
    const width = this.procWidth;
    const height = this.procHeight;

    // 중앙 레티클 중심 스캔 영역 설정 (중심 50% 영역)
    const startX = Math.floor(width * 0.25);
    const endX = Math.floor(width * 0.75);
    const startY = Math.floor(height * 0.25);
    const endY = Math.floor(height * 0.75);

    let contrastThreshold = 35;
    if (this.sensitivity === 'high') contrastThreshold = 25;
    else if (this.sensitivity === 'low') contrastThreshold = 50;

    let candidateSpots = [];
    const step = 3;

    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        const idx = (y * width + x) * 4;
        const centerLum = (cur[idx] * 299 + cur[idx + 1] * 587 + cur[idx + 2] * 114) / 1000;

        // 주변 4방향 밝기 샘플링 (반경 6px)
        const radius = 6;
        let surroundLumSum = 0;
        let count = 0;

        const neighbors = [
          { nx: x - radius, ny: y },
          { nx: x + radius, ny: y },
          { nx: x, ny: y - radius },
          { nx: x, ny: y + radius }
        ];

        for (const n of neighbors) {
          if (n.nx >= 0 && n.nx < width && n.ny >= 0 && n.ny < height) {
            const nIdx = (n.ny * width + n.nx) * 4;
            surroundLumSum += (cur[nIdx] * 299 + cur[nIdx + 1] * 587 + cur[nIdx + 2] * 114) / 1000;
            count++;
          }
        }

        const avgSurroundLum = surroundLumSum / count;

        // 점(모기)은 주변 배경보다 확연히 어두움
        const darknessDiff = avgSurroundLum - centerLum;
        if (darknessDiff > contrastThreshold) {
          candidateSpots.push({ x, y, diff: darknessDiff });
        }
      }
    }

    // 가장 뚜렷한 어두운 점 정렬
    candidateSpots.sort((a, b) => b.diff - a.diff);
    this.detectedTargets = [];

    if (candidateSpots.length > 0) {
      const best = candidateSpots[0];
      this.detectedTargets.push({
        x: best.x / width,
        y: best.y / height,
        w: 0.04,
        h: 0.04,
        type: 'static_bug',
        contrast: best.diff
      });

      // 실시간 확대경 캔버스 업데이트
      this.updateMagnifier(best.x, best.y);
    }

    this.evaluateAlarm();
  }

  updateMagnifier(procX, procY) {
    if (!this.magCanvas) return;
    const cropSize = 32; // 오프스크린 기준 잘라낼 영역 크기
    const sx = Math.max(0, Math.min(this.procWidth - cropSize, procX - cropSize / 2));
    const sy = Math.max(0, Math.min(this.procHeight - cropSize, procY - cropSize / 2));

    this.magCtx.clearRect(0, 0, this.magCanvas.width, this.magCanvas.height);
    // 확대 렌더링
    this.magCtx.imageSmoothingEnabled = false; // 픽셀 보존
    this.magCtx.drawImage(
      this.procCanvas,
      sx, sy, cropSize, cropSize,
      0, 0, this.magCanvas.width, this.magCanvas.height
    );

    // 확대경 중앙 십자선
    this.magCtx.strokeStyle = 'rgba(0, 255, 170, 0.7)';
    this.magCtx.lineWidth = 1;
    this.magCtx.strokeRect(this.magCanvas.width / 2 - 8, this.magCanvas.height / 2 - 8, 16, 16);

    document.getElementById('magCaption').textContent = '표적 점 확대 (4x)';
  }

  // -------------------------------------------------------------
  // 알림 및 경보 상태 처리
  // -------------------------------------------------------------
  evaluateAlarm() {
    const count = this.detectedTargets.length;
    this.targetCount.textContent = `감지: ${count}`;

    const now = performance.now();
    if (count > 0) {
      this.statusBadge.classList.add('alert');
      this.alarmBanner.classList.add('show');

      // 0.4초 간격으로 비프음 & 진동 트리거
      if (now - this.lastAlarmTime > 400) {
        this.playTargetTone();
        this.triggerHaptic();
        this.lastAlarmTime = now;
      }
    } else {
      this.statusBadge.classList.remove('alert');
      this.alarmBanner.classList.remove('show');
    }
  }

  // -------------------------------------------------------------
  // HUD 및 감지 오버레이 그래픽 렌더링
  // -------------------------------------------------------------
  renderOverlay() {
    const ctx = this.overlayCtx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. 비행 궤적 선 렌더링 (Flight Trails)
    if (this.currentMode === 'flight' && this.recentTrails.length > 1) {
      ctx.lineWidth = 2.5;
      const now = performance.now();

      for (let i = 1; i < this.recentTrails.length; i++) {
        const p1 = this.recentTrails[i - 1];
        const p2 = this.recentTrails[i];
        const age = now - p2.timestamp;
        const alpha = Math.max(0, 1 - age / 1800);

        ctx.strokeStyle = `rgba(255, 51, 102, ${alpha * 0.85})`;
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }
    }

    // 2. 감지된 타겟 락온 마커 렌더링
    for (const target of this.detectedTargets) {
      const tx = target.x * w;
      const ty = target.y * h;
      const targetRadius = Math.max(16, target.w * w * 1.5);

      // 외곽 조준 링
      ctx.strokeStyle = target.type === 'flying_bug' ? '#ff3366' : '#00ffaa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, targetRadius, 0, Math.PI * 2);
      ctx.stroke();

      // 내부 십자선 마커
      ctx.beginPath();
      ctx.moveTo(tx - targetRadius - 4, ty);
      ctx.lineTo(tx + targetRadius + 4, ty);
      ctx.moveTo(tx, ty - targetRadius - 4);
      ctx.lineTo(tx, ty + targetRadius + 4);
      ctx.stroke();

      // 텍스트 라벨
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      const label = target.type === 'flying_bug' ? '⚠️ 비행 모기' : '🎯 의심 점 표적';
      ctx.fillText(label, tx + targetRadius + 6, ty - 4);
    }
  }

  clearOverlay() {
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.targetCount.textContent = '감지: 0';
    this.statusBadge.classList.remove('alert');
    this.alarmBanner.classList.remove('show');
  }

  // -------------------------------------------------------------
  // 스냅샷 (증거 화면 캡처 저장)
  // -------------------------------------------------------------
  takeSnapshot() {
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = this.video.videoWidth || 1280;
    snapCanvas.height = this.video.videoHeight || 720;
    const snapCtx = snapCanvas.getContext('2d');

    // 비디오 원본 그리기
    snapCtx.drawImage(this.video, 0, 0, snapCanvas.width, snapCanvas.height);

    // 감지 오버레이 합성
    snapCtx.drawImage(this.overlayCanvas, 0, 0, snapCanvas.width, snapCanvas.height);

    // 워터마크 날짜 표시
    snapCtx.fillStyle = 'rgba(0, 255, 170, 0.9)';
    snapCtx.font = 'bold 20px monospace';
    const nowStr = new Date().toLocaleString();
    snapCtx.fillText(`BugFinder AI - ${nowStr}`, 20, snapCanvas.height - 24);

    // 파일 다운로드
    const link = document.createElement('a');
    link.download = `bug_capture_${Date.now()}.png`;
    link.href = snapCanvas.toDataURL('image/png');
    link.click();
  }
}

// 애플리케이션 인스턴스 실행
window.addEventListener('DOMContentLoaded', () => {
  window.bugFinder = new BugFinderApp();
});
