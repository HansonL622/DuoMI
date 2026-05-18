import React, { useEffect, useRef, useState } from 'react';
import { Heart, Sparkles, Volume2 } from 'lucide-react';

type DuoMiMode = 'listening' | 'recording' | 'thinking' | 'responding';

interface DuoMiStageProps {
  mode: DuoMiMode;
  isFocused: boolean;
  hasText: boolean;
  onTap?: () => void;
}

interface Particle {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  radius: number;
  phase: number;
}

const modeCopy: Record<DuoMiMode, string> = {
  listening: '在听',
  recording: '认真记着',
  thinking: '歪头想想',
  responding: '跑来回应',
};

const modeConfig: Record<DuoMiMode, { energy: number; hue: number; distance: number }> = {
  listening: { energy: 0.56, hue: 32, distance: 74 },
  recording: { energy: 0.82, hue: 18, distance: 84 },
  thinking: { energy: 1.05, hue: 210, distance: 90 },
  responding: { energy: 0.94, hue: 144, distance: 86 },
};

export const DuoMiStage: React.FC<DuoMiStageProps> = ({ mode, isFocused, hasText, onTap }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const modeRef = useRef(mode);
  const focusRef = useRef(isFocused);
  const textRef = useRef(hasText);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    focusRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    textRef.current = hasText;
  }, [hasText]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(query.matches);
    updatePreference();
    query.addEventListener('change', updatePreference);
    return () => query.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let particles: Particle[] = [];

    const buildParticles = () => {
      const count = Math.max(28, Math.floor((width * height) / 5200));
      particles = Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        const band = 0.34 + Math.random() * 0.58;
        const centerX = width / 2;
        const centerY = height * 0.5;
        const baseX = centerX + Math.cos(angle) * width * 0.38 * band + (Math.random() - 0.5) * 40;
        const baseY = centerY + Math.sin(angle) * height * 0.3 * band + (Math.random() - 0.5) * 26;

        return {
          x: baseX,
          y: baseY,
          baseX,
          baseY,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
          radius: 1.2 + Math.random() * 2.4,
          phase: Math.random() * Math.PI * 2,
        };
      });
    };

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildParticles();
    };

    const render = (time: number) => {
      const seconds = time / 1000;
      const currentMode = modeRef.current;
      const config = modeConfig[currentMode];
      const focusBoost = focusRef.current ? 0.16 : 0;
      const textBoost = textRef.current ? 0.14 : 0;
      const energy = reducedMotion ? 0.08 : config.energy + focusBoost + textBoost;
      const centerX = width / 2;
      const centerY = height * 0.5;

      ctx.clearRect(0, 0, width, height);

      for (const particle of particles) {
        const driftX = Math.cos(seconds * 0.7 + particle.phase) * 8 * energy;
        const driftY = Math.sin(seconds * 0.62 + particle.phase) * 7 * energy;
        let targetX = particle.baseX + driftX;
        let targetY = particle.baseY + driftY;

        if (pointerRef.current.active) {
          const dx = pointerRef.current.x - particle.x;
          const dy = pointerRef.current.y - particle.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 130) {
            const pull = (1 - distance / 130) * 0.07;
            targetX += dx * pull;
            targetY += dy * pull;
          }
        }

        if (currentMode === 'thinking') {
          targetX += (centerX - particle.x) * 0.028;
          targetY += (centerY - particle.y) * 0.028;
        }

        particle.vx += (targetX - particle.x) * 0.012;
        particle.vy += (targetY - particle.y) * 0.012;
        particle.vx *= 0.9;
        particle.vy *= 0.9;
        particle.x += particle.vx;
        particle.y += particle.vy;
      }

      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const first = particles[i];
          const second = particles[j];
          const distance = Math.hypot(first.x - second.x, first.y - second.y);
          if (distance < config.distance) {
            ctx.strokeStyle = `hsla(${config.hue}, 82%, 58%, ${(1 - distance / config.distance) * 0.15 * energy})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(first.x, first.y);
            ctx.lineTo(second.x, second.y);
            ctx.stroke();
          }
        }
      }

      for (const particle of particles) {
        ctx.fillStyle = `hsla(${config.hue}, 88%, 58%, ${0.42 + Math.sin(seconds * 1.8 + particle.phase) * 0.16})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius * (0.88 + energy * 0.36), 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [reducedMotion]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      active: true,
    };
  };

  return (
    <div
      className={`duomi-stage ${mode} ${isFocused ? 'is-focused' : ''} ${hasText ? 'has-text' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pointerRef.current.active = false;
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <button type="button" className="duomi-actor" onClick={onTap} aria-label="摸摸 DuoMi 并聚焦聊天输入">
        <span className="duomi-aura duomi-aura--outer" />
        <span className="duomi-aura duomi-aura--inner" />
        <span className="duomi-body">
          <img src={`/dog-${mode}-cutout.png`} alt={`DuoMi ${modeCopy[mode]}`} className="duomi-body__image" />
          <span className="duomi-reaction duomi-reaction--heart"><Heart size={15} fill="currentColor" /></span>
          <span className="duomi-reaction duomi-reaction--spark"><Sparkles size={17} /></span>
          <span className="duomi-reaction duomi-reaction--voice"><Volume2 size={16} /></span>
        </span>
        <span className="duomi-shadow" />
      </button>
      <div className="duomi-status">{modeCopy[mode]}</div>
    </div>
  );
};
