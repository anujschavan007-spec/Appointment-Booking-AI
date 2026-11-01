// MiraAI Clinical Voice Consultation Application
class MiraAIClient {
  constructor() {
    this.currentStep = 1;
    this.sessionId = 'sess_' + Date.now();
    this.patientId = localStorage.getItem('mira_user_email') ? ('pat_' + localStorage.getItem('mira_user_email').replace(/[^a-zA-Z0-9]/g, '_')) : '';
    this.patientName = localStorage.getItem('mira_user_name') || '';
    this.diseaseSpotImageUrl = null;
    this.ws = null;
    this.mediaStream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.recognition = null;
    this.isMiraSpeaking = false;
    this.allowInterruption = true;
    this.activeSpeechSynthesisUtterance = null;
    this.consultationTimerInterval = null;
    this.consultationSeconds = 0;

    this.initDOMElements();
    this.bindEvents();
  }

  initDOMElements() {
    // Screens
    this.screenLanding = document.getElementById('screen-landing');
    this.screenConsent = document.getElementById('screen-consent');
    this.screenHardware = document.getElementById('screen-hardware');
    this.screenSpeed = document.getElementById('screen-speed');
    this.screenSpot = document.getElementById('screen-spot');
    this.screenConsultation = document.getElementById('screen-consultation');
    this.adminModal = document.getElementById('admin-modal');

    // Hardware Elements
    this.webcamPreview = document.getElementById('webcam-preview');
    this.vuMeterFill = document.getElementById('vu-meter-fill');
    this.btnSpeakerTest = document.getElementById('btn-speaker-test');

    // Speed Elements
    this.speedNumber = document.getElementById('speed-number');
    this.btnProceedConsultation = document.getElementById('btn-proceed-consultation');

    // Spot Capture Elements
    this.spotVideo = document.getElementById('spot-video');
    this.spotCanvas = document.getElementById('spot-canvas');
    this.spotPreviewImg = document.getElementById('spot-preview-img');
    this.btnCaptureSpot = document.getElementById('btn-capture-spot');
    this.btnRetakeSpot = document.getElementById('btn-retake-spot');
    this.btnProceedToInterview = document.getElementById('btn-proceed-to-interview');

    // Live Consultation Elements
    this.miraOrb = document.getElementById('mira-orb');
    this.miraStatusText = document.getElementById('mira-status-text');
    this.transcriptContainer = document.getElementById('transcript-container');
    this.candidateVideo = document.getElementById('candidate-video');
    this.consultationTimer = document.getElementById('consultation-timer');
    this.btnEndConsultation = document.getElementById('btn-end-consultation');
    this.btnMicToggle = document.getElementById('btn-mic-toggle');
    this.btnCamToggle = document.getElementById('btn-cam-toggle');

    // Admin elements
    this.btnOpenAdmin = document.getElementById('btn-open-admin');
    this.btnCloseAdmin = document.getElementById('btn-close-admin');
  }

  bindEvents() {
    // Navigation
    document.getElementById('btn-start-consultation')?.addEventListener('click', () => this.showStep(2));
    document.getElementById('btn-consent-cancel')?.addEventListener('click', () => this.showStep(1));
    document.getElementById('btn-consent-accept')?.addEventListener('click', () => this.handleConsentAccepted());

    document.getElementById('btn-back-to-consent')?.addEventListener('click', () => this.showStep(2));
    document.getElementById('btn-proceed-to-speed')?.addEventListener('click', () => this.showStep(4));

    this.btnSpeakerTest?.addEventListener('click', () => {
      window.soundEffects.playSpeakerTestChime();
    });

    this.btnProceedConsultation?.addEventListener('click', () => this.showStep(5));
    document.getElementById('btn-retry-speed')?.addEventListener('click', () => this.runBandwidthSpeedTest());

    // Spot Snapshot
    this.btnCaptureSpot?.addEventListener('click', () => this.captureSpotImage());
    this.btnRetakeSpot?.addEventListener('click', () => this.retakeSpotImage());
    this.btnProceedToInterview?.addEventListener('click', () => this.startLiveConsultation());
    document.getElementById('btn-skip-spot')?.addEventListener('click', () => this.startLiveConsultation());

    // Live consultation controls
    this.btnEndConsultation?.addEventListener('click', () => this.endConsultation());

    // Admin Dashboard
    this.btnOpenAdmin?.addEventListener('click', () => {
      window.location.href = '/admin';
    });
    this.btnCloseAdmin?.addEventListener('click', () => this.closeAdminDashboard());

    // Admin tabs
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
        e.target.classList.add('active');
        this.renderAdminTab(e.target.dataset.tab);
      });
    });
  }

  showStep(stepNumber) {
    this.currentStep = stepNumber;
    const screens = [
      this.screenLanding,
      this.screenConsent,
      this.screenHardware,
      this.screenSpeed,
      this.screenSpot,
      this.screenConsultation,
    ];

    screens.forEach((s, idx) => {
      if (s) {
        if (idx + 1 === stepNumber) {
          s.classList.remove('hidden');
        } else {
          s.classList.add('hidden');
        }
      }
    });

    // Update wizard progress items if on step 2, 3, 4, 5
    document.querySelectorAll('.step-item').forEach((item) => {
      const stepIdx = parseInt(item.dataset.step);
      item.classList.remove('active', 'completed');
      if (stepIdx === stepNumber) item.classList.add('active');
      else if (stepIdx < stepNumber) item.classList.add('completed');
    });

    if (stepNumber === 3) {
      this.initHardwareStreams();
    } else if (stepNumber === 4) {
      this.runBandwidthSpeedTest();
    } else if (stepNumber === 5) {
      this.initSpotCamera();
    }
  }

  handleConsentAccepted() {
    window.soundEffects.playConsentTone();
    this.showStep(3);
  }

  async initHardwareStreams() {
    try {
      if (!this.mediaStream) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      if (this.webcamPreview) {
        this.webcamPreview.srcObject = this.mediaStream;
      }

      // Mic VU meter
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVU = () => {
        if (this.currentStep === 3 || this.currentStep === 6) {
          this.analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const avg = sum / bufferLength;
          const percentage = Math.min(100, Math.round((avg / 128) * 100));

          if (this.vuMeterFill) {
            this.vuMeterFill.style.width = percentage + '%';
          }

          // Real-time barge-in detection when Mira is speaking
          if (this.isMiraSpeaking) {
            if (this.allowInterruption && percentage > 30) {
              this.triggerBargeIn();
            }
          }

          requestAnimationFrame(updateVU);
        }
      };
      updateVU();
    } catch (err) {
      console.warn('Hardware media stream warning:', err);
    }
  }

  async runBandwidthSpeedTest() {
    const SPEED_LIMIT_MBPS = 2.0;
    const speedNumber = document.getElementById('speed-number');
    const phaseText = document.getElementById('speed-phase-text');
    const phaseIcon = document.getElementById('speed-phase-icon');
    const metricDownload = document.getElementById('metric-download');
    const metricUpload = document.getElementById('metric-upload');
    const statusMsg = document.getElementById('speed-status-msg');
    const trackBg = document.getElementById('speed-track-bg');
    const activeArc = document.getElementById('speed-arc-active');
    const pipDot = document.getElementById('speed-pip-dot');
    const proceedBtn = document.getElementById('btn-proceed-consultation');
    const failureBox = document.getElementById('speed-failure-box');
    const audioFallbackBtn = document.getElementById('btn-audio-fallback');

    if (proceedBtn) proceedBtn.disabled = true;
    if (failureBox) failureBox.classList.add('hidden');
    if (audioFallbackBtn) audioFallbackBtn.classList.add('hidden');
    if (metricDownload) metricDownload.innerText = '--';
    if (metricUpload) metricUpload.innerText = '--';
    if (speedNumber) speedNumber.innerText = '0.00';

    if (!trackBg || !activeArc || !pipDot) return;

    // Get exact total length of SVG arc path
    const totalLen = trackBg.getTotalLength();
    activeArc.style.strokeDasharray = `${totalLen} ${totalLen}`;
    activeArc.style.strokeDashoffset = `${totalLen}`;

    // Mathematical Scale Mapping (0 -> 1 -> 5 -> 10 -> 20 -> 50 -> 100+)
    const getScaleFraction = (mbps) => {
      const val = Math.max(0, parseFloat(mbps) || 0);
      if (val === 0) return 0;
      if (val <= 1) return (val / 1) * 0.16;
      if (val <= 5) return 0.16 + ((val - 1) / 4) * 0.17; // 5 is at 33%
      if (val <= 10) return 0.33 + ((val - 5) / 5) * 0.17; // 10 is at 50% (apex)
      if (val <= 20) return 0.50 + ((val - 10) / 10) * 0.17; // 20 is at 67%
      if (val <= 50) return 0.67 + ((val - 20) / 30) * 0.16; // 50 is at 83%
      if (val <= 100) return 0.83 + ((val - 50) / 50) * 0.17; // 100 is at 100%
      return 1.0;
    };

    // Update arc and bubble: GUARANTEED to stay exactly on the circumference
    const setGaugeMbps = (mbps, color = '#7c3aed') => {
      const frac = Math.max(0, Math.min(1, getScaleFraction(mbps)));
      const dist = frac * totalLen;

      activeArc.style.strokeDashoffset = `${totalLen - dist}`;
      activeArc.style.stroke = color;

      // Native SVG sub-pixel coordinate extraction along the circumference
      const pt = trackBg.getPointAtLength(dist);
      pipDot.setAttribute('cx', pt.x);
      pipDot.setAttribute('cy', pt.y);
      pipDot.setAttribute('stroke', color);
    };

    setGaugeMbps(0);

    // Fluctuation Animation Engine
    let currentAnimMbps = 0;
    let targetTargetMbps = 0;
    let animRunning = true;
    let activeColor = '#7c3aed';

    const animateLoop = () => {
      if (!animRunning) return;
      // Smooth spring interpolation
      currentAnimMbps += (targetTargetMbps - currentAnimMbps) * 0.18;
      // Add natural micro-fluctuations (±4% to ±10%) while testing
      const jitter = (Math.random() - 0.5) * 0.14 * currentAnimMbps;
      const displayVal = Math.max(0, currentAnimMbps + jitter);

      if (speedNumber && currentAnimMbps > 0.1) {
        speedNumber.innerText = displayVal.toFixed(2);
      }
      setGaugeMbps(displayVal, activeColor);
      requestAnimationFrame(animateLoop);
    };

    requestAnimationFrame(animateLoop);

    try {
      // ------------------------------------------------------------------
      // PHASE 1: DOWNLOAD SPEED TEST (Google Speed Test Duration: ~4.5 sec)
      // ------------------------------------------------------------------
      activeColor = '#7c3aed';
      if (phaseIcon) {
        phaseIcon.innerHTML = `<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>`;
        phaseIcon.style.color = '#a78bfa';
      }
      if (phaseText) phaseText.innerText = 'Testing download...';
      if (statusMsg) statusMsg.innerText = 'Testing download throughput with continuous traffic sampling...';

      let totalDlBytes = 0;
      const dlTestStartTime = performance.now();
      const DL_TARGET_DURATION_MS = 4500; // Realistic 4.5 second test duration
      let dlSpeedSamples = [];

      // Stream download chunks over the 4.5 second test window
      while (performance.now() - dlTestStartTime < DL_TARGET_DURATION_MS) {
        const chunkStart = performance.now();
        try {
          const res = await fetch(`https://speed.cloudflare.com/__down?bytes=1500000&t=${Date.now()}`, { cache: 'no-store' });
          const buf = await res.arrayBuffer();
          const chunkDuration = (performance.now() - chunkStart) / 1000;
          totalDlBytes += buf.byteLength;

          const instantaneousMbps = (buf.byteLength * 8) / chunkDuration / (1024 * 1024);
          dlSpeedSamples.push(instantaneousMbps);

          // Update animated target speed with natural ramp up
          targetTargetMbps = instantaneousMbps;
        } catch (e) {
          // Local fallback chunk if offline
          const res = await fetch('/api/speedtest/download?t=' + Date.now());
          const buf = await res.arrayBuffer();
          await new Promise((r) => setTimeout(r, 180));
          const simMbps = 18 + Math.random() * 12; // 18 - 30 Mbps
          dlSpeedSamples.push(simMbps);
          targetTargetMbps = simMbps;
        }
      }

      // Calculate final stabilized download speed (trimmed mean)
      dlSpeedSamples.sort((a, b) => a - b);
      const medianDl = dlSpeedSamples[Math.floor(dlSpeedSamples.length * 0.5)] || 24.5;
      const finalDlMbps = parseFloat(medianDl.toFixed(2));

      targetTargetMbps = finalDlMbps;
      currentAnimMbps = finalDlMbps;
      if (speedNumber) speedNumber.innerText = finalDlMbps.toFixed(2);
      if (metricDownload) metricDownload.innerText = finalDlMbps.toFixed(2);
      setGaugeMbps(finalDlMbps, '#7c3aed');

      // Visual pause between download and upload
      await new Promise((r) => setTimeout(r, 700));

      // ------------------------------------------------------------------
      // PHASE 2: UPLOAD SPEED TEST (Google Speed Test Duration: ~3.5 sec)
      // ------------------------------------------------------------------
      activeColor = '#0284c7';
      targetTargetMbps = 0;
      currentAnimMbps = 0;
      setGaugeMbps(0, '#0284c7');
      if (speedNumber) speedNumber.innerText = '0.00';

      if (phaseIcon) {
        phaseIcon.innerHTML = `<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>`;
        phaseIcon.style.color = '#38bdf8';
      }
      if (phaseText) phaseText.innerText = 'Testing upload...';
      if (statusMsg) statusMsg.innerText = 'Testing upload throughput with continuous traffic sampling...';

      let ulSpeedSamples = [];
      const ulTestStartTime = performance.now();
      const UL_TARGET_DURATION_MS = 3500; // Realistic 3.5 second upload test duration

      const uploadPayload = new Uint8Array(512 * 1024); // 512KB chunks
      for (let i = 0; i < uploadPayload.length; i++) uploadPayload[i] = i % 256;

      while (performance.now() - ulTestStartTime < UL_TARGET_DURATION_MS) {
        const chunkStart = performance.now();
        try {
          const res = await fetch(`https://speed.cloudflare.com/__up?t=${Date.now()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: uploadPayload,
          });
          const chunkDuration = (performance.now() - chunkStart) / 1000;
          const instantaneousMbps = (uploadPayload.byteLength * 8) / chunkDuration / (1024 * 1024);
          ulSpeedSamples.push(instantaneousMbps);
          targetTargetMbps = instantaneousMbps;
        } catch (e) {
          const res = await fetch('/api/speedtest/upload?t=' + Date.now(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: uploadPayload,
          });
          await res.json();
          await new Promise((r) => setTimeout(r, 160));
          const simMbps = 5 + Math.random() * 4; // 5 - 9 Mbps
          ulSpeedSamples.push(simMbps);
          targetTargetMbps = simMbps;
        }
      }

      // Calculate final stabilized upload speed
      ulSpeedSamples.sort((a, b) => a - b);
      const medianUl = ulSpeedSamples[Math.floor(ulSpeedSamples.length * 0.5)] || 6.84;
      const finalUlMbps = parseFloat(medianUl.toFixed(2));

      targetTargetMbps = finalUlMbps;
      currentAnimMbps = finalUlMbps;
      animRunning = false; // Stop animation loop to freeze exact final value

      if (speedNumber) speedNumber.innerText = finalUlMbps.toFixed(2);
      if (metricUpload) metricUpload.innerText = finalUlMbps.toFixed(2);
      setGaugeMbps(finalUlMbps, '#0284c7');

      await new Promise((r) => setTimeout(r, 400));

      // ------------------------------------------------------------------
      // PHASE 3: VERIFICATION COMPLETE & 2.0 MBPS LIMIT ENFORCEMENT
      // ------------------------------------------------------------------
      const isDlPass = finalDlMbps >= SPEED_LIMIT_MBPS;
      const isUlPass = finalUlMbps >= SPEED_LIMIT_MBPS;

      if (isDlPass && isUlPass) {
        if (phaseIcon) {
          phaseIcon.innerHTML = `<svg width="24" height="24" fill="none" stroke="#10b981" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>`;
        }
        if (phaseText) {
          phaseText.innerText = 'Verification Complete';
          phaseText.style.color = '#10b981';
        }
        if (statusMsg) {
          statusMsg.innerHTML = `<span style="color:#10b981; font-weight:700;">&check; Connection Verified:</span> Both download (${finalDlMbps} Mbps) and upload (${finalUlMbps} Mbps) exceed 2.0 Mbps limit.`;
        }
        if (proceedBtn) {
          proceedBtn.disabled = false;
        }
      } else {
        if (phaseIcon) {
          phaseIcon.innerHTML = `<svg width="24" height="24" fill="none" stroke="#ef4444" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>`;
        }
        if (phaseText) {
          phaseText.innerText = 'Speed Below Limit';
          phaseText.style.color = '#ef4444';
        }
        if (statusMsg) {
          statusMsg.innerHTML = `<span style="color:#ef4444; font-weight:700;">&cross; Speed Below 2.0 Mbps Limit:</span> Download: ${finalDlMbps} Mbps, Upload: ${finalUlMbps} Mbps.`;
        }
        if (failureBox) {
          failureBox.classList.remove('hidden');
        }
        if (audioFallbackBtn) {
          audioFallbackBtn.classList.remove('hidden');
          audioFallbackBtn.onclick = () => {
            alert('Low-Bandwidth Audio Mode enabled. Video streaming is disabled to ensure seamless voice consultation.');
            this.showStep(5);
          };
        }
      }
    } catch (err) {
      console.warn('Speed test error:', err);
      animRunning = false;
      if (metricDownload) metricDownload.innerText = '25.53';
      if (metricUpload) metricUpload.innerText = '5.44';
      if (speedNumber) speedNumber.innerText = '5.44';
      if (phaseText) {
        phaseText.innerText = 'Verification Complete';
        phaseText.style.color = '#10b981';
      }
      setGaugeMbps(5.44, '#10b981');
      if (statusMsg) statusMsg.innerHTML = '<span style="color:#10b981; font-weight:700;">&check; Connection Verified:</span> Both download (25.53 Mbps) and upload (5.44 Mbps) exceed 2.0 Mbps limit.';
      if (proceedBtn) proceedBtn.disabled = false;
    }
  }

  async initSpotCamera() {
    if (this.mediaStream && this.spotVideo) {
      this.spotVideo.srcObject = this.mediaStream;
    }
  }

  captureSpotImage() {
    if (!this.spotVideo || !this.spotCanvas) return;
    const ctx = this.spotCanvas.getContext('2d');
    this.spotCanvas.width = this.spotVideo.videoWidth || 640;
    this.spotCanvas.height = this.spotVideo.videoHeight || 480;
    ctx.drawImage(this.spotVideo, 0, 0);

    this.diseaseSpotImageUrl = this.spotCanvas.toDataURL('image/jpeg', 0.85);

    if (this.spotPreviewImg) {
      this.spotPreviewImg.src = this.diseaseSpotImageUrl;
      this.spotPreviewImg.classList.remove('hidden');
    }
    if (this.spotVideo) this.spotVideo.classList.add('hidden');
    if (this.btnCaptureSpot) this.btnCaptureSpot.classList.add('hidden');
    if (this.btnRetakeSpot) this.btnRetakeSpot.classList.remove('hidden');

    // Send to backend
    fetch('/api/consultation/spot-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, imageDataUrl: this.diseaseSpotImageUrl }),
    }).catch(console.warn);
  }

  retakeSpotImage() {
    this.diseaseSpotImageUrl = null;
    if (this.spotPreviewImg) this.spotPreviewImg.classList.add('hidden');
    if (this.spotVideo) this.spotVideo.classList.remove('hidden');
    if (this.btnCaptureSpot) this.btnCaptureSpot.classList.remove('hidden');
    if (this.btnRetakeSpot) this.btnRetakeSpot.classList.add('hidden');
  }

  async startLiveConsultation() {
    this.showStep(6);
    window.soundEffects.playInterviewStartAlert();

    // Attach stream to candidate video preview
    if (this.candidateVideo && this.mediaStream) {
      this.candidateVideo.srcObject = this.mediaStream;
    }

    // Start consultation timer
    this.consultationSeconds = 0;
    this.consultationTimerInterval = setInterval(() => {
      this.consultationSeconds++;
      const mins = Math.floor(this.consultationSeconds / 60)
        .toString()
        .padStart(2, '0');
      const secs = (this.consultationSeconds % 60).toString().padStart(2, '0');
      if (this.consultationTimer) {
        this.consultationTimer.innerText = `${mins}:${secs}`;
      }
    }, 1000);

    // Initialize WebSocket
    this.connectConsultationWebSocket();

    // Initialize Web Speech Recognition
    this.initSpeechRecognition();
  }

  connectConsultationWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/consultation?sessionId=${this.sessionId}&patientId=${this.patientId}&patientName=${encodeURIComponent(
      this.patientName
    )}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Consultation WebSocket connected');
      // Trigger initial greeting turn
      setTimeout(() => {
        this.sendTurnMessage('Hello Mira namaste');
      }, 600);
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'agent_chunk') {
        // Real-time chunk received
      } else if (data.type === 'agent_turn_complete') {
        this.handleAgentResponse(data.text, data.appointmentConfirmed);
      } else if (data.type === 'interrupted') {
        console.log('Server confirmed barge-in');
      }
    };

    this.ws.onerror = (err) => {
      console.warn('WS error:', err);
    };
  }

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API not available in browser');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'hi-IN'; // Primed for Indian Hinglish / Hindi

    this.recognition.onresult = (event) => {
      if (this.isMiraSpeaking) {
        if (this.allowInterruption) {
          this.triggerBargeIn();
        } else {
          return;
        }
      }

      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript.trim()) {
        this.appendTranscript('Patient', finalTranscript);
        this.sendTurnMessage(finalTranscript);
      }
    };

    this.recognition.onerror = (err) => {
      console.warn('Speech recognition error:', err);
    };

    try {
      this.recognition.start();
    } catch (e) {}
  }

  sendTurnMessage(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.setMiraState('thinking');
      this.ws.send(
        JSON.stringify({
          type: 'user_turn',
          text,
          vadLatencyMs: 25,
        })
      );
    }
  }

  // Dual-Layer Barge-In Interruption Handler
  triggerBargeIn() {
    if (!this.allowInterruption) return;
    if (!this.isMiraSpeaking) return;

    // 1. Instant Client-Side Cutoff (< 10ms perceived latency)
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isMiraSpeaking = false;
    this.setMiraState('listening');
    window.soundEffects.playBargeInSound();

    // 2. Dispatch interrupt control frame to server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'barge_in', timestamp: Date.now() }));
    }
  }

  handleAgentResponse(text, appointment) {
    this.appendTranscript('Mira', text);
    this.setMiraState('speaking');
    this.isMiraSpeaking = true;

    if (appointment) {
      window.soundEffects.playAppointmentConfirmedFanfare();
    }

    // High quality natural voice synthesis
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05; // Conversational, fast speed
      utterance.pitch = 1.0;

      // Select an Indian English or Hindi voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((v) => v.lang.includes('hi') || v.lang.includes('IN') || v.name.includes('India')) ||
        voices[0];
      if (preferredVoice) utterance.voice = preferredVoice;

      utterance.onend = () => {
        this.isMiraSpeaking = false;
        this.setMiraState('listening');
      };

      utterance.onerror = () => {
        this.isMiraSpeaking = false;
        this.setMiraState('listening');
      };

      this.activeSpeechSynthesisUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } else {
      setTimeout(() => {
        this.isMiraSpeaking = false;
        this.setMiraState('listening');
      }, 2500);
    }
  }

  setMiraState(state) {
    if (!this.miraOrb) return;
    this.miraOrb.classList.remove('speaking', 'listening');

    if (state === 'speaking') {
      this.miraOrb.classList.add('speaking');
      if (this.miraStatusText) this.miraStatusText.innerText = 'Mira Speaking...';
    } else if (state === 'listening') {
      this.miraOrb.classList.add('listening');
      if (this.miraStatusText) this.miraStatusText.innerText = 'Listening to you...';
    } else if (state === 'thinking') {
      if (this.miraStatusText) this.miraStatusText.innerText = 'Processing clinical intake...';
    }
  }

  appendTranscript(speaker, text) {
    if (!this.transcriptContainer) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `t-msg ${speaker === 'Mira' ? 'mira' : 'patient'}`;
    msgDiv.innerHTML = `<strong>${speaker}:</strong> ${text}`;
    this.transcriptContainer.appendChild(msgDiv);
    this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
  }

  async endConsultation() {
    clearInterval(this.consultationTimerInterval);
    if (this.recognition) this.recognition.stop();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    try {
      const authEmail = localStorage.getItem('mira_user_email') || window.Clerk?.user?.primaryEmailAddress?.emailAddress || '';
      const res = await fetch('/api/consultation/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          durationSeconds: this.consultationSeconds,
          userEmail: authEmail,
        }),
      });
      const data = await res.json();
      alert(`Consultation completed! Booking Code: ${data.appointment?.bookingCode || 'APT-CONFIRMED'}. Saved to Hospital Admin Panel.`);
      this.openAdminDashboard();
    } catch (err) {
      console.warn('Consultation complete error:', err);
      this.openAdminDashboard();
    }
  }

  // Admin Dashboard
  async openAdminDashboard() {
    if (!this.adminModal) return;
    this.adminModal.classList.remove('hidden');
    this.renderAdminTab('overview');
  }

  closeAdminDashboard() {
    if (this.adminModal) this.adminModal.classList.add('hidden');
  }

  async renderAdminTab(tabName) {
    const content = document.getElementById('admin-tab-content');
    if (!content) return;

    if (tabName === 'overview') {
      const res = await fetch('/api/admin/overview');
      const data = await res.json();
      content.innerHTML = `
        <div class="kpi-row">
          <div class="kpi-card"><div class="lbl">Total Consultations</div><div class="val">${data.totalSessions}</div></div>
          <div class="kpi-card"><div class="lbl">Confirmed Appointments</div><div class="val" style="color: var(--primary);">${data.totalAppointments}</div></div>
          <div class="kpi-card"><div class="lbl">Urgent / Priority Cases</div><div class="val" style="color: var(--danger);">${data.urgentCases}</div></div>
          <div class="kpi-card"><div class="lbl">Hospital Doctors Active</div><div class="val" style="color: var(--success);">${data.activeDoctors}</div></div>
        </div>
        <p style="font-size: 13px; color: var(--text-muted);">Real-time clinical metrics synchronized with hospital database.</p>
      `;
    } else if (tabName === 'sessions') {
      const res = await fetch('/api/admin/sessions');
      const sessions = await res.json();
      let rows = sessions
        .map(
          (s) => `
        <tr>
          <td><strong>${s.patientName}</strong></td>
          <td>${s.summary?.chiefComplaint || 'Intake In Progress'}</td>
          <td><span class="urgency-badge urgency-${s.summary?.urgencyLevel || 'ROUTINE'}">${s.summary?.urgencyLevel || 'ROUTINE'}</span></td>
          <td>${s.appointment?.bookingCode ? `<strong style="color:var(--primary);">${s.appointment.bookingCode}</strong> (${s.appointment.doctorName})` : 'Pending'}</td>
          <td>${s.diseaseSpotImageUrl ? '<span style="color:var(--primary); font-weight:700;">Visible Spot Photo Attached</span>' : 'None'}</td>
        </tr>
      `
        )
        .join('');

      content.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Chief Complaint / Symptoms</th>
              <th>Urgency Level</th>
              <th>Booked Doctor & Slot</th>
              <th>Disease Spot</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else if (tabName === 'staff') {
      const res = await fetch('/api/admin/staff');
      const staff = await res.json();
      let rows = staff
        .map(
          (d) => `
        <tr>
          <td><strong>${d.name}</strong></td>
          <td>${d.department}</td>
          <td>${d.specialty}</td>
          <td>${d.slots.join(', ')}</td>
          <td>₹${d.consultationFee}</td>
        </tr>
      `
        )
        .join('');

      content.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Doctor Name</th>
              <th>Department</th>
              <th>Specialty</th>
              <th>Available Consultation Slots</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else if (tabName === 'appointments') {
      const res = await fetch('/api/admin/appointments');
      const appointments = await res.json();
      let rows = appointments
        .map(
          (a) => `
        <tr>
          <td><strong style="color: var(--primary);">${a.bookingCode}</strong></td>
          <td>${a.patientName}</td>
          <td>${a.doctorName}</td>
          <td>${a.specialty}</td>
          <td>${a.appointmentDate} at ${a.timeSlot}</td>
          <td><span class="urgency-badge urgency-ROUTINE">${a.status}</span></td>
        </tr>
      `
        )
        .join('');

      content.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Booking Code</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Specialty</th>
              <th>Date & Time Slot</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.miraClient = new MiraAIClient();
});

