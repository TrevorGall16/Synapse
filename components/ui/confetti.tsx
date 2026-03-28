"use client";

/**
 * components/ui/confetti.tsx — Canvas confetti burst animation
 *
 * ALLOWLISTED for direct requestAnimationFrame usage (library wrapper).
 * This is a self-contained cosmetic animation with no playback, timeline,
 * or scrubber logic — it does NOT belong on the GlobalTicker.
 */

import { useRef, useEffect } from "react";

const CONF_COLORS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#a855f7","#ef4444","#38bdf8"];
interface Particle { x: number; y: number; vx: number; vy: number; color: string; rot: number; rspd: number; w: number; h: number; life: number }

export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.45;
    const particles: Particle[] = Array.from({ length: 90 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 7;
      return { x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 3,
        color: CONF_COLORS[Math.floor(Math.random() * CONF_COLORS.length)],
        rot: Math.random() * Math.PI * 2, rspd: (Math.random() - 0.5) * 0.25,
        w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, life: 0 };
    });
    const TOTAL = 150;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        p.life++;
        if (p.life > TOTAL) continue;
        alive = true;
        p.vy += 0.13;
        p.x += p.vx; p.y += p.vy; p.rot += p.rspd;
        const alpha = Math.max(0, 1 - p.life / TOTAL);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[70]" />;
}
