'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const video = $('sourceVideo');
  const canvas = $('previewCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const placeholder = $('previewPlaceholder');
  const state = {
    stream: null, opening: false, cameraOn: false, aiModel: null, aiLoading: false,
    aiOn: false, detecting: false, lastDetectAt: 0, lastDetection: null,
    cropCenterX: 0.5, cropCenterY: 0.5, targetX: 0.5, targetY: 0.5,
    lastBallX: null, lastBallY: null, lastBallTime: 0, velocityX: 0, velocityY: 0,
    zoom: 1, mode: 'full', raf: 0, timer: null, clockStart: 0, elapsedMs: 0,
    clockRunning: false, events: [], homeScore: 0, awayScore: 0,
    recorder: null, chunks: [], recordStartedAt: 0, wakeLock: null, lastError: 'None'
  };
  const OUT_W = 1280, OUT_H = 720;

  function setStatus(title, message, kind = 'normal') {
    $('cameraStatusTitle').textContent = title;
    $('cameraStatusText').textContent = message;
    $('statusDot').className = 'status-dot' + (kind === 'good' ? ' good' : kind === 'bad' ? ' bad' : '');
  }
  function setError(name, message) {
    state.lastError = name || 'UnknownError';
    $('diagError').textContent = `${state.lastError}: ${message || 'No additional details'}`;
    $('retryCameraBtn').hidden = false;
    setStatus('Camera could not start', message || 'Please check the camera permission and retry.', 'bad');
  }
  function refreshEnvironmentDiagnostics() {
    const secure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    $('diagSecure').textContent = secure ? 'Yes' : 'No — HTTPS required';
    $('diagApi').textContent = navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' ? 'Available' : 'Unavailable';
    if (!secure) {
      setStatus('Secure connection required', 'Open the deployed HTTPS link in Chrome. Camera access is blocked on ordinary file:// pages and insecure network URLs.', 'bad');
      $('startCameraBtn').disabled = true;
    } else if (!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')) {
      setStatus('Browser does not expose camera API', 'Open the public HTTPS app directly in Chrome on your phone, not inside a preview frame or editor.', 'bad');
      $('startCameraBtn').disabled = true;
    }
  }
  async function refreshPermissionDiagnostic() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      const p = await navigator.permissions.query({ name: 'camera' });
      $('diagPermission').textContent = p.state;
      p.onchange = () => { $('diagPermission').textContent = p.state; };
    } catch (_) { $('diagPermission').textContent = 'Use Start Camera to request'; }
  }
  function explainCameraError(err) {
    const name = err && err.name ? err.name : 'UnknownError';
    const messages = {
      NotAllowedError: 'Camera permission was denied or blocked. In Chrome, open Site settings → Camera → Allow, then retry. Also check Android Settings → Apps → Chrome → Permissions → Camera.',
      PermissionDeniedError: 'Camera permission was denied. Allow camera access in Chrome site settings and retry.',
      NotFoundError: 'No usable camera was found. Close other camera apps and check Android camera permission.',
      DevicesNotFoundError: 'No camera device is available to this browser.',
      NotReadableError: 'The camera is already in use or Android could not open it. Close the Camera app and other apps using the camera, then retry.',
      TrackStartError: 'Android could not start the camera. Close other camera apps and retry.',
      OverconstrainedError: 'The requested camera settings are not supported. The app will retry with simpler settings.',
      ConstraintNotSatisfiedError: 'The requested camera settings are not supported. Try again with default settings.',
      SecurityError: 'The browser blocked camera access for security reasons. Use the public HTTPS link in Chrome.',
      AbortError: 'The camera start was interrupted. Retry after a moment.'
    };
    return { name, message: messages[name] || `Camera error (${name}). Refresh the page, allow camera access, close other camera apps and retry. ${err && err.message ? err.message : ''}`.trim() };
  }
  function setCameraUi(on) {
    state.cameraOn = on;
    $('startCameraBtn').disabled = on || state.opening;
    $('retryCameraBtn').hidden = on;
    $('stopCameraBtn').disabled = !on;
    $('enableAiBtn').disabled = !on || state.aiOn || state.aiLoading;
    $('recordStartBtn').disabled = !on || !!state.recorder;
    $('liveBadge').textContent = on ? 'CAMERA LIVE' : 'CAMERA OFF';
    $('liveBadge').className = 'badge ' + (on ? 'badge-on' : 'badge-off');
    placeholder.classList.toggle('hidden', on);
    canvas.style.display = on ? 'block' : 'none';
    $('previewOverlay').style.display = on ? 'flex' : 'none';
    if (on) $('stopCameraBtn').disabled = false;
  }
  function waitForMetadata(targetVideo, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      if (targetVideo.readyState >= 1 && targetVideo.videoWidth) { resolve(); return; }
      const timeout = setTimeout(() => cleanup(() => reject(new Error('Timed out waiting for camera metadata.'))), timeoutMs);
      const onLoaded = () => cleanup(resolve);
      const onError = () => cleanup(() => reject(new Error('Video element reported a playback error.')));
      function cleanup(done) { clearTimeout(timeout); targetVideo.removeEventListener('loadedmetadata', onLoaded); targetVideo.removeEventListener('error', onError); done(); }
      targetVideo.addEventListener('loadedmetadata', onLoaded, { once: true });
      targetVideo.addEventListener('error', onError, { once: true });
    });
  }
  async function requestStream() {
    const options = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false }
    ];
    let last;
    for (const constraints of options) {
      try { return await navigator.mediaDevices.getUserMedia(constraints); }
      catch (e) { last = e; if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError' || e.name === 'SecurityError')) throw e; }
    }
    throw last || new Error('Unable to open a camera stream.');
  }
  async function startCamera() {
    if (state.opening || state.cameraOn) return;
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      setError('SecurityError', 'HTTPS is required for phone camera access. Open the app using its public https:// address.'); return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setError('NotSupportedError', 'This page has no camera API. Use current Chrome and open the app directly, not in an embedded preview.'); return;
    }
    state.opening = true;
    $('startCameraBtn').disabled = true; $('retryCameraBtn').hidden = true;
    $('diagPermission').textContent = 'Prompting / checking';
    setStatus('Requesting camera permission', 'Choose Allow when Chrome asks. AI loads separately after the preview starts.');
    let stream;
    try {
      // This function is called directly by the Start Camera user gesture.
      stream = await requestStream();
      state.stream = stream;
      video.autoplay = true; video.muted = true; video.playsInline = true;
      video.setAttribute('autoplay', ''); video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
      video.srcObject = stream;
      await waitForMetadata(video);
      try { await video.play(); } catch (playErr) {
        // Some browsers reject the first play until the user taps again; retry explicitly.
        setStatus('Camera permission granted — starting preview', 'Tap the preview or Start Camera again if playback does not begin.');
        try { await video.play(); } catch (_) { throw Object.assign(new Error('Camera opened but video playback was blocked. Tap the preview to play, or close/reopen this page.'), { name: 'PlaybackBlockedError' }); }
      }
      if (!video.videoWidth || !video.videoHeight) throw Object.assign(new Error('Camera stream opened but no video frames arrived.'), { name: 'NoFramesError' });
      $('diagPermission').textContent = 'Granted';
      $('diagStream').textContent = 'Live';
      $('diagResolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
      setCameraUi(true); startRenderLoop();
      setStatus('Camera is live', 'Preview started. The AI model will not be allowed to block recording or camera use.', 'good');
      $('recordStatus').textContent = 'Ready. Tap Start Recording for a short test clip first.';
      await requestWakeLock();
      refreshPermissionDiagnostic();
    } catch (err) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (state.stream) state.stream.getTracks().forEach(t => t.stop());
      state.stream = null; video.srcObject = null;
      $('diagStream').textContent = 'Stopped'; $('diagResolution').textContent = '—';
      const info = err && err.name === 'PlaybackBlockedError' ? { name: err.name, message: err.message } : explainCameraError(err);
      setError(info.name, info.message);
      $('diagPermission').textContent = info.name === 'NotAllowedError' ? 'Denied / blocked' : $('diagPermission').textContent;
    } finally {
      state.opening = false;
      if (!state.cameraOn) $('startCameraBtn').disabled = false;
      $('enableAiBtn').disabled = !state.cameraOn || state.aiOn || state.aiLoading;
    }
  }
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { state.wakeLock = null; }
  }
  async function stopCamera() {
    stopRecording();
    state.aiOn = false; state.lastDetection = null;
    if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0;
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    state.stream = null; video.pause(); video.srcObject = null;
    if (state.wakeLock) { try { await state.wakeLock.release(); } catch (_) {} state.wakeLock = null; }
    $('diagStream').textContent = 'Stopped'; $('diagResolution').textContent = '—';
    $('aiOverlay').textContent = 'AI OFF'; $('trackingMetric').textContent = 'OFF'; $('confidenceMetric').textContent = '—';
    $('enableAiBtn').textContent = 'Enable experimental ball AI'; $('aiStatus').textContent = 'AI is optional. Camera preview and recording should work even if the AI model cannot download.';
    setCameraUi(false); setStatus('Camera stopped', 'Tap Start Camera whenever you are ready to open the rear camera.');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function cropDimensions() {
    const vw = video.videoWidth || OUT_W, vh = video.videoHeight || OUT_H;
    const baseW = Math.min(vw, vh * (OUT_W / OUT_H));
    const baseH = baseW / (OUT_W / OUT_H);
    const cropW = Math.min(vw, baseW / state.zoom);
    const cropH = Math.min(vh, cropW / (OUT_W / OUT_H));
    let x = state.cropCenterX * vw - cropW / 2;
    let y = state.cropCenterY * vh - cropH / 2;
    x = Math.max(0, Math.min(vw - cropW, x)); y = Math.max(0, Math.min(vh - cropH, y));
    return { vw, vh, cropW, cropH, x, y };
  }
  function startRenderLoop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    const draw = () => {
      if (!state.cameraOn || video.readyState < 2 || !video.videoWidth) { state.raf = requestAnimationFrame(draw); return; }
      // Smooth the crop movement so predictions do not jerk the displayed frame.
      if (state.aiOn && state.lastDetection) {
        const predictedX = Math.max(0.03, Math.min(0.97, state.targetX + state.velocityX * 0.14));
        const predictedY = Math.max(0.03, Math.min(0.97, state.targetY + state.velocityY * 0.14));
        state.cropCenterX += (predictedX - state.cropCenterX) * 0.12;
        state.cropCenterY += (predictedY - state.cropCenterY) * 0.12;
      }
      const c = cropDimensions();
      try { ctx.drawImage(video, c.x, c.y, c.cropW, c.cropH, 0, 0, OUT_W, OUT_H); } catch (_) {}
      if (state.lastDetection) {
        const b = state.lastDetection.bbox;
        const bx = (b[0] - c.x) / c.cropW * OUT_W;
        const by = (b[1] - c.y) / c.cropH * OUT_H;
        const bw = b[2] / c.cropW * OUT_W;
        const bh = b[3] / c.cropH * OUT_H;
        if (bx + bw > 0 && by + bh > 0 && bx < OUT_W && by < OUT_H) {
          ctx.strokeStyle = '#58d5a4'; ctx.lineWidth = 4; ctx.strokeRect(bx, by, bw, bh);
          ctx.fillStyle = '#58d5a4'; ctx.fillRect(bx, Math.max(0, by - 30), Math.min(220, bw + 16), 28);
          ctx.fillStyle = '#06160f'; ctx.font = 'bold 18px system-ui'; ctx.fillText(`BALL ${Math.round(state.lastDetection.score * 100)}%`, bx + 7, Math.max(19, by - 10));
        }
      }
      $('overlayMode').textContent = state.mode === 'ai' ? 'AI FOLLOW' : 'FULL PITCH';
      $('aiOverlay').textContent = state.aiOn ? 'AI ON' : 'AI OFF';
      $('zoomValue').textContent = `${state.zoom.toFixed(1)}×`;
      state.raf = requestAnimationFrame(draw);
    };
    state.raf = requestAnimationFrame(draw);
  }
  async function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src; script.async = true;
      script.onload = resolve; script.onerror = () => reject(new Error('Could not download AI library. Check your internet connection and try again.'));
      document.head.appendChild(script);
    });
  }
  async function enableAI() {
    if (!state.cameraOn || state.aiOn || state.aiLoading) return;
    state.aiLoading = true; $('enableAiBtn').disabled = true; $('enableAiBtn').textContent = 'Loading AI…';
    $('aiStatus').textContent = 'Loading optional AI model. Your camera preview should remain live during this step.';
    try {
      if (!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
      if (!window.cocoSsd) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
      state.aiModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
      state.aiOn = true; state.mode = 'ai'; state.lastDetectAt = 0;
      $('aiStatus').textContent = 'AI model loaded. Ball detection is experimental; distant footballs may be missed.';
      $('trackingMetric').textContent = 'SEARCHING'; $('enableAiBtn').textContent = 'AI Follow enabled';
      $('fullPitchBtn').classList.remove('active'); $('aiFollowBtn').classList.add('active');
      $('fullPitchBtn').setAttribute('aria-pressed', 'false'); $('aiFollowBtn').setAttribute('aria-pressed', 'true');
      detectionLoop();
    } catch (err) {
      state.aiOn = false; $('aiStatus').textContent = `AI unavailable: ${err.message || 'model loading failed'}. Camera preview and manual framing remain available.`;
      $('enableAiBtn').textContent = 'Retry AI model'; $('enableAiBtn').disabled = false;
      $('trackingMetric').textContent = 'AI UNAVAILABLE'; $('aiOverlay').textContent = 'AI OFF';
    } finally { state.aiLoading = false; if (state.cameraOn && !state.aiOn) $('enableAiBtn').disabled = false; }
  }
  async function detectionLoop() {
    if (!state.aiOn || !state.aiModel || !state.cameraOn || state.detecting) return;
    const now = performance.now();
    if (now - state.lastDetectAt < 650) { setTimeout(detectionLoop, 120); return; }
    state.lastDetectAt = now; state.detecting = true;
    try {
      const predictions = await state.aiModel.detect(video, 12, 0.25);
      const balls = predictions.filter(p => p.class === 'sports ball' && p.score >= 0.25).sort((a,b) => b.score-a.score);
      if (balls.length) {
        const ball = balls[0], [x,y,w,h] = ball.bbox;
        const nx = (x + w/2) / video.videoWidth, ny = (y + h/2) / video.videoHeight;
        const t = performance.now();
        if (state.lastBallX !== null && t > state.lastBallTime) {
          const dt = Math.max(0.05, (t - state.lastBallTime) / 1000);
          state.velocityX = Math.max(-1.6, Math.min(1.6, (nx - state.lastBallX) / dt));
          state.velocityY = Math.max(-1.6, Math.min(1.6, (ny - state.lastBallY) / dt));
          $('directionMetric').textContent = Math.abs(state.velocityX) > Math.abs(state.velocityY) ? (state.velocityX > 0 ? 'RIGHT →' : '← LEFT') : (state.velocityY > 0 ? 'DOWN ↓' : '↑ UP');
        }
        state.lastBallX = nx; state.lastBallY = ny; state.lastBallTime = t;
        // Smooth position and let a little prediction lead the crop.
        state.targetX = state.targetX * 0.55 + nx * 0.45;
        state.targetY = state.targetY * 0.55 + ny * 0.45;
        state.lastDetection = { bbox: ball.bbox, score: ball.score };
        $('trackingMetric').textContent = 'LOCKED'; $('confidenceMetric').textContent = `${Math.round(ball.score*100)}%`;
        $('aiStatus').textContent = 'Ball candidate detected. Tracking is experimental; inspect the preview for false detections.';
      } else {
        if (state.lastBallTime && now - state.lastBallTime > 1800) {
          state.lastDetection = null; state.velocityX *= 0.7; state.velocityY *= 0.7;
          $('trackingMetric').textContent = 'SEARCHING'; $('confidenceMetric').textContent = '—';
          $('aiStatus').textContent = 'Ball not currently detected. Holding the last stable view.';
        }
      }
    } catch (err) {
      state.aiOn = false; state.lastDetection = null; $('trackingMetric').textContent = 'AI ERROR';
      $('aiStatus').textContent = `AI stopped: ${err.message || 'detection failed'}. Camera remains active; you can use manual framing or retry AI.`;
      $('enableAiBtn').textContent = 'Retry AI model'; $('enableAiBtn').disabled = false; $('aiOverlay').textContent = 'AI OFF';
    } finally { state.detecting = false; if (state.aiOn) setTimeout(detectionLoop, 100); }
  }
  function setMode(mode) {
    state.mode = mode;
    if (mode === 'full') { state.aiOn = false; state.lastDetection = null; $('trackingMetric').textContent = 'OFF'; $('aiOverlay').textContent = 'AI OFF'; }
    $('fullPitchBtn').classList.toggle('active', mode === 'full'); $('aiFollowBtn').classList.toggle('active', mode === 'ai');
    $('fullPitchBtn').setAttribute('aria-pressed', String(mode === 'full')); $('aiFollowBtn').setAttribute('aria-pressed', String(mode === 'ai'));
    if (mode === 'full') { state.zoom = Math.min(state.zoom, 1.1); $('zoomRange').value = String(state.zoom); state.cropCenterX = 0.5; state.cropCenterY = 0.5; }
    else if (!state.aiModel) $('aiStatus').textContent = 'Tap Enable experimental ball AI to load the optional model. Manual digital framing still works.';
    $('enableAiBtn').disabled = !state.cameraOn || state.aiLoading || state.aiOn;
    $('enableAiBtn').textContent = state.aiOn ? 'AI Follow enabled' : 'Enable experimental ball AI';
  }
  function manualMove(dx, dy) {
    state.cropCenterX = Math.max(0.02, Math.min(0.98, state.cropCenterX + dx / state.zoom));
    state.cropCenterY = Math.max(0.02, Math.min(0.98, state.cropCenterY + dy / state.zoom));
    state.targetX = state.cropCenterX; state.targetY = state.cropCenterY;
    if (state.mode === 'ai') state.aiOn = false;
    state.lastDetection = null; $('trackingMetric').textContent = 'MANUAL'; $('aiOverlay').textContent = state.aiOn ? 'AI ON' : 'MANUAL';
    $('enableAiBtn').disabled = !state.cameraOn || state.aiLoading; $('enableAiBtn').textContent = 'Enable experimental ball AI';
    $('aiStatus').textContent = 'Manual digital framing is active. Enable AI again when ready; camera preview remains on.';
  }
  function clockSeconds() { return Math.floor((state.elapsedMs + (state.clockRunning ? performance.now() - state.clockStart : 0)) / 1000); }
  function renderClock() {
    const seconds = clockSeconds();
    $('matchClock').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  }
  function startClock() {
    if (state.clockRunning) { state.elapsedMs += performance.now() - state.clockStart; state.clockRunning = false; $('clockStartBtn').textContent = 'Resume'; }
    else { state.clockStart = performance.now(); state.clockRunning = true; $('clockStartBtn').textContent = 'Pause'; if (!state.timer) state.timer = setInterval(renderClock, 250); }
    renderClock();
  }
  function addEvent(type) {
    const seconds = clockSeconds();
    const item = { type, seconds, time: `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`, iso: new Date().toISOString() };
    state.events.unshift(item); renderEvents();
  }
  function renderEvents() {
    const list = $('eventsList'); list.innerHTML = '';
    if (!state.events.length) { const li = document.createElement('li'); li.className = 'empty-events'; li.textContent = 'No events yet. Add one during the match.'; list.appendChild(li); return; }
    state.events.forEach(ev => { const li = document.createElement('li'); const time = document.createElement('span'); time.className='event-time'; time.textContent=ev.time; const name=document.createElement('span'); name.className='event-name'; name.textContent=ev.type; const meta=document.createElement('span'); meta.className='event-meta'; meta.textContent=ev.iso.slice(11,16); li.append(time,name,meta); list.appendChild(li); });
  }
  function updateScore() { $('homeScore').textContent = state.homeScore; $('awayScore').textContent = state.awayScore; $('homeNameLabel').textContent = $('homeName').value.trim() || 'HOME'; $('awayNameLabel').textContent = $('awayName').value.trim() || 'AWAY'; }
  function exportCsv() {
    const quote = v => `"${String(v).replaceAll('"','""')}"`;
    const rows = [['time','event','timestamp'], ...state.events.slice().reverse().map(e => [e.time,e.type,e.iso])];
    const blob = new Blob([rows.map(r=>r.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
    downloadBlob(blob, `ti-eye-events-${new Date().toISOString().slice(0,10)}.csv`);
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.style.display='none'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 30000);
  }
  function mimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t)) || '';
  }
  async function startRecording() {
    if (!state.cameraOn || state.recorder) return;
    if (!window.MediaRecorder) { $('recordStatus').textContent = 'This browser does not support MediaRecorder. Camera preview remains available; try current Chrome.'; return; }
    if (!canvas.captureStream) { $('recordStatus').textContent = 'Canvas recording is not supported by this browser. Camera preview remains available.'; return; }
    let outputStream = null;
    try {
      const stream = canvas.captureStream(25); outputStream = stream; const type = mimeType();
      const recorder = type ? new MediaRecorder(stream, {mimeType:type, videoBitsPerSecond:3500000}) : new MediaRecorder(stream);
      state.chunks = []; state.recorder = recorder; state.recordStartedAt = Date.now();
      recorder.ondataavailable = e => { if (e.data && e.data.size) state.chunks.push(e.data); };
      recorder.onerror = e => { $('recordStatus').textContent = `Recorder error: ${e.error && e.error.message ? e.error.message : 'unknown error'}. The camera preview may continue.`; };
      recorder.onstop = () => {
        stream.getTracks().forEach(t=>t.stop());
        const blob = new Blob(state.chunks, {type: recorder.mimeType || 'video/webm'});
        state.chunks = []; state.recorder = null;
        $('recordBadge').className='badge badge-off'; $('recordBadge').textContent='NOT RECORDING';
        $('recordStartBtn').disabled=!state.cameraOn; $('recordStopBtn').disabled=true;
        if (blob.size) { downloadBlob(blob, `ti-eye-${new Date().toISOString().replaceAll(':','-').slice(0,19)}.webm`); $('recordStatus').textContent=`Saved ${ (blob.size/1048576).toFixed(1) } MB video. Check your Downloads folder and play it before your field test.`; }
        else $('recordStatus').textContent='No video data was captured. Try a 10-second test clip.';
      };
      recorder.start(1000); $('recordBadge').className='badge badge-record'; $('recordBadge').textContent='RECORDING';
      $('recordStartBtn').disabled=true; $('recordStopBtn').disabled=false;
      $('recordStatus').textContent='Recording the digitally framed preview. Keep Ti-Eye in the foreground and avoid locking the phone.';
      addEvent('Recording started'); await requestWakeLock();
    } catch (err) { if (outputStream) outputStream.getTracks().forEach(t=>t.stop()); state.recorder=null; $('recordStartBtn').disabled=!state.cameraOn; $('recordStopBtn').disabled=true; $('recordStatus').textContent=`Recording could not start: ${err.message || 'unsupported recording settings'}. Camera preview remains active.`; }
  }
  function stopRecording() {
    if (state.recorder && state.recorder.state !== 'inactive') { try { state.recorder.stop(); } catch (_) {} }
    else if (!save) { state.recorder=null; }
  }
  function registerPwa() {
    if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* PWA caching is optional; never block camera start. */ });
    }
  }
  // Wire all controls only after the DOM is ready (script is deferred).
  $('startCameraBtn').addEventListener('click', startCamera);
  $('retryCameraBtn').addEventListener('click', startCamera);
  $('stopCameraBtn').addEventListener('click', stopCamera);
  video.addEventListener('click', () => { if (state.cameraOn && video.paused) video.play().catch(()=>{}); });
  $('fullPitchBtn').addEventListener('click', () => setMode('full'));
  $('aiFollowBtn').addEventListener('click', () => { setMode('ai'); if (state.cameraOn && !state.aiOn) enableAI(); });
  $('enableAiBtn').addEventListener('click', enableAI);
  $('zoomRange').addEventListener('input', e => { state.zoom=Number(e.target.value); $('zoomValue').textContent=`${state.zoom.toFixed(1)}×`; });
  $('panLeftBtn').addEventListener('click',()=>manualMove(-0.07,0)); $('panRightBtn').addEventListener('click',()=>manualMove(0.07,0));
  $('tiltUpBtn').addEventListener('click',()=>manualMove(0,-0.07)); $('tiltDownBtn').addEventListener('click',()=>manualMove(0,0.07));
  $('recenterBtn').addEventListener('click',()=>{state.cropCenterX=state.targetX=0.5;state.cropCenterY=state.targetY=0.5;state.zoom=1; $('zoomRange').value='1';$('zoomValue').textContent='1.0×';});
  $('homeGoalBtn').addEventListener('click',()=>{state.homeScore++;updateScore();addEvent('Goal — '+($('homeName').value.trim()||'Home'));});
  $('awayGoalBtn').addEventListener('click',()=>{state.awayScore++;updateScore();addEvent('Goal — '+($('awayName').value.trim()||'Away'));});
  $('clockStartBtn').addEventListener('click',startClock);
  $('clockResetBtn').addEventListener('click',()=>{state.clockRunning=false;state.elapsedMs=0;state.clockStart=0;$('clockStartBtn').textContent='Start';renderClock();});
  document.querySelectorAll('[data-event]').forEach(b=>b.addEventListener('click',()=>addEvent(b.dataset.event)));
  $('exportEventsBtn').addEventListener('click',exportCsv);
  $('clearEventsBtn').addEventListener('click',()=>{state.events=[];renderEvents();});
  $('homeName').addEventListener('input',updateScore); $('awayName').addEventListener('input',updateScore);
  $('recordStartBtn').addEventListener('click',startRecording); $('recordStopBtn').addEventListener('click',()=>stopRecording(true));
  window.addEventListener('pagehide',()=>{ if (state.stream) state.stream.getTracks().forEach(t=>t.stop()); if(state.recorder && state.recorder.state!=='inactive'){try{state.recorder.stop();}catch(_){}} });
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState==='visible' && state.cameraOn && !state.wakeLock) await requestWakeLock(); });
  refreshEnvironmentDiagnostics(); refreshPermissionDiagnostic(); updateScore(); renderClock(); registerPwa();
})();
