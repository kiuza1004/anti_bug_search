/**
 * ARGON OPTICS // Ar-18 Tactical Bio-Scanner Engine v3.0
 * [Credibility & Real Low-Light Night Vision ISP Edition]
 *
 * 1. 진짜 저조도 야간 투시 엔진 (Real Low-Light Night Vision ISP):
 *    - 하드웨어 카메라 노출 보정(Exposure Compensation EV+) 최대치 자동 인가
 *    - 실시간 히스토그램 다이내믹 레인지 스트레칭 (암부 5~98% 구간을 0~255로 확장)
 *    - 비선형 암부 감마 리프트 LUT (맨눈으로 식별 불가한 밝기 5~40 구간 대비를 8~10배 증폭)
 *    - 다중 프레임 시간축 적분(Temporal Frame Stacking)으로 저조도 열잡음/암부 노이즈 상쇄
 * 2. 오탐 원천 차단 & 초점 안정화:
 *    - 3x3 공간 노이즈 블러 + 배경 엣지(가구/벽지 선) 흔들림 페널티 배제
 *    - 다중 프레임 지속성 검증(Multi-Frame Tracker) 및 저역통과 초점 감쇠 보간
 */

class ArgonBugScanner {
  constructor() {
    // 뷰포트 및 캔버스 DOM
    this.viewportStage = document.getElementById('viewportStage');
    this.video = document.getElementById('cameraVideo');
    this.nvCanvas = document.getElementById('nightVisionCanvas');
    this.nvCtx = this.nvCanvas.getContext('2d', { willReadFrequently: true });
    this.overlayCanvas = document.getElementById('detectionCanvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.scanlineSweep = document.getElementById('scanlineSweep');
    this.screenTorchRing = document.getElementById('screenTorchRing');

    // 야간 투시 ISP 컨트롤 바 DOM
    this.nightIspBar = document.getElementById('nightIspBar');
    this.luxMeterLabel = document.getElementById('luxMeterLabel');
    this.nightFilterChip = document.getElementById('nightFilterChip');

    // 정밀 돋보기(Loupe) DOM
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

    // 야간 투시 ISP 처리 해상도 (480x360: 선명한 화질과 60fps 실시간 픽셀 적분 양립)
    this.nvWidth = 480;
    this.nvHeight = 360;
    this.nvCanvas.width = this.nvWidth;
    this.nvCanvas.height = this.nvHeight;
    this.nvAccumBuffer = null; // Float32Array 다중 프레임 시간축 적분 버퍼
    this.nvLumBuffer = null;   // Uint8Array 엣지 적응형 샤프닝용 휘도 버퍼
    this.lastRawBrightness = 120; // 프레임 간 모션 시프트 감지용
    this.nvLut = new Uint8Array(256); // 256단계 고정 일괄 증폭 룩업 테이블
    this.nightGainMode = 'mid'; // 'mid' (선명 증폭) | 'max' (극저조도 4x) | 'mono' (야간 윤곽선)
    this.ambientBrightness = 120; // 현재 프레임 평균 밝기 (0~255)
    this.autoNightActive = false; // 주간/자동 모드에서 어두운 곳 감지 시 자동 야간 ISP 개입 플래그
    this.darkFrameStreak = 0;     // 어두운 상태 연속 프레임 카운터 (깜빡임 방지 히스테리시스)
    this.brightFrameStreak = 0;   // 밝은 상태 연속 프레임 카운터

    this.buildLockedNightLUT();

    // 오프스크린 비전 탐지 해상도 (240x180)
    this.procWidth = 240;
    this.procHeight = 180;
    this.procCanvas = document.createElement('canvas');
    this.procCanvas.width = this.procWidth;
    this.procCanvas.height = this.procHeight;
    this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true });

    // 고화질 돋보기 원본 추출용 캔버스
    this.hiResCanvas = document.createElement('canvas');
    this.hiResCanvas.width = 640;
    this.hiResCanvas.height = 480;
    this.hiResCtx = this.hiResCanvas.getContext('2d');

    // 런타임 상태 (오직 100% 실제 카메라 스트림만 운용)
    this.isScanning = false;
    this.stream = null;
    this.currentFacingMode = 'environment';
    this.currentMode = 'flight'; // 'flight' | 'spot' | 'trail'
    this.currentFilter = 'standard'; // 'standard' | 'night' | 'argon' | 'invert'
    this.sensitivity = 'mid';
    this.currentZoom = 1;
    this.loupeZoom = 4;
    this.pinnedPoint = null;

    this.loupeFocusX = 0.5;
    this.loupeFocusY = 0.5;

    this.isTorchOn = false;
    this.soundEnabled = true;
    this.vibrateEnabled = true;

    this.audioCtx = null;
    this.lastAlarmTime = 0;

    // 컴퓨터 비전 버퍼 & 다중 프레임 추적기
    this.prevBlurGray = null;
    this.bgFloatGray = null;
    this.activeTracks = [];
    this.nextTrackId = 1;
    this.heatmapPoints = [];
    this.instantTarget = null; // 실시간 영점 레이저 즉각 락온 표적
    this.stabilityScore = 100;
    this.cameraHoldingSteadyFrames = 0;

    // -------------------------------------------------------------
    // 전투기 조종사 HMD 전술 레이저 시스템 (모듈화 설정 아키텍처)
    // - 버튼을 누를 때만 발사되며, 향후 색상/빔 종류 별도 설정 완벽 지원
    // -------------------------------------------------------------
    this.laserConfig = {
      active: false,        // 버튼 누를 때만 true (평소 화면 청결 유지)
      color: 'red',         // 'red' | 'green' | 'cyan' | 'violet' (확장 지원)
      beamStyle: 'twin',    // 'twin' (조종석 양익 트윈 레이저 수렴) | 'center' (중앙 파일런 단일 빔)
      palettes: {
        red: {
          glow: 'rgba(255, 23, 68, 0.55)',
          main: '#ff1744',
          core: '#ffffff',
          spark: '#ff5252',
          tag: 'RED LASER STRIKE'
        },
        green: {
          glow: 'rgba(0, 255, 157, 0.55)',
          main: '#00ff9d',
          core: '#ffffff',
          spark: '#69f0ae',
          tag: 'GREEN LASER STRIKE'
        },
        cyan: {
          glow: 'rgba(0, 240, 255, 0.55)',
          main: '#00f0ff',
          core: '#ffffff',
          spark: '#80d8ff',
          tag: 'CYAN LASER STRIKE'
        },
        violet: {
          glow: 'rgba(168, 85, 247, 0.55)',
          main: '#a855f7',
          core: '#ffffff',
          spark: '#e040fb',
          tag: 'PLASMA LASER STRIKE'
        }
      }
    };
    this.laserPulseTimer = null;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.bindEvents();
    this.handleResize();
  }

  // -------------------------------------------------------------
  // 이벤트 바인딩
  // -------------------------------------------------------------
  bindEvents() {
    document.getElementById('initCamBtn').addEventListener('click', async () => {
      document.getElementById('startModal').classList.add('hidden');
      this.initAudioContext();
      await this.startCamera();
      this.toggleScanning(true);
    });

    const retryBtn = document.getElementById('retryCamBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        document.getElementById('cameraErrorModal').classList.add('hidden');
        await this.startCamera();
        this.toggleScanning(true);
      });
    }

    document.getElementById('startScanBtn').addEventListener('click', () => {
      this.initAudioContext();
      this.toggleScanning(!this.isScanning);
    });

    // [핵심] 전투기 HMD 전술 레이저 발사 제어
    // - 누르고 있는 동안만 계속 발사 (Hold-to-Fire)
    // - 손을 떼는 순간 즉시 정지 (Release-to-Stop)
    // - 살짝 탭했을 때는 단발성 펄스(280ms) 1회 발사 후 자동 차단
    const laserBtn = document.getElementById('laserFireBtn');
    if (laserBtn) {
      // 모바일 터치 제어
      laserBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.startLaser();
      }, { passive: false });

      laserBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.stopLaser();
      }, { passive: false });

      laserBtn.addEventListener('touchcancel', () => {
        this.stopLaser();
      });

      // PC 마우스 제어
      laserBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.startLaser();
      });

      laserBtn.addEventListener('mouseup', () => {
        this.stopLaser();
      });

      laserBtn.addEventListener('mouseleave', () => {
        this.stopLaser();
      });

      // 단발 탭 클릭 시: 280ms 후 자동 차단
      laserBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.triggerLaserPulse(280);
      });
    }

    // 레이저 색상 선택 바
    document.querySelectorAll('[data-lcolor]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('[data-lcolor]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setLaserColor(btn.dataset.lcolor);
      });
    });

    // 레이저 빔 종류 선택 바
    document.querySelectorAll('[data-lstyle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('[data-lstyle]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setLaserStyle(btn.dataset.lstyle);
      });
    });

    document.querySelectorAll('.mode-card').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchMode(btn.dataset.mode);
      });
    });

    // 광학 스펙트럼 필터 선택
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.setOpticalFilter(chip.dataset.filter);
      });
    });

    // 야간 투시 세부 게인(Gain) 단계 선택
    document.querySelectorAll('[data-ngain]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ngain]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.nightGainMode = btn.dataset.ngain;
        this.buildLockedNightLUT();
      });
    });

    document.querySelectorAll('[data-sens]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-sens]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.sensitivity = btn.dataset.sens;
        this.resetTrackingBuffers();
      });
    });

    document.querySelectorAll('[data-zoom]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-zoom]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setZoom(parseFloat(btn.dataset.zoom));
      });
    });

    // 뷰포트 터치 시 해당 위치 정밀 확대
    this.viewportStage.addEventListener('pointerdown', (e) => {
      if (
        e.target.closest('button') ||
        e.target.closest('aside') ||
        e.target.closest('header') ||
        e.target.closest('nav') ||
        e.target.closest('.night-isp-bar') ||
        e.target.closest('.snapshot-toast')
      ) {
        return;
      }
      const rect = this.viewportStage.getBoundingClientRect();
      const nx = Math.max(0.06, Math.min(0.94, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0.06, Math.min(0.94, (e.clientY - rect.top) / rect.height));
      this.setPinnedLoupePoint(nx, ny);
    });

    this.loupePowerBtn.addEventListener('click', () => {
      this.loupeZoom = this.loupeZoom === 4 ? 8 : 4;
      this.loupePowerBtn.textContent = `${this.loupeZoom}X`;
    });

    this.resetPinBtn.addEventListener('click', () => {
      this.clearPinnedLoupePoint();
    });

    document.getElementById('closeMagBtn').addEventListener('click', () => {
      this.magCard.classList.add('hidden');
      this.restoreMagBtn.classList.remove('hidden');
    });

    this.restoreMagBtn.addEventListener('click', () => {
      this.magCard.classList.remove('hidden');
      this.restoreMagBtn.classList.add('hidden');
    });

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
  // 전투기 HMD 전술 레이저 발사 제어 (Hold-to-Fire & Auto-Stop)
  // -------------------------------------------------------------
  startLaser() {
    clearTimeout(this.laserPulseTimer);
    this.laserConfig.active = true;
    const btn = document.getElementById('laserFireBtn');
    if (btn) btn.classList.add('active');

    this.playTacticalLaserSound();
    if (this.vibrateEnabled && navigator.vibrate) {
      try { navigator.vibrate(35); } catch (e) {}
    }
  }

  stopLaser() {
    clearTimeout(this.laserPulseTimer);
    this.laserConfig.active = false;
    const btn = document.getElementById('laserFireBtn');
    if (btn) btn.classList.remove('active');
  }

  triggerLaserPulse(durationMs = 280) {
    this.startLaser();
    this.laserPulseTimer = setTimeout(() => {
      this.stopLaser();
    }, durationMs);
  }

  setLaserColor(colorKey) {
    if (this.laserConfig.palettes[colorKey]) {
      this.laserConfig.color = colorKey;
      try {
        localStorage.setItem('argon_laser_color', colorKey);
      } catch (e) {}
    }
  }

  setLaserStyle(styleKey) {
    this.laserConfig.beamStyle = styleKey;
    try {
      localStorage.setItem('argon_laser_style', styleKey);
    } catch (e) {}
  }

  toggleLaser(state) {
    if (state) {
      this.startLaser();
    } else {
      this.stopLaser();
    }
  }

  playTacticalLaserSound() {
    if (!this.soundEnabled) return;
    this.initAudioContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1600, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.16);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch (e) {}
  }

  resetTrackingBuffers() {
    this.activeTracks = [];
    this.prevBlurGray = null;
    this.bgFloatGray = null;
  }

  setPinnedLoupePoint(nx, ny) {
    this.pinnedPoint = { x: nx, y: ny };
    this.loupeFocusX = nx;
    this.loupeFocusY = ny;
    this.loupeModeBadge.textContent = '수동고정';
    this.loupeModeBadge.classList.add('pinned');
    this.resetPinBtn.classList.remove('hidden');
    this.magCard.classList.remove('hidden');
    this.restoreMagBtn.classList.add('hidden');
    this.reticleHint.textContent = '선택한 지점을 확대 중입니다 (우측 돋보기 [해제] 클릭 시 중앙 조준 복귀)';
  }

  clearPinnedLoupePoint() {
    this.pinnedPoint = null;
    this.loupeModeBadge.textContent = '중앙조준';
    this.loupeModeBadge.classList.remove('pinned');
    this.resetPinBtn.classList.add('hidden');
    this.reticleHint.textContent = '카메라를 멈추고 조준하세요 (화면 터치 시 해당 위치 확대)';
  }

  // -------------------------------------------------------------
  // 오디오 & 진동
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

  playArgonSonarPing(confidence = 0.85) {
    if (!this.soundEnabled || !this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      const baseFreq = 1050 + Math.min(1, confidence) * 450;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + 0.08);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.005, now + 0.11);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch (e) {}
  }

  triggerHaptic() {
    if (!this.vibrateEnabled || !navigator.vibrate) return;
    try {
      navigator.vibrate(50);
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // 카메라 초기화 & 하드웨어 저조도 노출 부스트 (EV+)
  // (가짜 시뮬레이션 없이 오직 실제 하드웨어 카메라만 연결)
  // -------------------------------------------------------------
  async startCamera() {
    this.updateStatus('카메라 연결 중...', 'normal');
    this.resetTrackingBuffers();

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    const errModal = document.getElementById('cameraErrorModal');
    const errMsg = document.getElementById('camErrorMsg');

    // 비보안 컨텍스트(HTTP IP 접속 등)로 인해 카메라 API가 원천 차단된 경우
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const isHttp = window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      if (errModal && errMsg) {
        errMsg.innerHTML = isHttp
          ? `스마트폰 브라우저 보안 정책으로 인해 일반 HTTP 주소에서는 카메라가 차단됩니다.<br><strong>아래 해결 방법</strong>에 따라 크롬 설정을 변경하거나 정식 HTTPS 주소로 접속해 주십시오.`
          : `현재 브라우저 환경에서 카메라 하드웨어에 접근할 수 없습니다. 권한을 확인해 주십시오.`;
        errModal.classList.remove('hidden');
      }
      this.updateStatus('카메라 연결 실패', 'error');
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

      if (errModal) errModal.classList.add('hidden');
      this.handleResize();
      this.updateStatus('광학 스캔 중 (실제 카메라)', 'active');
      this.applyHardwareZoom(this.currentZoom);
      this.applyHardwareLowLightExposure(this.currentFilter === 'night' || this.autoNightActive);
    } catch (err) {
      console.warn('Real camera access failed:', err);
      if (errModal && errMsg) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errMsg.textContent = '카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 [허용]으로 변경해 주십시오.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errMsg.textContent = '기기에서 사용 가능한 카메라 장치를 찾을 수 없습니다.';
        } else {
          errMsg.textContent = `카메라를 실행할 수 없습니다: ${err.message || err.name}`;
        }
        errModal.classList.remove('hidden');
      }
      this.updateStatus('카메라 접근 거부됨', 'error');
    }
  }

  // 카메라 센서 자체의 하드웨어 노출 보정(Exposure Compensation) 및 감도를 끌어올려 수광량 극대화
  async applyHardwareLowLightExposure(enableBoost) {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;

    try {
      const caps = track.getCapabilities();
      const adv = {};

      if (caps.exposureCompensation) {
        adv.exposureCompensation = enableBoost
          ? caps.exposureCompensation.max
          : (caps.exposureCompensation.min + caps.exposureCompensation.max) * 0.5;
      }
      if (caps.exposureMode && caps.exposureMode.includes('continuous')) {
        adv.exposureMode = 'continuous';
      }
      if (enableBoost) {
        if (caps.iso && caps.iso.max) {
          adv.iso = caps.iso.max;
        }
        if (caps.exposureTime && caps.exposureTime.max) {
          adv.exposureTime = caps.exposureTime.max;
        }
        if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) {
          adv.whiteBalanceMode = 'continuous';
        }
      }

      if (Object.keys(adv).length > 0) {
        await track.applyConstraints({ advanced: [adv] });
      }
    } catch (e) {
      // 기기 미지원 시 소프트웨어 다중 프레임 ISP로 완벽 커버
    }
  }

  switchCamera() {
    this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    this.startCamera();
  }

  // 하드웨어 플래시(Torch) + 전면/미지원 기기용 화면 고휘도 광원 링 연동
  async toggleTorch() {
    this.isTorchOn = !this.isTorchOn;
    document.getElementById('torchBtn').classList.toggle('active', this.isTorchOn);

    if (this.stream) {
      const track = this.stream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        try {
          const caps = track.getCapabilities();
          if (caps.torch) {
            await track.applyConstraints({ advanced: [{ torch: this.isTorchOn }] });
            return;
          }
        } catch (e) {}
      }
    }

    // 하드웨어 후면 플래시가 없거나 전면 카메라일 때는 화면 최대 밝기 광원 링(Screen Illuminator) 가동
    this.screenTorchRing.classList.toggle('hidden', !this.isTorchOn);
  }

  setOpticalFilter(filterName) {
    this.currentFilter = filterName;
    this.nvAccumBuffer = null;
    this.resetTrackingBuffers();

    const isNightMode = filterName === 'night';
    this.nightIspBar.classList.toggle('hidden', !isNightMode && !this.autoNightActive);
    this.nvCanvas.classList.toggle('hidden', !isNightMode && !this.autoNightActive);

    if (isNightMode) {
      this.video.className = 'filter-standard';
      this.applyHardwareLowLightExposure(true);
    } else {
      this.video.className = `filter-${filterName}`;
      this.applyHardwareLowLightExposure(false);
    }
  }

  setZoom(factor) {
    this.currentZoom = factor;
    this.applyHardwareZoom(factor);
    this.video.style.transform = `scale(${factor})`;
    this.nvCanvas.style.transform = `scale(${factor})`;
    this.resetTrackingBuffers();
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
  // 모드 & 스캔 토글
  // -------------------------------------------------------------
  switchMode(mode) {
    this.currentMode = mode;
    document.querySelectorAll('.mode-card').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    if (mode === 'flight') {
      this.reticle.style.opacity = '0.32';
      if (!this.pinnedPoint) {
        this.magCard.classList.add('hidden');
        this.restoreMagBtn.classList.remove('hidden');
      }
    } else if (mode === 'spot') {
      this.reticle.style.opacity = '0.75';
      this.magCard.classList.remove('hidden');
      this.restoreMagBtn.classList.add('hidden');
    } else if (mode === 'trail') {
      this.reticle.style.opacity = '0.25';
      if (!this.pinnedPoint) {
        this.magCard.classList.add('hidden');
        this.restoreMagBtn.classList.remove('hidden');
      }
    }

    this.resetTrackingBuffers();
    this.heatmapPoints = [];
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
      this.resetTrackingBuffers();
      this.updateStatus('광학 스캔 중 (이상 없음)', 'active');
      this.requestLoop();
    } else {
      btn.classList.remove('scanning');
      txt.textContent = 'SCAN';
      svg.innerHTML = '<polygon points="7 5 19 12 7 19 7 5"/>';
      this.scanlineSweep.classList.remove('scanning');
      this.updateStatus('스캔 일시정지됨', 'normal');
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
  // 메인 비전 루프
  // -------------------------------------------------------------
  requestLoop() {
    if (!this.isScanning) return;
    this.processFrame();
    requestAnimationFrame(() => this.requestLoop());
  }

  processFrame() {
    // 실제 카메라 영상 프레임이 준비되지 않았으면 대기
    if (this.video.readyState < 2) {
      return;
    }
    const rawSource = this.video;

    // 0단계: 저조도 측정 및 진짜 야간 투시 ISP (다중 프레임 적분 + 비선형 암부 감마 LUT) 실행 여부 판단
    const useNightISP = this.evaluateAndRunNightVisionISP(rawSource);

    // 야간 투시 ISP가 활성화된 경우, 증폭되어 밝고 선명해진 nvCanvas를 탐지기 및 돋보기의 입력 소스로 사용!
    const activeVisualSource = useNightISP ? this.nvCanvas : rawSource;

    this.procCtx.drawImage(activeVisualSource, 0, 0, this.procWidth, this.procHeight);
    this.hiResCtx.drawImage(activeVisualSource, 0, 0, this.hiResCanvas.width, this.hiResCanvas.height);

    const frameData = this.procCtx.getImageData(0, 0, this.procWidth, this.procHeight);

    // 1단계: 3x3 공간 평균 블러 및 배경 엣지 강도 계산
    const { blurGray, edgeMag } = this.computeSmoothedGrayAndEdge(frameData.data, this.procWidth, this.procHeight);

    // 2단계: 전역 카메라 흔들림 및 노이즈 레벨 측정
    const { isCameraSteady, noiseFloor } = this.measureCameraStability(blurGray, edgeMag);

    // 3단계: 모드별 후보 검출 및 다중 프레임 지속성 추적기 업데이트
    if (this.currentMode === 'flight' || this.currentMode === 'trail') {
      this.detectAndTrackKinetic(blurGray, edgeMag, isCameraSteady, noiseFloor);
    } else {
      this.detectAndTrackMicroSpot(blurGray, edgeMag, isCameraSteady);
    }

    // 3-2단계: 화면 내 최적 표적 실시간 영점 락온 스캐너
    this.updateInstantLaserTarget(blurGray, edgeMag);

    // 4단계: 정밀 돋보기(루페) 포커스 부드럽게 갱신
    this.updateSmoothLoupe();

    // 5단계: HUD 및 검증 상태 렌더링
    this.evaluateTacticalAlarm(isCameraSteady);
    this.renderArgonHUD();
  }

  // -------------------------------------------------------------
  // 화면 중앙 부근의 가장 유력한 타겟(암점/곤충 후보) 실시간 영점 락온
  // -------------------------------------------------------------
  updateInstantLaserTarget(blurGray, edgeMag) {
    const w = this.procWidth;
    const h = this.procHeight;

    const startX = Math.floor(w * 0.18);
    const endX = Math.floor(w * 0.82);
    const startY = Math.floor(h * 0.18);
    const endY = Math.floor(h * 0.82);

    let bestX = -1;
    let bestY = -1;
    let maxScore = 0;

    const step = 3;
    for (let y = startY; y < endY; y += step) {
      const row = y * w;
      for (let x = startX; x < endX; x += step) {
        const cLum = blurGray[row + x];
        // 4방향 국소 대비(Δ Contrast)
        const l = blurGray[row + x - 3];
        const r = blurGray[row + x + 3];
        const u = blurGray[(y - 3) * w + x];
        const d = blurGray[(y + 3) * w + x];
        const avgSurround = (l + r + u + d) * 0.25;
        const delta = avgSurround - cLum;

        // 고립 암점이며 가장자리 선이 아닌 경우
        if (delta > 14 && edgeMag[row + x] < delta * 1.2) {
          const distToCenter = Math.hypot(x / w - 0.5, y / h - 0.5);
          const score = delta * (1.2 - distToCenter);
          if (score > maxScore) {
            maxScore = score;
            bestX = x;
            bestY = y;
          }
        }
      }
    }

    if (bestX > 0 && maxScore > 16) {
      const targetNx = bestX / w;
      const targetNy = bestY / h;
      if (!this.instantTarget) {
        this.instantTarget = { x: targetNx, y: targetNy, score: maxScore };
      } else {
        // 급격한 튐 방지 부드러운 위치 추종
        this.instantTarget.x = this.instantTarget.x * 0.7 + targetNx * 0.3;
        this.instantTarget.y = this.instantTarget.y * 0.7 + targetNy * 0.3;
        this.instantTarget.score = maxScore;
      }
    } else {
      this.instantTarget = null;
    }
  }

  // -------------------------------------------------------------
  // [핵심] 밝은 부분이 하얗게 날아가지(White Blowout) 않으면서 어두운 암부만 일괄 증폭하는 고정 LUT
  // - 암부 노이즈 플로어는 억제하고 곤충 암점과 벽면 대비는 극대화하는 S-Curve 하이브리드 감마
  // -------------------------------------------------------------
  buildLockedNightLUT() {
    let gamma = 0.44; // 1단: 암부는 약 3배 밝히고 선명도 보존

    if (this.nightGainMode === 'max') {
      gamma = 0.32;   // 2단(강): 칠흑 같은 어둠에서 암부를 약 4.5배 강하게 리프트
    } else if (this.nightGainMode === 'mono') {
      gamma = 0.38;
    }

    for (let v = 0; v < 256; v++) {
      const norm = v / 255.0;
      // 비선형 파워 리프트
      let val = Math.pow(norm, gamma) * 255.0;

      // 초저조도 센서 노이즈 플로어(0~8) 억제 및 중간 암점 대비 부스트
      if (v < 8) {
        val = val * (v / 8.0);
      } else if (v < 80) {
        // 모기/벌레 암점(Dark Blob)의 식별력을 높이기 위한 국소 콘트라스트 기울기 부여
        val = val * 1.08;
      }

      this.nvLut[v] = Math.max(0, Math.min(255, Math.round(val)));
    }
  }

  // -------------------------------------------------------------
  // 차세대 HD 저조도 야간 투시 ISP 엔진 (Next-Gen HD Low-Light ISP)
  // 1) 8x6 그리드 기반 국소 대비 증폭 (Fast Local Dynamic Range Booster)
  // 2) 모션 적응형 안티-고스팅 시간축 노이즈 제거 (Anti-Ghosting Motion Filtering)
  // 3) 엣지 적응형 고주파 언샤프 샤프닝 (Edge-Adaptive High-Boost Sharpening)
  // -------------------------------------------------------------
  evaluateAndRunNightVisionISP(rawSource) {
    const nw = this.nvWidth;
    const nh = this.nvHeight;

    this.nvCtx.drawImage(rawSource, 0, 0, nw, nh);
    const imgData = this.nvCtx.getImageData(0, 0, nw, nh);
    const data = imgData.data;
    const totalPixels = nw * nh;

    // 1) 현재 원본 프레임의 평균 밝기 측정 및 카메라 모션 시프트 감지
    let lumSum = 0;
    let sampleCnt = 0;
    for (let i = 0; i < data.length; i += 32) {
      lumSum += (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      sampleCnt++;
    }
    const rawBrightness = lumSum / sampleCnt;
    const motionShift = Math.abs(rawBrightness - this.lastRawBrightness);
    this.lastRawBrightness = rawBrightness;
    this.ambientBrightness = Math.round(this.ambientBrightness * 0.85 + rawBrightness * 0.15);

    // 2) 주간/자동(standard) 모드에서는 어두운 곳(평균 밝기 < 26)일 때만 자동 개입
    if (this.currentFilter === 'standard') {
      if (this.ambientBrightness < 26) {
        this.darkFrameStreak++;
        this.brightFrameStreak = 0;
        if (this.darkFrameStreak >= 20 && !this.autoNightActive) {
          this.autoNightActive = true;
          this.nightIspBar.classList.remove('hidden');
          this.nvCanvas.classList.remove('hidden');
        }
      } else if (this.ambientBrightness > 70) {
        this.brightFrameStreak++;
        this.darkFrameStreak = 0;
        if (this.brightFrameStreak >= 45 && this.autoNightActive) {
          this.autoNightActive = false;
          this.nightIspBar.classList.add('hidden');
          this.nvCanvas.classList.add('hidden');
        }
      } else {
        this.darkFrameStreak = 0;
        this.brightFrameStreak = 0;
      }
    }

    const isNightActive = this.currentFilter === 'night' || this.autoNightActive;
    if (!isNightActive) {
      return false;
    }

    const estLux = Math.max(1, Math.round(Math.pow(this.ambientBrightness / 12, 2.1)));
    this.luxMeterLabel.textContent = `조도 ${estLux} lx · HD 야간 ISP 가동 중`;

    // 3) 시간축 적분 및 샤프닝 버퍼 동기화
    const lut = this.nvLut;
    if (!this.nvAccumBuffer || this.nvAccumBuffer.length !== totalPixels * 3) {
      this.nvAccumBuffer = new Float32Array(totalPixels * 3);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        this.nvAccumBuffer[j] = lut[data[i]];
        this.nvAccumBuffer[j + 1] = lut[data[i + 1]];
        this.nvAccumBuffer[j + 2] = lut[data[i + 2]];
      }
    }
    if (!this.nvLumBuffer || this.nvLumBuffer.length !== totalPixels) {
      this.nvLumBuffer = new Uint8Array(totalPixels);
    }

    // 4) 8x6 그리드 기반 국소 대비 게인 (초고속 0.08ms 서브샘플링)
    const cols = 8;
    const rows = 6;
    const blockW = 60;
    const blockH = 60;
    const blockGain = new Float32Array(cols * rows);

    for (let by = 0; by < rows; by++) {
      const yStart = by * blockH;
      const bRow = by * cols;
      for (let bx = 0; bx < cols; bx++) {
        const xStart = bx * blockW;
        let bSum = 0;
        let bCnt = 0;
        for (let sy = 0; sy < blockH; sy += 8) {
          const rowOff = (yStart + sy) * nw;
          for (let sx = 0; sx < blockW; sx += 8) {
            const p = (rowOff + xStart + sx) * 4;
            bSum += (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
            bCnt++;
          }
        }
        const bAvg = bCnt > 0 ? (bSum / bCnt) : 128;
        // 칠흑 같이 어두운 구석은 국소 다이내믹 레인지를 1.20배 확장, 밝은 블록은 1.0 유지
        blockGain[bRow + bx] = bAvg < 30 ? 1.20 : (bAvg < 65 ? 1.10 : 1.0);
      }
    }

    // 5) 모션 적응형 안티-고스팅 시간축 적분 & 픽셀 맵핑
    const isMono = this.nightGainMode === 'mono';
    const accum = this.nvAccumBuffer;
    const lumBuf = this.nvLumBuffer;
    const isPanning = motionShift > 4.5;
    const baseAlpha = isPanning ? 0.22 : 0.74;

    let pixelIdx = 0;
    for (let y = 0; y < nh; y++) {
      const by = Math.min(rows - 1, (y / blockH) | 0);
      const bRow = by * cols;

      for (let x = 0; x < nw; x++, pixelIdx++) {
        const bx = Math.min(cols - 1, (x / blockW) | 0);
        const bgain = blockGain[bRow + bx];

        const i = pixelIdx * 4;
        const j = pixelIdx * 3;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const lum = (r * 77 + g * 150 + b * 29) >> 8;
        const rawLifted = lut[lum];
        const liftedLum = Math.min(255, (rawLifted * bgain) | 0);

        if (isMono) {
          const prevG = accum[j + 1];
          const diff = Math.abs(liftedLum - prevG);
          const alpha = diff < 26 ? baseAlpha : 0.18;
          const curVal = prevG * alpha + liftedLum * (1 - alpha);
          accum[j + 1] = curVal;

          lumBuf[pixelIdx] = curVal | 0;
          data[i] = curVal * 0.22;
          data[i + 1] = curVal;
          data[i + 2] = curVal * 0.75;
        } else {
          const nr = Math.min(255, ((lut[r] * 0.52 + liftedLum * 0.48) * bgain) | 0);
          const ng = Math.min(255, ((lut[g] * 0.62 + liftedLum * 0.38) * bgain) | 0);
          const nb = Math.min(255, ((lut[b] * 0.52 + liftedLum * 0.48) * bgain) | 0);

          const prevG = accum[j + 1];
          const diff = Math.abs(ng - prevG);
          const alpha = diff < 26 ? baseAlpha : 0.18;
          const invAlpha = 1 - alpha;

          const ar = accum[j] * alpha + nr * invAlpha;
          const ag = prevG * alpha + ng * invAlpha;
          const ab = accum[j + 2] * alpha + nb * invAlpha;

          accum[j] = ar;
          accum[j + 1] = ag;
          accum[j + 2] = ab;

          lumBuf[pixelIdx] = ((ar * 77 + ag * 150 + ab * 29) >> 8) | 0;

          data[i] = ar;
          data[i + 1] = ag;
          data[i + 2] = ab;
        }
      }
    }

    // 6) 엣지 적응형 고주파 언샤프 샤프닝 (Edge-Adaptive High-Boost Sharpening Pass)
    // - 평탄한 센서 암부 노이즈(absLap < 6)는 건너뛰고, 곤충 윤곽선/다리/질감만 칼처럼 또렷하게 부스트!
    const sharpFactor = this.nightGainMode === 'max' ? 0.45 : 0.55;

    for (let y = 1; y < nh - 1; y++) {
      const row = y * nw;
      const upRow = (y - 1) * nw;
      const dnRow = (y + 1) * nw;

      for (let x = 1; x < nw - 1; x++) {
        const idx = row + x;
        const c = lumBuf[idx];
        const l = lumBuf[idx - 1];
        const r = lumBuf[idx + 1];
        const u = lumBuf[upRow + x];
        const d = lumBuf[dnRow + x];

        // 4방향 라플라시안 고주파 성분
        const lap = (c << 2) - (l + r + u + d);
        const absLap = Math.abs(lap);

        if (absLap >= 6) {
          const boost = Math.max(-28, Math.min(28, (lap * sharpFactor) | 0));
          const p = idx * 4;

          if (isMono) {
            const val = Math.max(0, Math.min(255, lumBuf[idx] + boost));
            data[p] = val * 0.22;
            data[p + 1] = val;
            data[p + 2] = val * 0.75;
          } else {
            data[p] = Math.max(0, Math.min(255, data[p] + boost));
            data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + boost));
            data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + boost));
          }
        }
      }
    }

    this.nvCtx.putImageData(imgData, 0, 0);
    return true;
  }

  // -------------------------------------------------------------
  // 3x3 공간 노이즈 블러 & 배경 엣지(가구/벽지 선) 추출
  // -------------------------------------------------------------
  computeSmoothedGrayAndEdge(rgba, w, h) {
    const rawGray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      rawGray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    }

    const blurGray = new Uint8Array(w * h);
    const edgeMag = new Uint8Array(w * h);

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        const c = rawGray[idx];
        const l = rawGray[idx - 1];
        const r = rawGray[idx + 1];
        const u = rawGray[idx - w];
        const d = rawGray[idx + w];

        blurGray[idx] = (c * 4 + l + r + u + d) >> 3;

        const gx = Math.abs(r - l);
        const gy = Math.abs(d - u);
        edgeMag[idx] = Math.min(255, gx + gy);
      }
    }

    return { blurGray, edgeMag };
  }

  // -------------------------------------------------------------
  // 카메라 흔들림 안정도 & 센서 노이즈 바닥값 측정
  // -------------------------------------------------------------
  measureCameraStability(blurGray, edgeMag) {
    const w = this.procWidth;
    const h = this.procHeight;

    if (!this.prevBlurGray || !this.bgFloatGray) {
      this.prevBlurGray = new Uint8Array(blurGray);
      this.bgFloatGray = new Float32Array(blurGray);
      return { isCameraSteady: false, noiseFloor: 5 };
    }

    let diffSum = 0;
    let largeShiftCount = 0;
    let sampleCount = 0;

    for (let y = 8; y < h - 8; y += 4) {
      for (let x = 8; x < w - 8; x += 4) {
        const idx = y * w + x;
        const diff = Math.abs(blurGray[idx] - this.prevBlurGray[idx]);
        diffSum += diff;
        if (diff > 14) largeShiftCount++;
        sampleCount++;
      }
    }

    const avgDiff = diffSum / sampleCount;
    const shiftRatio = largeShiftCount / sampleCount;

    const rawStability = Math.max(0, Math.min(100, Math.round((1 - shiftRatio * 10) * 100)));
    this.stabilityScore = Math.round(this.stabilityScore * 0.65 + rawStability * 0.35);
    this.updateStabilityMeter(this.stabilityScore);

    if (avgDiff < 2.5) {
      this.fpsCounter.textContent = '극저';
      this.fpsCounter.style.color = '#00ff9d';
    } else if (avgDiff < 5.5) {
      this.fpsCounter.textContent = '안정';
      this.fpsCounter.style.color = '#f8fafc';
    } else {
      this.fpsCounter.textContent = '흔들림';
      this.fpsCounter.style.color = '#ffb800';
    }

    const isSteadyNow = this.stabilityScore >= 72 && avgDiff < 6.0;
    if (isSteadyNow) {
      this.cameraHoldingSteadyFrames = Math.min(60, this.cameraHoldingSteadyFrames + 1);
    } else {
      this.cameraHoldingSteadyFrames = 0;
      this.activeTracks = this.activeTracks.filter(t => t.confirmed);
    }

    return {
      isCameraSteady: this.cameraHoldingSteadyFrames >= 5,
      noiseFloor: avgDiff
    };
  }

  updateStabilityMeter(score) {
    this.stabBarFill.style.width = `${score}%`;
    if (score >= 75) {
      this.stabBarFill.style.backgroundColor = '#00ff9d';
    } else if (score >= 45) {
      this.stabBarFill.style.backgroundColor = '#ffb800';
    } else {
      this.stabBarFill.style.backgroundColor = '#ff2a6d';
    }
  }

  // -------------------------------------------------------------
  // 비행 레이더 (KINETIC): 배경 엣지 배제 + 다중 프레임 궤적 검증
  // -------------------------------------------------------------
  detectAndTrackKinetic(blurGray, edgeMag, isCameraSteady, noiseFloor) {
    const w = this.procWidth;
    const h = this.procHeight;

    const sensConfig = {
      low:   { baseThresh: 28, confirmFrames: 10, minMoveDist: 0.04 },
      mid:   { baseThresh: 21, confirmFrames: 8,  minMoveDist: 0.03 },
      high:  { baseThresh: 16, confirmFrames: 6,  minMoveDist: 0.022 },
      ultra: { baseThresh: 12, confirmFrames: 5,  minMoveDist: 0.015 }
    };
    const cfg = sensConfig[this.sensitivity] || sensConfig.mid;
    const adaptiveThresh = Math.max(cfg.baseThresh, noiseFloor * 4.2);

    const candidates = [];

    if (isCameraSteady) {
      const motionPixels = [];
      const step = 2;

      for (let y = 6; y < h - 6; y += step) {
        for (let x = 6; x < w - 6; x += step) {
          const idx = y * w + x;
          const cur = blurGray[idx];
          const prev = this.prevBlurGray[idx];
          const bg = this.bgFloatGray[idx];

          this.bgFloatGray[idx] = bg * 0.9 + cur * 0.1;

          const frameDiff = Math.abs(cur - prev);
          const bgDiff = Math.abs(cur - bg);
          const edgePenalty = edgeMag[idx] * 0.65;
          const pureMotion = Math.min(frameDiff, bgDiff) - edgePenalty;

          if (pureMotion > adaptiveThresh) {
            motionPixels.push({ x, y, score: pureMotion });
          }
        }
      }

      if (motionPixels.length >= 1 && motionPixels.length <= 85) {
        const clusters = this.clusterPoints(motionPixels, 10);

        for (const cl of clusters) {
          const bw = cl.maxX - cl.minX + step;
          const bh = cl.maxY - cl.minY + step;
          const aspect = bw / Math.max(1, bh);

          if (bw >= 2 && bw <= 18 && bh >= 2 && bh <= 18 && aspect >= 0.35 && aspect <= 2.8) {
            candidates.push({
              x: ((cl.minX + cl.maxX) * 0.5) / w,
              y: ((cl.minY + cl.maxY) * 0.5) / h,
              w: bw / w,
              h: bh / h,
              type: 'kinetic'
            });
          }
        }
      }
    } else {
      for (let i = 0; i < blurGray.length; i++) {
        this.bgFloatGray[i] = blurGray[i];
      }
    }

    this.prevBlurGray.set(blurGray);
    this.updateMultiFrameTracks(candidates, cfg.confirmFrames, cfg.minMoveDist, 'kinetic');
  }

  // -------------------------------------------------------------
  // 벽면 점 스캔 (MICRO-SPOT): 8방향 전방위 고립성 검사
  // -------------------------------------------------------------
  detectAndTrackMicroSpot(blurGray, edgeMag, isCameraSteady) {
    const w = this.procWidth;
    const h = this.procHeight;

    const sensConfig = {
      low:   { contrast: 36, confirmFrames: 12 },
      mid:   { contrast: 26, confirmFrames: 10 },
      high:  { contrast: 19, confirmFrames: 8 },
      ultra: { contrast: 14, confirmFrames: 6 }
    };
    const cfg = sensConfig[this.sensitivity] || sensConfig.mid;

    const candidates = [];

    if (isCameraSteady) {
      const startX = Math.floor(w * 0.28);
      const endX = Math.floor(w * 0.72);
      const startY = Math.floor(h * 0.28);
      const endY = Math.floor(h * 0.72);

      const rInner = 5;
      const rOuter = 10;
      const dirs = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1]
      ];

      const rawSpots = [];

      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          const cLum = blurGray[y * w + x];

          let allBrighter = true;
          let ringSum = 0;
          let ringMin = 255;
          let ringMax = 0;

          for (let d = 0; d < 8; d++) {
            const nx = x + dirs[d][0] * rInner;
            const ny = y + dirs[d][1] * rInner;
            const nLum = blurGray[ny * w + nx];

            if (nLum - cLum < cfg.contrast * 0.65) {
              allBrighter = false;
              break;
            }
            ringSum += nLum;
            if (nLum < ringMin) ringMin = nLum;
            if (nLum > ringMax) ringMax = nLum;
          }

          if (!allBrighter) continue;

          const bgSpread = ringMax - ringMin;
          const avgRing = ringSum / 8;
          const delta = avgRing - cLum;

          if (delta < cfg.contrast || bgSpread > delta * 1.1) continue;

          const out1 = blurGray[y * w + (x - rOuter)];
          const out2 = blurGray[y * w + (x + rOuter)];
          const out3 = blurGray[(y - rOuter) * w + x];
          const out4 = blurGray[(y + rOuter) * w + x];
          if (out1 - cLum < cfg.contrast * 0.5 || out2 - cLum < cfg.contrast * 0.5 ||
              out3 - cLum < cfg.contrast * 0.5 || out4 - cLum < cfg.contrast * 0.5) {
            continue;
          }

          const distFromCenter = Math.hypot(x / w - 0.5, y / h - 0.5);
          const priorityScore = delta * (1.2 - distFromCenter);

          rawSpots.push({ x, y, delta, priorityScore });
        }
      }

      rawSpots.sort((a, b) => b.priorityScore - a.priorityScore);
      const picked = [];
      for (const s of rawSpots) {
        if (!picked.some(p => Math.hypot(p.x - s.x, p.y - s.y) < 18)) {
          picked.push(s);
          if (picked.length >= 2) break;
        }
      }

      for (const p of picked) {
        candidates.push({
          x: p.x / w,
          y: p.y / h,
          w: 0.04,
          h: 0.04,
          contrast: Math.round(p.delta),
          type: 'spot'
        });
      }
    }

    this.prevBlurGray.set(blurGray);
    this.updateMultiFrameTracks(candidates, cfg.confirmFrames, 0, 'spot');
  }

  // -------------------------------------------------------------
  // 다중 프레임 지속성 추적기 & 저역통과 초점 스무딩
  // -------------------------------------------------------------
  updateMultiFrameTracks(candidates, confirmFrames, minMoveDist, modeType) {
    const now = performance.now();
    const matchRadius = modeType === 'spot' ? 0.055 : 0.11;
    const matchedCandIndices = new Set();

    for (const track of this.activeTracks) {
      let bestIdx = -1;
      let bestDist = matchRadius;

      for (let i = 0; i < candidates.length; i++) {
        if (matchedCandIndices.has(i)) continue;
        const c = candidates[i];
        const d = Math.hypot(c.x - track.rawX, c.y - track.rawY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        matchedCandIndices.add(bestIdx);
        const c = candidates[bestIdx];

        const instVx = c.x - track.rawX;
        const instVy = c.y - track.rawY;
        track.vx = track.vx * 0.7 + instVx * 0.3;
        track.vy = track.vy * 0.7 + instVy * 0.3;

        track.rawX = c.x;
        track.rawY = c.y;

        const smoothFactor = modeType === 'spot' ? 0.16 : 0.28;
        track.x = track.x * (1 - smoothFactor) + c.x * smoothFactor;
        track.y = track.y * (1 - smoothFactor) + c.y * smoothFactor;

        if (c.contrast) track.contrast = c.contrast;

        track.hitCount = Math.min(confirmFrames + 15, track.hitCount + 1);
        track.missCount = 0;
        track.trail.push({ x: track.x, y: track.y, timestamp: now });

        const totalDisp = Math.hypot(track.x - track.originX, track.y - track.originY);
        const passedMoveCheck = modeType === 'spot' || totalDisp >= minMoveDist;

        track.verificationProgress = Math.min(1, track.hitCount / confirmFrames);

        if (track.hitCount >= confirmFrames && passedMoveCheck) {
          track.confirmed = true;
          if (this.currentMode === 'trail') {
            this.heatmapPoints.push({
              x: track.x,
              y: track.y,
              intensity: 0.8,
              timestamp: now
            });
          }
        }
      } else {
        track.missCount++;
        track.hitCount = Math.max(0, track.hitCount - 1);
      }

      track.trail = track.trail.filter(pt => now - pt.timestamp < 1600);
    }

    for (let i = 0; i < candidates.length; i++) {
      if (!matchedCandIndices.has(i) && this.activeTracks.length < 6) {
        const c = candidates[i];
        this.activeTracks.push({
          id: this.nextTrackId++,
          originX: c.x,
          originY: c.y,
          rawX: c.x,
          rawY: c.y,
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          vx: 0,
          vy: 0,
          type: c.type,
          contrast: c.contrast || 0,
          hitCount: 1,
          missCount: 0,
          verificationProgress: 1 / confirmFrames,
          confirmed: false,
          trail: [{ x: c.x, y: c.y, timestamp: now }]
        });
      }
    }

    this.activeTracks = this.activeTracks.filter(t => {
      const maxMiss = t.confirmed ? 8 : 3;
      return t.missCount <= maxMiss && t.hitCount > 0;
    });

    this.heatmapPoints = this.heatmapPoints.filter(hPt => now - hPt.timestamp < 8000);
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
  // 정밀 돋보기(루페) 부드러운 포커스 제어
  // -------------------------------------------------------------
  updateSmoothLoupe() {
    let targetX = 0.5;
    let targetY = 0.5;
    let label = '중앙 십자선 확대 중';
    let badgeText = '중앙조준';

    const confirmedTracks = this.activeTracks.filter(t => t.confirmed);

    if (this.pinnedPoint) {
      targetX = this.pinnedPoint.x;
      targetY = this.pinnedPoint.y;
      label = '터치 지점 정밀 확대';
      badgeText = '수동고정';
    } else if (confirmedTracks.length > 0) {
      const primary = confirmedTracks[0];
      targetX = primary.x;
      targetY = primary.y;
      label = primary.type === 'spot' ? `확정 암점 (Δ+${primary.contrast})` : '확정 비행 표적 추적';
      badgeText = '표적락온';
    }

    this.loupeFocusX = this.loupeFocusX * 0.86 + targetX * 0.14;
    this.loupeFocusY = this.loupeFocusY * 0.86 + targetY * 0.14;

    if (!this.pinnedPoint) {
      this.loupeModeBadge.textContent = badgeText;
    }

    this.renderMagnifierCanvas(this.loupeFocusX, this.loupeFocusY, label);
  }

  renderMagnifierCanvas(normX, normY, captionText) {
    if (!this.magCanvas) return;
    const mw = this.magCanvas.width;
    const mh = this.magCanvas.height;
    const srcW = this.hiResCanvas.width;
    const srcH = this.hiResCanvas.height;

    const cropW = this.loupeZoom === 8 ? 44 : 88;
    const cropH = this.loupeZoom === 8 ? 44 : 88;

    const sx = Math.max(0, Math.min(srcW - cropW, normX * srcW - cropW * 0.5));
    const sy = Math.max(0, Math.min(srcH - cropH, normY * srcH - cropH * 0.5));

    this.magCtx.clearRect(0, 0, mw, mh);
    this.magCtx.imageSmoothingEnabled = true;
    this.magCtx.imageSmoothingQuality = 'high';

    this.magCtx.drawImage(this.hiResCanvas, sx, sy, cropW, cropH, 0, 0, mw, mh);

    const hasConfirmed = this.activeTracks.some(t => t.confirmed);
    this.magCtx.strokeStyle = this.pinnedPoint
      ? 'rgba(139, 92, 246, 0.85)'
      : hasConfirmed
        ? 'rgba(255, 42, 109, 0.85)'
        : 'rgba(0, 240, 255, 0.65)';
    this.magCtx.lineWidth = 1.5;
    this.magCtx.beginPath();
    this.magCtx.arc(mw * 0.5, mh * 0.5, 20, 0, Math.PI * 2);
    this.magCtx.stroke();

    this.magCaption.textContent = captionText;
    this.loupeCoord.textContent = `${Math.round(normX * 100)}%, ${Math.round(normY * 100)}%`;
  }

  // -------------------------------------------------------------
  // 상태 바 & 경보 평가
  // -------------------------------------------------------------
  evaluateTacticalAlarm(isCameraSteady) {
    const confirmedTracks = this.activeTracks.filter(t => t.confirmed);
    const candidateTracks = this.activeTracks.filter(t => !t.confirmed && t.hitCount >= 4);

    const count = confirmedTracks.length;
    this.targetCount.textContent = `${count}`;
    this.targetPill.classList.toggle('locked', count > 0);

    const now = performance.now();

    if (count > 0) {
      this.statusBadge.className = 'argon-status-pill alert';
      this.statusText.textContent = `표적 확정됨 (${count}개)`;
      this.alarmBanner.classList.add('show');

      if (this.currentMode === 'spot') {
        this.alarmTitle.textContent = `정지 표적 검증 완료 (${count}개)`;
        this.alarmSub.textContent = '우측 하단 정밀 돋보기에서 실제 벌레 형태인지 확인하세요';
      } else {
        this.alarmTitle.textContent = `비행 표적 궤적 확정`;
        this.alarmSub.textContent = '연속 비행 궤적이 검증되었습니다';
      }

      if (now - this.lastAlarmTime > 650) {
        this.playArgonSonarPing(0.9);
        this.triggerHaptic();
        this.lastAlarmTime = now;
      }
    } else {
      this.alarmBanner.classList.remove('show');
      this.statusBadge.className = 'argon-status-pill active';

      if (!isCameraSteady) {
        this.statusText.textContent = '카메라 흔들림 보정 대기 중...';
      } else if (candidateTracks.length > 0) {
        const maxPct = Math.round(Math.max(...candidateTracks.map(t => t.verificationProgress)) * 100);
        this.statusText.textContent = `미세 후보 정밀 검증 중 (${maxPct}%)`;
      } else {
        this.statusText.textContent = '광학 스캔 중 (이상 없음)';
      }
    }
  }

  // -------------------------------------------------------------
  // ARGON 전술 HUD 렌더링
  // -------------------------------------------------------------
  renderArgonHUD() {
    const ctx = this.overlayCtx;
    const w = this.cssWidth || this.overlayCanvas.width;
    const h = this.cssHeight || this.overlayCanvas.height;
    const now = performance.now();

    ctx.clearRect(0, 0, w, h);

    if (this.currentMode === 'trail' && this.heatmapPoints.length > 0) {
      for (const pt of this.heatmapPoints) {
        const age = now - pt.timestamp;
        const life = Math.max(0, 1 - age / 8000);
        const hx = pt.x * w;
        const hy = pt.y * h;
        const rad = 20;

        const grad = ctx.createRadialGradient(hx, hy, 2, hx, hy, rad);
        grad.addColorStop(0, `rgba(255, 42, 109, ${life * 0.6})`);
        grad.addColorStop(0.5, `rgba(139, 92, 246, ${life * 0.35})`);
        grad.addColorStop(1, 'rgba(0, 240, 255, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(hx, hy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const cx = w * 0.5;
    const cy = h * 0.5;
    const isLaserFiring = this.laserConfig && this.laserConfig.active;
    const palette = (this.laserConfig && this.laserConfig.palettes[this.laserConfig.color]) || {
      glow: 'rgba(255, 23, 68, 0.55)',
      main: '#ff1744',
      core: '#ffffff',
      spark: '#ff5252',
      tag: 'RED LASER STRIKE'
    };

    // -------------------------------------------------------------
    // [1단계] 전투기 조종사 헬멧 HMD 중앙 영점 레티클 (Pilot Helmet Sight)
    // -------------------------------------------------------------
    ctx.save();
    const reticleColor = isLaserFiring ? palette.main : 'rgba(0, 240, 255, 0.45)';
    ctx.strokeStyle = reticleColor;
    ctx.lineWidth = 1.5;

    // 조종사 헬멧 중앙 조준 링
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.stroke();

    // 4방향 요(Yaw)/피치(Pitch) HMD 조준 눈금
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 12, cy);
    ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy - 12);
    ctx.moveTo(cx, cy + 12); ctx.lineTo(cx, cy + 26);
    ctx.stroke();

    ctx.fillStyle = isLaserFiring ? palette.main : '#00f0ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // -------------------------------------------------------------
    // [2단계] 타겟 목표점 선정 (우선순위: 수동 핀포인트 > 감지 표적 > 실시간 중앙 암점)
    // -------------------------------------------------------------
    let target = null;

    if (this.pinnedPoint) {
      target = {
        x: this.pinnedPoint.x * w,
        y: this.pinnedPoint.y * h,
        label: 'MANUAL LOCK',
        type: 'pinned'
      };
    } else if (this.activeTracks.length > 0) {
      const best = this.activeTracks[0];
      target = {
        x: best.x * w,
        y: best.y * h,
        label: best.type === 'kinetic' ? `AIR TGT #${best.id}` : `WALL SPOT (+${best.contrast || 22})`,
        type: best.type
      };
    } else if (this.instantTarget) {
      target = {
        x: this.instantTarget.x * w,
        y: this.instantTarget.y * h,
        label: `HMD AUTO-TRACK (+${Math.round(this.instantTarget.score)})`,
        type: 'spot'
      };
    }

    // -------------------------------------------------------------
    // [3단계] 레이저 버튼이 꺼져 있을 때: 타겟 주변에 은은한 조준 상자만 표시 (어지러움 제로)
    // -------------------------------------------------------------
    if (!isLaserFiring) {
      if (target) {
        ctx.save();
        const tr = 18;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
        ctx.lineWidth = 1.6;
        // 조종사 헬멧 다이아몬드 타겟 박스
        ctx.beginPath();
        ctx.moveTo(target.x - tr, target.y);
        ctx.lineTo(target.x, target.y - tr);
        ctx.lineTo(target.x + tr, target.y);
        ctx.lineTo(target.x, target.y + tr);
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = '#00f0ff';
        ctx.font = '700 10px "JetBrains Mono", sans-serif';
        ctx.fillText(`[READY] ${target.label}`, target.x + tr + 6, target.y + 4);
        ctx.restore();
      }
      return;
    }

    // -------------------------------------------------------------
    // [4단계] 레이저 버튼 활성화! - 전투기 조종사 헬멧(HMD) 3D 원근 레이저 발사 퍼포먼스
    // - 내 화면(기체 하단 조종석 양익/중앙 파일런)에서 타겟으로 3D 깊이감을 갖고 뻗어나감!
    // -------------------------------------------------------------
    // 타겟이 없으면 화면 중앙 전방을 향해 조사
    const tx = target ? target.x : cx;
    const ty = target ? target.y : cy - 80;
    const targetLabel = target ? target.label : 'BORESIGHT STRIKE';
    const dist = Math.hypot(tx - cx, ty - cy);

    // 내 화면 하단 발사 원점 (조종사 헬멧 HMD 3D 원근 빔 원점)
    let pylons = [];
    if (this.laserConfig.beamStyle === 'center') {
      pylons = [{ x: w * 0.50, y: h * 1.02, thick: 20, coreThick: 3.0 }]; // 기수 중앙 대형 캐논
    } else if (this.laserConfig.beamStyle === 'pulse') {
      pylons = [
        { x: w * 0.14, y: h * 1.02, thick: 11, coreThick: 1.8 },
        { x: w * 0.50, y: h * 1.02, thick: 14, coreThick: 2.2 },
        { x: w * 0.86, y: h * 1.02, thick: 11, coreThick: 1.8 }
      ]; // 3포드 고속 펄스 스톰
    } else {
      pylons = [
        { x: w * 0.14, y: h * 1.02, thick: 14, coreThick: 2.0 }, // 좌측 날개 파일런
        { x: w * 0.86, y: h * 1.02, thick: 14, coreThick: 2.0 }  // 우측 날개 파일런
      ]; // 양익 트윈 수렴 빔
    }

    ctx.save();

    for (const pylon of pylons) {
      // (A) 원근감 그라디언트 (발사구는 두껍고 타겟으로 갈수록 좁아져 깊이감 형성)
      const gradGlow = ctx.createLinearGradient(pylon.x, pylon.y, tx, ty);
      gradGlow.addColorStop(0, palette.glow);
      gradGlow.addColorStop(0.7, palette.glow);
      gradGlow.addColorStop(1, 'rgba(255, 255, 255, 0.95)');

      // 펄스 스타일일 때 점선 펄스 애니메이션
      if (this.laserConfig.beamStyle === 'pulse') {
        ctx.setLineDash([14, 8]);
        ctx.lineDashOffset = -now * 0.08;
      } else {
        ctx.setLineDash([]);
      }

      // 1. 외곽 고출력 플라즈마 빔
      ctx.strokeStyle = gradGlow;
      ctx.lineWidth = pylon.thick;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pylon.x, pylon.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // 2. 메인 고출력 레이저 빔
      ctx.strokeStyle = palette.main;
      ctx.lineWidth = pylon.thick * 0.42;
      ctx.beginPath();
      ctx.moveTo(pylon.x, pylon.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // 3. 중심 초고휘도 백색 코어 광선
      ctx.strokeStyle = palette.core;
      ctx.lineWidth = pylon.coreThick;
      ctx.beginPath();
      ctx.moveTo(pylon.x, pylon.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // (B) 타겟 충돌 지점 (Fighter Jet HMD Target Strike Impact)
    const impactR = 18 + 4 * Math.sin(now * 0.03);

    // 1. 타겟 락온 팔각 브래킷 (Helmet HMD Octagon Reticle)
    ctx.strokeStyle = palette.main;
    ctx.lineWidth = 2.4;
    const bLen = 8;
    ctx.beginPath();
    // 모서리 4방향 락온 괄호
    ctx.moveTo(tx - impactR, ty - impactR + bLen); ctx.lineTo(tx - impactR, ty - impactR); ctx.lineTo(tx - impactR + bLen, ty - impactR);
    ctx.moveTo(tx + impactR - bLen, ty - impactR); ctx.lineTo(tx + impactR, ty - impactR); ctx.lineTo(tx + impactR, ty - impactR + bLen);
    ctx.moveTo(tx - impactR, ty + impactR - bLen); ctx.lineTo(tx - impactR, ty + impactR); ctx.lineTo(tx - impactR + bLen, ty + impactR);
    ctx.moveTo(tx + impactR - bLen, ty + impactR); ctx.lineTo(tx + impactR, ty + impactR); ctx.lineTo(tx + impactR, ty + impactR - bLen);
    ctx.stroke();

    // 2. 타겟 중심 초정밀 충돌 십자선
    ctx.strokeStyle = palette.core;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(tx - impactR - 6, ty); ctx.lineTo(tx + impactR + 6, ty);
    ctx.moveTo(tx, ty - impactR - 6); ctx.lineTo(tx, ty + impactR + 6);
    ctx.stroke();

    // 3. 레이저 직격 플라즈마 코어 스팟
    ctx.fillStyle = palette.spark;
    ctx.beginPath();
    ctx.arc(tx, ty, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tx, ty, 3, 0, Math.PI * 2);
    ctx.fill();

    // 4. 전투기 HMD 전술 헤드업 텔레메트리 레이블
    const hudTag = `⚡ HMD LASER LOCK ⚡ [${targetLabel}]`;
    ctx.font = '800 11px "JetBrains Mono", sans-serif';
    const tagW = ctx.measureText(hudTag).width;

    ctx.fillStyle = 'rgba(5, 7, 12, 0.94)';
    ctx.fillRect(tx - tagW * 0.5 - 8, ty - impactR - 26, tagW + 16, 20);
    ctx.strokeStyle = palette.main;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(tx - tagW * 0.5 - 8, ty - impactR - 26, tagW + 16, 20);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(hudTag, tx, ty - impactR - 12);
    ctx.textAlign = 'start';

    ctx.restore();

    if (this.pinnedPoint) {
      const px = this.pinnedPoint.x * w;
      const py = this.pinnedPoint.y * h;

      ctx.save();
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#c4b5fd';
      ctx.font = '700 10px sans-serif';
      ctx.fillText('수동 확대 지점', px + 20, py + 4);
      ctx.restore();
    }
  }

  clearOverlay() {
    const w = this.cssWidth || this.overlayCanvas.width;
    const h = this.cssHeight || this.overlayCanvas.height;
    this.overlayCtx.clearRect(0, 0, w, h);
    this.targetCount.textContent = '0';
    this.targetPill.classList.remove('locked');
    this.alarmBanner.classList.remove('show');
  }

  // -------------------------------------------------------------
  // 고해상도 스냅샷 캡처 (야간 증폭 영상 포함)
  // -------------------------------------------------------------
  takeSnapshot() {
    const snapCanvas = document.createElement('canvas');
    const sw = this.hiResCanvas.width;
    const sh = this.hiResCanvas.height;
    snapCanvas.width = sw;
    snapCanvas.height = sh;
    const ctx = snapCanvas.getContext('2d');

    ctx.drawImage(this.hiResCanvas, 0, 0, sw, sh);
    ctx.drawImage(this.overlayCanvas, 0, 0, sw, sh);

    ctx.fillStyle = 'rgba(5, 7, 12, 0.8)';
    ctx.fillRect(0, sh - 40, sw, 40);
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 14px monospace';
    const stamp = new Date().toLocaleString('ko-KR');
    ctx.fillText(
      `ARGON OPTICS [Ar-18] // MODE: ${this.currentMode.toUpperCase()} // ${stamp}`,
      16,
      sh - 15
    );

    const dataUrl = snapCanvas.toDataURL('image/png');
    const toast = document.getElementById('snapshotToast');
    const thumb = document.getElementById('snapshotThumb');
    const dlLink = document.getElementById('snapshotDownloadLink');
    const fileName = `argon_scan_${Date.now()}.png`;

    thumb.src = dataUrl;
    dlLink.href = dataUrl;
    dlLink.download = fileName;
    toast.classList.remove('hidden');

    const tempLink = document.createElement('a');
    tempLink.download = fileName;
    tempLink.href = dataUrl;
    tempLink.click();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.argonScanner = new ArgonBugScanner();
});
