/**
 * Bey-detect — TensorFlow.js object detection loader + inference
 * Expects Roboflow / YOLO-style TF.js graph model + models/beyblade/metadata.json
 */

const BEY_DETECT_META_URL = 'models/beyblade/metadata.json';

const beyDetectState = {
  ready: false,
  loading: false,
  failed: false,
  model: null,
  meta: null,
  frameCounter: 0,
  lastDetections: [],
  captureActive: false,
  captureCount: 0,
  captureTimer: null,
  captureSessionId: 0,
  downloadLink: null,
};

function beyDetect$(sel) {
  return document.querySelector(sel);
}

async function loadBeyDetectMetadata() {
  const res = await fetch(BEY_DETECT_META_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('metadata missing');
  return res.json();
}

async function initBeyDetect() {
  if (beyDetectState.loading || beyDetectState.ready) return beyDetectState.ready;
  if (typeof tf === 'undefined') {
    beyDetectState.failed = true;
    return false;
  }

  beyDetectState.loading = true;
  try {
    const meta = await loadBeyDetectMetadata();
    const modelRes = await fetch(meta.modelUrl, { method: 'HEAD' });
    if (!modelRes.ok) throw new Error('model missing');

    beyDetectState.meta = meta;
    beyDetectState.model = await tf.loadGraphModel(meta.modelUrl);
    beyDetectState.ready = true;
    beyDetectState.failed = false;
    return true;
  } catch (err) {
    console.info('Bey-detect: ML model not loaded, using motion scan fallback.', err?.message || err);
    beyDetectState.failed = true;
    beyDetectState.ready = false;
    return false;
  } finally {
    beyDetectState.loading = false;
    updateBeyDetectUi();
  }
}

function isBeyDetectReady() {
  return beyDetectState.ready && !!beyDetectState.model;
}

function getBeyDetectModeLabel() {
  if (beyDetectState.loading) return 'AI 模型載入中…';
  if (isBeyDetectReady()) return `AI 偵測 · ${beyDetectState.meta.classes?.join(' / ') || 'beyblade'}`;
  return '動態掃描（未放置 AI 模型）';
}

function updateBeyDetectUi() {
  const badge = beyDetect$('#bey-detect-mode');
  if (badge) {
    badge.textContent = getBeyDetectModeLabel();
    badge.dataset.mode = isBeyDetectReady() ? 'ai' : 'motion';
  }
}

function classToSide(className, xNorm) {
  const map = beyDetectState.meta?.classSideMap || {};
  if (map[className] === 1 || map[className] === 2) return map[className];
  if (/red/i.test(className)) return 1;
  if (/blue/i.test(className)) return 2;
  return xNorm < 0.5 ? 1 : 2;
}

function tensorToDetections(outputTensor, meta, srcW, srcH) {
  const data = outputTensor.dataSync();
  const shape = outputTensor.shape;
  const scoreThr = meta.scoreThreshold ?? 0.35;
  const detections = [];

  // [1, N, 6+] YOLO-style: cx,cy,w,h,conf,class...
  if (shape.length === 3 && shape[0] === 1 && shape[2] >= 6) {
    const n = shape[1];
    const stride = shape[2];
    for (let i = 0; i < n; i++) {
      const base = i * stride;
      const cx = data[base];
      const cy = data[base + 1];
      const bw = data[base + 2];
      const bh = data[base + 3];
      const conf = data[base + 4];
      if (conf < scoreThr) continue;
      const cls = stride > 5 ? data[base + 5] : 0;
      const className = meta.classes?.[Math.round(cls)] || 'beyblade';
      detections.push({
        x: cx,
        y: cy,
        w: bw,
        h: bh,
        score: conf,
        className,
        normalized: cx <= 1.5 && cy <= 1.5,
      });
    }
  } else if (shape.length === 2 && shape[1] >= 6) {
    const n = shape[0];
    for (let i = 0; i < n; i++) {
      const base = i * shape[1];
      const conf = data[base + 4];
      if (conf < scoreThr) continue;
      detections.push({
        x: data[base],
        y: data[base + 1],
        w: data[base + 2],
        h: data[base + 3],
        score: conf,
        className: meta.classes?.[Math.round(data[base + 5] || 0)] || 'beyblade',
        normalized: data[base] <= 1.5,
      });
    }
  }

  return detections.map((d) => {
    let x = d.x;
    let y = d.y;
    let w = d.w;
    let h = d.h;
    if (!d.normalized) {
      x /= srcW;
      y /= srcH;
      w /= srcW;
      h /= srcH;
    }
    const side = classToSide(d.className, x);
    return {
      x,
      y,
      radius: Math.max(w, h) * 0.55,
      side,
      energy: 50 + d.score * 50,
      score: d.score,
      className: d.className,
      source: 'ml',
      stillFrames: 0,
    };
  });
}

function nmsDetections(items, iouThr = 0.45) {
  const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
  const kept = [];

  function iou(a, b) {
    const ax1 = a.x - a.radius;
    const ax2 = a.x + a.radius;
    const ay1 = a.y - a.radius;
    const ay2 = a.y + a.radius;
    const bx1 = b.x - b.radius;
    const bx2 = b.x + b.radius;
    const by1 = b.y - b.radius;
    const by2 = b.y + b.radius;
    const ix1 = Math.max(ax1, bx1);
    const iy1 = Math.max(ay1, by1);
    const ix2 = Math.min(ax2, bx2);
    const iy2 = Math.min(ay2, by2);
    const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
    const areaA = (ax2 - ax1) * (ay2 - ay1);
    const areaB = (bx2 - bx1) * (by2 - by1);
    return inter / Math.max(1e-6, areaA + areaB - inter);
  }

  sorted.forEach((item) => {
    if (kept.some((k) => iou(k, item) > iouThr)) return;
    kept.push(item);
  });
  return kept.slice(0, beyDetectState.meta?.maxDetections || 4);
}

async function runBeyDetect(sourceEl, srcW, srcH) {
  if (!isBeyDetectReady()) return null;

  const meta = beyDetectState.meta;
  const size = meta.inputSize || 640;
  const input = tf.tidy(() => {
    const t = tf.browser.fromPixels(sourceEl)
      .resizeBilinear([size, size])
      .toFloat()
      .div(255);
    return t.expandDims(0);
  });

  let output;
  try {
    output = beyDetectState.model.execute(input);
  } finally {
    input.dispose();
  }

  const tensors = Array.isArray(output) ? output : [output];
  let detections = [];
  tensors.forEach((tensor) => {
    const parsed = tensorToDetections(tensor, meta, srcW, srcH);
    detections = detections.concat(parsed);
    tensor.dispose();
  });
  if (!Array.isArray(output)) output?.dispose?.();

  return nmsDetections(detections, meta.iouThreshold ?? 0.45).slice(0, 2);
}

async function beyDetectFromSource(source, srcW, srcH) {
  beyDetectState.frameCounter += 1;
  const every = beyDetectState.meta?.inferenceEveryFrames || 3;
  if (beyDetectState.frameCounter % every !== 0 && beyDetectState.lastDetections.length) {
    return beyDetectState.lastDetections;
  }

  try {
    const detections = await runBeyDetect(source.el, srcW, srcH);
    if (detections?.length) {
      beyDetectState.lastDetections = detections;
      return detections;
    }
  } catch (err) {
    console.warn('Bey-detect inference failed', err);
  }
  return beyDetectState.lastDetections;
}

function resetBeyDetectTracks() {
  beyDetectState.lastDetections = [];
  beyDetectState.frameCounter = 0;
}

function isTrainingCaptureActive() {
  return beyDetectState.captureActive;
}

function updateCaptureButton(active) {
  const btn = beyDetect$('#btn-capture-frames');
  if (!btn) return;
  btn.classList.toggle('active', active);
  btn.textContent = active ? '■ 停止收集' : '📷 收集訓練 frame';
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function downloadDataUrl(dataUrl, filename) {
  if (!beyDetectState.downloadLink) {
    beyDetectState.downloadLink = document.createElement('a');
    beyDetectState.downloadLink.style.display = 'none';
    document.body.appendChild(beyDetectState.downloadLink);
  }
  const a = beyDetectState.downloadLink;
  a.href = dataUrl;
  a.download = filename;
  a.click();
  a.removeAttribute('href');
}

function captureTrainingFrame() {
  const getter = typeof getCameraCaptureFrame === 'function' ? getCameraCaptureFrame : getCameraFrameSource;
  const source = typeof getter === 'function' ? getter() : null;
  if (!source) return false;

  const vw = source.type === 'canvas'
    ? source.el.width
    : source.type === 'video'
      ? source.el.videoWidth
      : source.el.naturalWidth;
  const vh = source.type === 'canvas'
    ? source.el.height
    : source.type === 'video'
      ? source.el.videoHeight
      : source.el.naturalHeight;
  if (!vw || !vh) return false;

  const canvas = document.createElement('canvas');
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source.el, 0, 0, vw, vh);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  beyDetectState.captureCount += 1;
  const name = `beyblade-frame-${String(beyDetectState.captureCount).padStart(4, '0')}-${stamp}.jpg`;
  downloadDataUrl(canvas.toDataURL('image/jpeg', 0.92), name);
  return true;
}

function scheduleCaptureTick(sessionId) {
  if (!beyDetectState.captureActive || sessionId !== beyDetectState.captureSessionId) return;

  if (!captureTrainingFrame()) {
    stopTrainingCapture();
    if (typeof setBeyScanStatus === 'function') {
      setBeyScanStatus('鏡頭中斷，已停止收集');
    }
    return;
  }

  const status = beyDetect$('#bey-scan-status');
  if (status) {
    status.textContent = `收集中… 已下載 ${beyDetectState.captureCount} 張 · 按「停止收集」結束`;
  }

  beyDetectState.captureTimer = setTimeout(() => scheduleCaptureTick(sessionId), 800);
}

function stopTrainingCapture() {
  beyDetectState.captureActive = false;
  beyDetectState.captureSessionId += 1;
  if (beyDetectState.captureTimer) {
    clearTimeout(beyDetectState.captureTimer);
    beyDetectState.captureTimer = null;
  }
  updateCaptureButton(false);
  if (typeof setBeyScanStatus === 'function') {
    const label = typeof getBeyDetectModeLabel === 'function' ? getBeyDetectModeLabel() : '';
    setBeyScanStatus(`${label} · 已停止收集（共 ${beyDetectState.captureCount} 張）`);
  }
}

function startTrainingCapture() {
  if (beyDetectState.captureActive) return;

  const getter = typeof getCameraCaptureFrame === 'function' ? getCameraCaptureFrame : getCameraFrameSource;
  if (typeof getter !== 'function' || !getter()) {
    if (typeof setBeyScanStatus === 'function') {
      setBeyScanStatus('請先連接鏡頭再收集 frame');
    }
    return;
  }

  beyDetectState.captureActive = true;
  const sessionId = ++beyDetectState.captureSessionId;
  updateCaptureButton(true);
  if (typeof setBeyScanStatus === 'function') {
    setBeyScanStatus('收集中… 按「■ 停止收集」結束');
  }
  scheduleCaptureTick(sessionId);
}

function setTrainingCapture(on) {
  if (on) startTrainingCapture();
  else stopTrainingCapture();
}

function initBeyDetectUi() {
  updateBeyDetectUi();
  initBeyDetect().catch(() => {});

  beyDetect$('#btn-capture-frames')?.addEventListener('click', () => {
    if (beyDetectState.captureActive) stopTrainingCapture();
    else startTrainingCapture();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && beyDetectState.captureActive) {
      stopTrainingCapture();
    }
  });

  beyDetect$('#btn-reload-model')?.addEventListener('click', () => {
    if (beyDetectState.model) {
      beyDetectState.model.dispose();
      beyDetectState.model = null;
    }
    beyDetectState.ready = false;
    beyDetectState.failed = false;
    initBeyDetect().catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', initBeyDetectUi);
