import React, { useEffect, useRef } from 'react';

const N = 32;

// Audio-reactive equalizer driven by live loudness (`level` 0..1) streamed from
// the server. Bars are taller in the centre and animated for liveliness; they
// swell with Sesame's voice. Renders to a canvas for smooth 60fps.
export default function Visualizer({ level }) {
  const canvasRef = useRef(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bars = new Array(N).fill(0.05);
    let raf, t = 0;
    let smooth = 0;

    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      t += 0.09;
      const L = levelRef.current;
      smooth += (L - smooth) * 0.25;

      const gap = 4;
      const bw = (W - gap * (N - 1)) / N;
      for (let i = 0; i < N; i++) {
        const center = 1 - Math.abs(i - (N - 1) / 2) / ((N - 1) / 2);
        const wave = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 0.55);
        const idle = 0.06 + 0.04 * (0.5 + 0.5 * Math.sin(t * 1.3 + i));
        const target = Math.max(idle, smooth * (0.35 + 0.65 * center) * (0.45 + 0.55 * wave));
        bars[i] += (target - bars[i]) * 0.35;

        const h = Math.max(2, bars[i] * H);
        const x = i * (bw + gap);
        const y = (H - h) / 2;
        const grad = ctx.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, '#2dc46e');
        grad.addColorStop(1, '#1d8048');
        ctx.fillStyle = grad;
        const r = Math.min(bw / 2, 4);
        roundRect(ctx, x, y, bw, h, r);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={560} height={90} className="viz-canvas" />;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
