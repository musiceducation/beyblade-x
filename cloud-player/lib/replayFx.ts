'use client';

export type FinishFxType = 'burst' | 'over' | 'extreme' | 'spin';

export type ReplayFxPayload = {
  flash: '' | 'burst-flash' | 'extreme-flash' | 'default-flash';
  shake: '' | 'shake' | 'shake-heavy';
  popPlayer: 1 | 2 | null;
};

let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function playBeep(freq: number, duration: number) {
  playTone({ freq, duration, volume: 0.07, type: 'sine', attack: 0.006, release: duration * 0.85 });
}

type ToneOpts = {
  freq: number;
  duration?: number;
  type?: OscillatorType;
  volume?: number;
  attack?: number;
  release?: number;
  delay?: number;
  detune?: number;
  freqEnd?: number;
  filterFreq?: number;
};

function playTone(opts: ToneOpts) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const {
    freq,
    duration = 0.15,
    type = 'sine',
    volume = 0.1,
    attack = 0.008,
    release,
    delay = 0,
    detune = 0,
    freqEnd,
    filterFreq,
  } = opts;
  const now = ctx.currentTime + delay;
  const tail = release ?? Math.max(0.04, duration * 0.72);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 36), now + duration);
  if (detune) osc.detune.setValueAtTime(detune, now);

  let output: AudioNode = osc;
  if (filterFreq) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.Q.setValueAtTime(0.7, now);
    osc.connect(filter);
    output = filter;
  }
  output.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(volume, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
  osc.start(now);
  osc.stop(now + tail + 0.04);
}

function playSoftNoise(duration: number, volume: number, delay = 0, filterFreq = 2400) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime + delay;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const fade = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterFreq, now);
  filter.Q.setValueAtTime(0.9, now);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function playFinishStinger(type: FinishFxType) {
  switch (type) {
    case 'spin':
      playTone({ freq: 880, freqEnd: 587, duration: 0.34, volume: 0.08, type: 'sine' });
      playTone({ freq: 587, duration: 0.22, volume: 0.05, delay: 0.1, type: 'triangle', filterFreq: 1800 });
      break;
    case 'burst':
      playSoftNoise(0.07, 0.05, 0, 900);
      playTone({ freq: 110, duration: 0.18, volume: 0.11, attack: 0.003, release: 0.16, type: 'sine' });
      playTone({ freq: 523, duration: 0.11, volume: 0.07, delay: 0.06, type: 'sine' });
      playTone({ freq: 659, duration: 0.13, volume: 0.06, delay: 0.11, type: 'sine' });
      playTone({ freq: 784, duration: 0.16, volume: 0.05, delay: 0.16, type: 'sine', filterFreq: 2200 });
      break;
    case 'over':
      playTone({ freq: 220, freqEnd: 440, duration: 0.14, volume: 0.07, type: 'triangle', filterFreq: 1600 });
      playTone({ freq: 587, duration: 0.2, volume: 0.09, delay: 0.08, type: 'sine' });
      playTone({ freq: 880, duration: 0.12, volume: 0.05, delay: 0.14, type: 'sine', filterFreq: 2000 });
      break;
    case 'extreme':
      playSoftNoise(0.12, 0.04, 0, 420);
      playTone({ freq: 82, duration: 0.28, volume: 0.1, attack: 0.004, release: 0.24, type: 'sine' });
      playTone({ freq: 165, duration: 0.22, volume: 0.07, delay: 0.04, type: 'triangle' });
      playTone({ freq: 622, duration: 0.18, volume: 0.06, delay: 0.12, type: 'sine', filterFreq: 2400 });
      playTone({ freq: 932, duration: 0.24, volume: 0.045, delay: 0.18, type: 'sine', filterFreq: 2600 });
      break;
    default:
      playTone({ freq: 440, duration: 0.14, volume: 0.07, type: 'sine' });
  }
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  decay: number;
  size: number;
};

export class ReplayParticleFx {
  private canvas: HTMLCanvasElement | null = null;

  private ctx: CanvasRenderingContext2D | null = null;

  private particles: Particle[] = [];

  private frame = 0;

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') || null;
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  burst(count: number, color: string, type: FinishFxType) {
    if (!this.ctx || !this.canvas) return;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const cap = Math.max(0, 120 - this.particles.length);
    const n = Math.min(count, cap);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = type === 'burst'
        ? 6 + Math.random() * 16
        : type === 'extreme'
          ? 8 + Math.random() * 18
          : 2 + Math.random() * 8;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (type === 'over' ? 6 : 0),
        color,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
        size: type === 'extreme' ? 5 + Math.random() * 8 : 2 + Math.random() * 5,
      });
    }
    if (!this.frame) this.loop();
  }

  private loop = () => {
    if (!this.ctx || !this.canvas) {
      this.frame = 0;
      return;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.vx *= 0.98;
      p.life -= p.decay;
      if (p.life <= 0) return false;
      this.ctx!.globalAlpha = Math.max(0, p.life);
      this.ctx!.fillStyle = p.color;
      this.ctx!.beginPath();
      this.ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx!.fill();
      return true;
    });
    this.ctx.globalAlpha = 1;
    if (this.particles.length) {
      this.frame = requestAnimationFrame(this.loop);
    } else {
      this.frame = 0;
    }
  };

  clear() {
    this.particles = [];
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

export function triggerReplayFinishFx(
  type: string,
  player: number,
  particles: ReplayParticleFx,
): ReplayFxPayload {
  const finishType = (type || 'spin') as FinishFxType;
  const color = player === 1 ? '#ff2d55' : '#00d4ff';

  let flash: ReplayFxPayload['flash'] = '';
  let shake: ReplayFxPayload['shake'] = '';

  if (finishType === 'burst') {
    shake = 'shake-heavy';
    flash = 'burst-flash';
    particles.burst(18, color, finishType);
  } else if (finishType === 'extreme') {
    shake = 'shake-heavy';
    flash = 'extreme-flash';
    particles.burst(28, '#bf5af2', finishType);
    particles.burst(14, '#ffd60a', finishType);
  } else if (finishType === 'over') {
    shake = 'shake';
    flash = 'default-flash';
    particles.burst(10, '#ffd60a', finishType);
  } else {
    particles.burst(8, color, finishType);
  }

  playFinishStinger(finishType);

  return { flash, shake, popPlayer: player === 1 ? 1 : 2 };
}
