/**
 * Bey scan — motion-based beyblade tracking overlay (experimental)
 * Tracks up to 2 fast-moving blobs in the stadium view.
 */

const beyScanState = {
  enabled: false,
  running: false,
  raf: null,
  tracks: [],
  frameId: 0,
  prevPixels: null,
  analysisW: 320,
  analysisH: 240,
  compositeCanvas: null,
  compositeCtx: null,
  analysisCanvas: null,
  analysisCtx: null,
  statusEl: null,
  lastStatus: '',
  mlPending: false,
};

function beyScan$(sel) {
  return document.querySelector(sel);
}

function getCameraFrameSource() {
  const video = beyScan$('#camera-feed');
  const img = beyScan$('#camera-feed-img');
  if (video?.classList.contains('active') && video.videoWidth > 0) return { type: 'video', el: video };
  if (img && !img.hidden && img.complete && img.naturalWidth > 0) return { type: 'img', el: img };
  return null;
}

function getCameraCaptureFrame() {
  if (beyScanState.running && beyScanState.compositeCanvas?.width > 0) {
    return { type: 'canvas', el: beyScanState.compositeCanvas };
  }
  return getCameraFrameSource();
}

function isCameraLive() {
  return !!getCameraFrameSource();
}

function ensureBeyScanCanvases() {
  if (!beyScanState.compositeCanvas) {
    beyScanState.compositeCanvas = document.createElement('canvas');
    beyScanState.compositeCtx = beyScanState.compositeCanvas.getContext('2d', { alpha: false });
  }
  if (!beyScanState.analysisCanvas) {
    beyScanState.analysisCanvas = document.createElement('canvas');
    beyScanState.analysisCtx = beyScanState.analysisCanvas.getContext('2d', { willReadFrequently: true });
    beyScanState.analysisCanvas.width = beyScanState.analysisW;
    beyScanState.analysisCanvas.height = beyScanState.analysisH;
  }
}

function mountCompositeInViewport() {
  const viewport = beyScan$('#camera-viewport');
  const canvas = beyScanState.compositeCanvas;
  if (!viewport || !canvas) return;
  canvas.id = 'bey-scan-composite';
  canvas.className = 'bey-scan-composite';
  if (!viewport.contains(canvas)) viewport.appendChild(canvas);
}

function unmountComposite() {
  beyScanState.compositeCanvas?.remove();
}

function setBeyScanStatus(text) {
  if (text === beyScanState.lastStatus) return;
  beyScanState.lastStatus = text;
  const el = beyScanState.statusEl || beyScan$('#bey-scan-status');
  if (el) el.textContent = text;
}

function setBeyScanStatusUnlessCapturing(text) {
  if (typeof isTrainingCaptureActive === 'function' && isTrainingCaptureActive()) return;
  setBeyScanStatus(text);
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function classifySide(xNorm, avgHue) {
  if (avgHue < 28 || avgHue > 330) return 1;
  if (avgHue > 170 && avgHue < 260) return 2;
  return xNorm < 0.5 ? 1 : 2;
}

function detectMotionBlobs(curr, prev, w, h) {
  const thr = 42;
  const minArea = Math.max(18, Math.floor(w * h * 0.0015));
  const maxArea = Math.floor(w * h * 0.12);
  const grid = new Map();

  for (let i = 0; i < curr.length; i += 4) {
    const dr = Math.abs(curr[i] - prev[i]);
    const dg = Math.abs(curr[i + 1] - prev[i + 1]);
    const db = Math.abs(curr[i + 2] - prev[i + 2]);
    if (dr + dg + db < thr) continue;
    const p = i / 4;
    const gx = p % w;
    const gy = (p / w) | 0;
    const key = `${(gx / 8) | 0},${(gy / 8) | 0}`;
    let cell = grid.get(key);
    if (!cell) {
      cell = { count: 0, sx: 0, sy: 0, motion: 0, rSum: 0, gSum: 0, bSum: 0 };
      grid.set(key, cell);
    }
    cell.count += 1;
    cell.sx += gx;
    cell.sy += gy;
    cell.motion += dr + dg + db;
    cell.rSum += curr[i];
    cell.gSum += curr[i + 1];
    cell.bSum += curr[i + 2];
  }

  const blobs = [];
  grid.forEach((cell) => {
    if (cell.count < minArea / 4) return;
    const cx = cell.sx / cell.count;
    const cy = cell.sy / cell.count;
    const area = cell.count * 64;
    if (area < minArea || area > maxArea) return;
    const avgR = cell.rSum / cell.count;
    const avgG = cell.gSum / cell.count;
    const avgB = cell.bSum / cell.count;
    const max = Math.max(avgR, avgG, avgB);
    const min = Math.min(avgR, avgG, avgB);
    let hue = 0;
    if (max !== min) {
      if (max === avgR) hue = ((avgG - avgB) / (max - min)) * 60;
      else if (max === avgG) hue = (2 + (avgB - avgR) / (max - min)) * 60;
      else hue = (4 + (avgR - avgG) / (max - min)) * 60;
      if (hue < 0) hue += 360;
    }
    blobs.push({
      x: cx / w,
      y: cy / h,
      energy: cell.motion / cell.count,
      radius: Math.sqrt(area) / w * 0.09,
      side: classifySide(cx / w, hue),
    });
  });

  blobs.sort((a, b) => b.energy - a.energy);
  return blobs.slice(0, 2);
}

function matchTracks(blobs) {
  const next = [];
  const used = new Set();

  blobs.forEach((blob) => {
    let best = null;
    let bestD = blob.source === 'ml' ? 0.28 : 0.18;
    beyScanState.tracks.forEach((track) => {
      if (used.has(track.id)) return;
      const d = dist(track, blob);
      if (d < bestD) {
        bestD = d;
        best = track;
      }
    });
    if (best) {
      used.add(best.id);
      next.push({
        id: best.id,
        x: best.x * 0.35 + blob.x * 0.65,
        y: best.y * 0.35 + blob.y * 0.65,
        energy: blob.energy,
        radius: blob.radius,
        side: blob.side,
        source: blob.source || best.source,
        stillFrames: blob.energy < 18 ? (best.stillFrames || 0) + 1 : 0,
      });
    } else {
      next.push({
        id: `t${++beyScanState.frameId}`,
        x: blob.x,
        y: blob.y,
        energy: blob.energy,
        radius: blob.radius,
        side: blob.side,
        source: blob.source,
        stillFrames: 0,
      });
    }
  });

  beyScanState.tracks = next;
  return next;
}

function drawScanOverlay(ctx, w, h, tracks, mirror) {
  tracks.forEach((track, i) => {
    const x = (mirror ? 1 - track.x : track.x) * w;
    const y = track.y * h;
    const r = Math.max(24, track.radius * w * 1.2);
    const color = track.side === 1 ? '#ff2d55' : '#00d4ff';
    const label = track.side === 1 ? 'RED' : 'BLUE';
    const mode = track.source === 'ml' ? 'AI' : '動態';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = '700 13px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`陀螺 ${i + 1} · ${label} · ${mode}`, x, y - r - 8);

    if (track.stillFrames > 8) {
      ctx.fillStyle = 'rgba(255,214,10,0.95)';
      ctx.fillText('動態減弱', x, y + r + 16);
    } else if (track.energy > 40) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('旋轉中', x, y + r + 16);
    }
    ctx.restore();
  });

  ctx.save();
  ctx.strokeStyle = 'rgba(255,214,10,0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(w * 0.08, h * 0.12, w * 0.84, h * 0.76);
  ctx.fillStyle = 'rgba(255,214,10,0.9)';
  ctx.font = '600 11px Rajdhani, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('掃描區域', w * 0.08 + 6, h * 0.12 + 14);
  ctx.restore();
}

function updateBeyScanStatusFromTracks(tracks) {
  const mode = typeof getBeyDetectModeLabel === 'function' ? getBeyDetectModeLabel() : '';
  if (!tracks.length) {
    setBeyScanStatusUnlessCapturing(`${mode} · 掃描中… 請俯拍對戰碟中央`);
    return;
  }
  const parts = tracks.map((t, i) => {
    const side = t.side === 1 ? '紅' : '藍';
    const state = t.stillFrames > 8 ? '可能停轉' : '旋轉中';
    const src = t.source === 'ml' ? 'AI' : '動態';
    return `陀螺${i + 1}(${side}/${src})${state}`;
  });
  setBeyScanStatusUnlessCapturing(`${mode} · 偵測 ${tracks.length} 個 · ${parts.join(' · ')}`);
}

function applyMotionStillness(tracks, curr, prev, w, h) {
  if (!prev || !tracks.length) return tracks;
  return tracks.map((track) => {
    const cx = Math.round(track.x * w);
    const cy = Math.round(track.y * h);
    const r = Math.max(8, Math.round(track.radius * w));
    let motion = 0;
    let count = 0;
    for (let dy = -r; dy <= r; dy += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (dx * dx + dy * dy > r * r) continue;
        const i = (y * w + x) * 4;
        motion += Math.abs(curr[i] - prev[i]) + Math.abs(curr[i + 1] - prev[i + 1]) + Math.abs(curr[i + 2] - prev[i + 2]);
        count += 1;
      }
    }
    const energy = count ? motion / count : track.energy;
    return {
      ...track,
      energy,
      stillFrames: energy < 18 ? (track.stillFrames || 0) + 1 : 0,
    };
  });
}

function finishBeyScanFrame(blobs, compCtx, vw, vh, mirror, curr, prev) {
  let tracks = matchTracks(blobs);
  tracks = applyMotionStillness(tracks, curr, prev, beyScanState.analysisW, beyScanState.analysisH);
  beyScanState.tracks = tracks;
  drawScanOverlay(compCtx, vw, vh, tracks, mirror);
  updateBeyScanStatusFromTracks(tracks);
  beyScanState.prevPixels = new Uint8ClampedArray(curr);
  beyScanState.raf = requestAnimationFrame(beyScanTick);
}

function beyScanTick() {
  if (!beyScanState.enabled || !beyScanState.running) return;

  const source = getCameraFrameSource();
  const composite = beyScanState.compositeCanvas;
  const compCtx = beyScanState.compositeCtx;
  const aCtx = beyScanState.analysisCtx;
  if (!source || !composite || !compCtx || !aCtx) {
    beyScanState.raf = requestAnimationFrame(beyScanTick);
    return;
  }

  const vw = source.type === 'video' ? source.el.videoWidth : source.el.naturalWidth;
  const vh = source.type === 'video' ? source.el.videoHeight : source.el.naturalHeight;
  if (!vw || !vh) {
    beyScanState.raf = requestAnimationFrame(beyScanTick);
    return;
  }

  if (composite.width !== vw || composite.height !== vh) {
    composite.width = vw;
    composite.height = vh;
  }

  const mirror = beyScan$('#cam-mirror')?.checked
    && typeof state !== 'undefined'
    && state.cameraMode !== 'remote'
    && state.cameraMode !== 'dji';

  compCtx.save();
  if (mirror) {
    compCtx.translate(vw, 0);
    compCtx.scale(-1, 1);
  }
  compCtx.drawImage(source.el, 0, 0, vw, vh);
  compCtx.restore();

  aCtx.drawImage(source.el, 0, 0, beyScanState.analysisW, beyScanState.analysisH);
  const curr = aCtx.getImageData(0, 0, beyScanState.analysisW, beyScanState.analysisH).data;

  if (typeof isBeyDetectReady === 'function' && isBeyDetectReady() && !beyScanState.mlPending) {
    beyScanState.mlPending = true;
    beyDetectFromSource(source, vw, vh)
      .then((detections) => {
        beyScanState.mlPending = false;
        if (!beyScanState.running) return;
        const blobs = detections?.length
          ? detections
          : (beyScanState.prevPixels
            ? detectMotionBlobs(curr, beyScanState.prevPixels, beyScanState.analysisW, beyScanState.analysisH)
            : []);
        finishBeyScanFrame(blobs, compCtx, vw, vh, mirror, curr, beyScanState.prevPixels);
      })
      .catch(() => {
        beyScanState.mlPending = false;
        if (!beyScanState.running) return;
        const blobs = beyScanState.prevPixels
          ? detectMotionBlobs(curr, beyScanState.prevPixels, beyScanState.analysisW, beyScanState.analysisH)
          : [];
        finishBeyScanFrame(blobs, compCtx, vw, vh, mirror, curr, beyScanState.prevPixels);
      });
    return;
  }

  if (beyScanState.mlPending) {
    beyScanState.raf = requestAnimationFrame(beyScanTick);
    return;
  }

  let tracks = [];
  if (beyScanState.prevPixels) {
    const blobs = detectMotionBlobs(curr, beyScanState.prevPixels, beyScanState.analysisW, beyScanState.analysisH);
    tracks = matchTracks(blobs);
    drawScanOverlay(compCtx, vw, vh, tracks, mirror);
    updateBeyScanStatusFromTracks(tracks);
  } else {
    setBeyScanStatusUnlessCapturing(typeof getBeyDetectModeLabel === 'function' ? getBeyDetectModeLabel() + ' · 啟動中…' : '陀螺掃描啟動中…');
  }

  beyScanState.prevPixels = new Uint8ClampedArray(curr);
  beyScanState.raf = requestAnimationFrame(beyScanTick);
}

function startBeyScanLoop() {
  if (!beyScanState.enabled || beyScanState.running) return;
  if (!isCameraLive()) return;

  ensureBeyScanCanvases();
  mountCompositeInViewport();
  beyScanState.running = true;
  beyScanState.tracks = [];
  beyScanState.prevPixels = null;
  beyScanState.mlPending = false;
  if (typeof resetBeyDetectTracks === 'function') resetBeyDetectTracks();
  beyScanState.frameId = 0;
  beyScanTick();
}

function stopBeyScanLoop() {
  beyScanState.running = false;
  if (beyScanState.raf) cancelAnimationFrame(beyScanState.raf);
  beyScanState.raf = null;
  beyScanState.tracks = [];
  beyScanState.prevPixels = null;
  beyScanState.mlPending = false;
  if (typeof resetBeyDetectTracks === 'function') resetBeyDetectTracks();
  unmountComposite();
  setBeyScanStatus('陀螺掃描已關閉');
}

function isBeyScanUiHidden() {
  const bar = beyScan$('#bey-scan-bar');
  return !bar || bar.hidden;
}

function setBeyScanEnabled(on) {
  if (on && isBeyScanUiHidden()) on = false;
  beyScanState.enabled = !!on;
  sessionStorage.setItem('bex-bey-scan', on ? '1' : '0');
  const viewport = beyScan$('#camera-viewport');
  viewport?.classList.toggle('bey-scan-on', on);

  if (on && isCameraLive()) startBeyScanLoop();
  else stopBeyScanLoop();
}

function getBeyScanRecordStream() {
  if (!beyScanState.enabled || !beyScanState.compositeCanvas || !beyScanState.running) return null;
  try {
    return beyScanState.compositeCanvas.captureStream(24);
  } catch (_) {
    return null;
  }
}

function onCameraFeedActive() {
  if (beyScanState.enabled) startBeyScanLoop();
}

function onCameraFeedStopped() {
  if (typeof setTrainingCapture === 'function') setTrainingCapture(false);
  stopBeyScanLoop();
}

function initBeyScan() {
  beyScanState.statusEl = beyScan$('#bey-scan-status');
  const toggle = beyScan$('#bey-scan-toggle');
  const saved = !isBeyScanUiHidden() && sessionStorage.getItem('bex-bey-scan') === '1';
  if (toggle) toggle.checked = saved;
  setBeyScanEnabled(saved);

  toggle?.addEventListener('change', () => {
    setBeyScanEnabled(toggle.checked);
  });
}

document.addEventListener('DOMContentLoaded', initBeyScan);
