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
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = 'square';
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playFinishImpact(type: FinishFxType) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const punchFreq: Record<FinishFxType, number> = {
    spin: 520,
    burst: 95,
    over: 220,
    extreme: 70,
  };
  const freq = punchFreq[type] || 180;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type === 'spin' ? 'sawtooth' : 'square';
  osc.frequency.setValueAtTime(freq * 1.8, now);
  osc.frequency.exponentialRampToValueAtTime(freq, now + 0.16);
  gain.gain.setValueAtTime(type === 'extreme' ? 0.18 : 0.14, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.45);
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
    playBeep(120, 0.15);
  } else if (finishType === 'extreme') {
    shake = 'shake-heavy';
    flash = 'extreme-flash';
    particles.burst(28, '#bf5af2', finishType);
    particles.burst(14, '#ffd60a', finishType);
    playBeep(80, 0.25);
  } else if (finishType === 'over') {
    shake = 'shake';
    flash = 'default-flash';
    particles.burst(10, '#ffd60a', finishType);
    playBeep(300, 0.1);
  } else {
    particles.burst(8, color, finishType);
    playBeep(520, 0.06);
  }

  playFinishImpact(finishType);

  return { flash, shake, popPlayer: player === 1 ? 1 : 2 };
}
