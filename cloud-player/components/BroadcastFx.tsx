'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type BroadcastFxHandle = {
  burst: (color: string, count?: number, type?: 'burst' | 'extreme' | 'victory') => void;
  streak: (color: string, count?: number) => void;
};

type ParticleKind = 'burst' | 'extreme' | 'victory' | 'streak';

class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  kind: ParticleKind;

  constructor(x: number, y: number, color: string, kind: ParticleKind) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.kind = kind;
    const angle = Math.random() * Math.PI * 2;
    const speed = kind === 'extreme' ? 4 + Math.random() * 9 : 2 + Math.random() * 7;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed - (kind === 'streak' ? 2 : 0);
    this.maxLife = kind === 'victory' ? 90 + Math.random() * 40 : 45 + Math.random() * 35;
    this.life = this.maxLife;
    this.size = kind === 'extreme' ? 3 + Math.random() * 4 : 2 + Math.random() * 3;
  }

  tick() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.kind === 'streak' ? 0.08 : 0.12;
    this.vx *= 0.98;
    this.life -= 1;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  get dead() {
    return this.life <= 0;
  }
}

const BroadcastFx = forwardRef<BroadcastFxHandle>(function BroadcastFx(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);

  const resize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };

  const loop = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particlesRef.current = particlesRef.current.filter((p) => {
      p.tick();
      p.draw(ctx);
      return !p.dead;
    });
    if (particlesRef.current.length) {
      rafRef.current = window.requestAnimationFrame(loop);
    } else {
      rafRef.current = null;
    }
  };

  const spawn = (count: number, color: string, kind: ParticleKind) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width * (0.35 + Math.random() * 0.3);
    const cy = canvas.height * (0.35 + Math.random() * 0.25);
    const cap = 160;
    const room = Math.max(0, cap - particlesRef.current.length);
    for (let i = 0; i < Math.min(count, room); i += 1) {
      particlesRef.current.push(new Particle(cx, cy, color, kind));
    }
    if (!rafRef.current) rafRef.current = window.requestAnimationFrame(loop);
  };

  useImperativeHandle(ref, () => ({
    burst: (color, count = 36, type = 'burst') => spawn(count, color, type),
    streak: (color, count = 24) => spawn(count, color, 'streak'),
  }), []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="broadcast-fx-canvas" aria-hidden="true" />;
});

export default BroadcastFx;

export const FINISH_FX: Record<string, { label: string; flash: string; color: string; particles: number }> = {
  spin: { label: '殘存', flash: 'gold', color: '#ffd60a', particles: 28 },
  burst: { label: '爆裂', flash: 'burst', color: '#ff2d55', particles: 52 },
  over: { label: '擊飛', flash: 'blue', color: '#00d4ff', particles: 44 },
  extreme: { label: '極致', flash: 'extreme', color: '#bf5af2', particles: 72 },
};
