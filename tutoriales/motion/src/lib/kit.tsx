import React from 'react';
import {
  AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig,
  interpolate, spring, Easing, delayRender, continueRender,
} from 'remotion';

// ════════════════════════════════════════════════════════════════════════════
//  KIT de motion graphics SGC (reusable) — estilo "guiado": la app a pantalla
//  completa, cámara con close-up que SIGUE el cursor, captions, números que
//  cuentan. Lo usan el promo y los tutoriales. Ver .claude/skills/sgc-video.
// ════════════════════════════════════════════════════════════════════════════

// ── Paleta / tipos (tokens de la app) ──
export const C = {
  navy: '#1e3a5f', navy2: '#17304d', deep: '#0e1726', naranja: '#f97316',
  ink: '#0f1b2d', card: '#ffffff', line: '#e6eaf0', mut: '#6b7a90', bg: '#f4f6fa',
};
export const BODY = 'Inter, system-ui, sans-serif';
export const HEAD = 'InterTight, Inter, system-ui, sans-serif';
export const WORLD = { w: 1920, h: 1080 };

// Carga de fuentes (una vez en el Chromium de render).
let fuentesPedidas = false;
export function cargarFuentes() {
  if (fuentesPedidas) return; fuentesPedidas = true;
  const h = delayRender('fuentes');
  Promise.all([
    new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
    new FontFace('InterTight', `url(${staticFile('inter-tight.woff2')})`, { weight: '100 900' }).load(),
  ]).then((fs) => { fs.forEach((f) => (document as unknown as { fonts: FontFaceSet }).fonts.add(f)); continueRender(h); })
    .catch(() => continueRender(h));
}

// Interpola a través de keyframes {at, v} con easing suave.
export const kf = (frame: number, pts: { at: number; v: number }[]) =>
  interpolate(frame, pts.map((p) => p.at), pts.map((p) => p.v),
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });

export type Beat = { at: number; x: number; y: number; s: number; cap?: string; click?: boolean };

// ── Cámara: centra (x,y) del mundo en el viewport con escala s, siguiendo beats ──
export const Camara: React.FC<{ beats: Beat[]; children: React.ReactNode }> = ({ beats, children }) => {
  const frame = useCurrentFrame();
  const x = kf(frame, beats.map((b) => ({ at: b.at, v: b.x })));
  const y = kf(frame, beats.map((b) => ({ at: b.at, v: b.y })));
  const s = kf(frame, beats.map((b) => ({ at: b.at, v: b.s })));
  // Clamp a los bordes del mundo: la cámara nunca muestra "vacío" más allá de la app.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const tx = clamp(WORLD.w / 2 - x * s, WORLD.w * (1 - s), 0);
  const ty = clamp(WORLD.h / 2 - y * s, WORLD.h * (1 - s), 0);
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: WORLD.w, height: WORLD.h, transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: '0 0' }}>
      {children}
    </div>
  );
};

// ── Cursor: sigue los beats (con leve "humanidad"), contra-escalado a tamaño fijo.
//    Ripple de clic ANIMADO por frame (no CSS: Remotion congela el tiempo). ──
export const Cursor: React.FC<{ beats: Beat[] }> = ({ beats }) => {
  const frame = useCurrentFrame();
  const x = kf(frame - 4, beats.map((b) => ({ at: b.at, v: b.x }))) + Math.sin(frame / 12) * 3;
  const y = kf(frame - 4, beats.map((b) => ({ at: b.at, v: b.y }))) + Math.cos(frame / 14) * 3;
  const s = kf(frame, beats.map((b) => ({ at: b.at, v: b.s })));
  // Pequeño "apretón" al hacer clic (el cursor se encoge un instante).
  const clickBeat = [...beats].reverse().find((b) => b.click && frame >= b.at);
  const age = clickBeat ? frame - clickBeat.at : 999;
  const press = age >= 0 && age < 8 ? interpolate(age, [0, 4, 8], [1, 0.82, 1]) : 1;
  const ripples = age >= 0 && age < 22;
  const rk = (delay: number) => {
    const a = age - delay;
    const sc = interpolate(a, [0, 22], [0.25, 2.8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const op = interpolate(a, [0, 22], [0.75, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return { sc, op };
  };
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${(1 / s) * press})`, transformOrigin: '2px 4px', zIndex: 50 }}>
      {ripples && [0, 6].map((d, i) => {
        const { sc, op } = rk(d);
        return <div key={i} style={{ position: 'absolute', left: 2, top: 4, width: 48, height: 48, marginLeft: -24, marginTop: -24, borderRadius: '50%', border: `3px solid ${C.naranja}`, opacity: op, transform: `scale(${sc})` }} />;
      })}
      <svg width="34" height="34" viewBox="0 0 24 24" fill="#fff" stroke={C.navy} strokeWidth={1.5} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.5))' }}>
        <path d="M5 3l15 9-6 1.6L11 20z" />
      </svg>
    </div>
  );
};

// ── Confeti (por frame, determinista) — para cierres/éxitos ──
const COLORS = ['#f97316', '#1e3a5f', '#2e75b6', '#16a34a', '#fbbf24'];
export const Confetti: React.FC<{ startFrame: number; n?: number }> = ({ startFrame, n = 90 }) => {
  const frame = useCurrentFrame();
  const age = frame - startFrame;
  if (age < 0 || age > 150) return null;
  const parts = Array.from({ length: n }, (_, i) => {
    const seed = (i * 9301 + 49297) % 233280 / 233280;
    const seed2 = (i * 4096 + 150889) % 714025 / 714025;
    const x = seed * WORLD.w;
    const delay = Math.floor(seed2 * 16);
    const t = age - delay;
    const y = interpolate(t, [0, 120], [-40, WORLD.h + 60], { extrapolateLeft: 'clamp' });
    const sway = Math.sin((t + i) / 10) * 40;
    const rot = t * (4 + seed * 6);
    const op = interpolate(t, [0, 8, 100, 120], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const w = 8 + seed2 * 8;
    return { x: x + sway, y, rot, op, w, color: COLORS[i % COLORS.length], round: i % 3 === 0 };
  });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 60 }}>
      {parts.map((p, i) => (
        <div key={i} style={{ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.w * 1.4, background: p.color, opacity: p.op, borderRadius: p.round ? '50%' : 2, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </AbsoluteFill>
  );
};

// ── Puntos de progreso (arriba) ──
export const ProgressDots: React.FC<{ total: number; current: number }> = ({ total, current }) => (
  <div style={{ position: 'absolute', top: 26, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 40 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: `${C.deep}cc`, padding: '9px 16px', borderRadius: 999, boxShadow: '0 6px 20px rgba(0,0,0,.3)' }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{ width: i === current ? 28 : 9, height: 9, borderRadius: 999, background: i === current ? C.naranja : i < current ? '#ffffffdd' : '#ffffff44' }} />
      ))}
    </div>
  </div>
);

// ── Caption inferior, aparece/desaparece por beat ──
export const Caption: React.FC<{ beats: Beat[] }> = ({ beats }) => {
  const frame = useCurrentFrame();
  const current = [...beats].reverse().find((b) => frame >= b.at && b.cap) || beats.find((b) => b.cap);
  if (!current?.cap) return null;
  const o = interpolate(frame - current.at, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 54, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div style={{ maxWidth: '80%', background: `${C.navy}f0`, color: '#fff', fontFamily: HEAD, fontWeight: 700, fontSize: 36, padding: '16px 34px', borderRadius: 16, boxShadow: '0 14px 48px rgba(0,0,0,.45)', textAlign: 'center' }}>
        {current.cap}
      </div>
    </div>
  );
};

// ── Número que cuenta hacia arriba ──
export const CountUp: React.FC<{ to: number; prefix?: string; from?: number; dur?: number; style?: React.CSSProperties }> =
  ({ to, prefix = '', from = 0, dur = 50, style }) => {
    const frame = useCurrentFrame();
    const v = Math.round(interpolate(frame, [from, from + dur], [0, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    return <span style={style}>{prefix}{v.toLocaleString('es-DO')}</span>;
  };

// ── Shell de la app SGC (sidebar + topbar + contenido) ──
const NAV = ['Dashboard', 'Inventario', 'Compras', 'Proyectos', 'Flota', 'Tareas', 'Mensajes'];
export const AppShell: React.FC<{ active?: string; highlight?: string; breadcrumb?: string; children?: React.ReactNode }> =
  ({ active = 'Dashboard', highlight, breadcrumb = 'Constructora Scheker & Domínguez', children }) => (
    <div style={{ width: WORLD.w, height: WORLD.h, background: C.bg, display: 'flex', fontFamily: BODY }}>
      <div style={{ width: 240, background: C.navy, color: '#fff', padding: '22px 14px', flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 20px' }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: C.naranja, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800 }}>S</div>
          <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 20 }}>SGC</div>
        </div>
        {NAV.map((n) => {
          const on = n === active, hi = n === highlight;
          return (
            <div key={n} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, marginBottom: 4,
              background: on ? '#ffffff14' : hi ? `${C.naranja}26` : 'transparent',
              color: on || hi ? '#fff' : '#c7d2e0', fontWeight: on || hi ? 700 : 500, fontSize: 16,
              outline: hi ? `2px solid ${C.naranja}` : 'none',
            }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, background: on || hi ? C.naranja : '#ffffff22' }} />
              {n}
            </div>
          );
        })}
      </div>
      <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ height: 70, background: '#fff', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 28px', gap: 12 }}>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 18 }}>{breadcrumb}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#eef1f6' }} />
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>XT</div>
          </div>
        </div>
        <div style={{ padding: 28, flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );

// ── Primitivas UI mock reutilizables ──
export const Boton: React.FC<{ children: React.ReactNode; primario?: boolean; style?: React.CSSProperties }> = ({ children, primario, style }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: primario ? C.naranja : '#fff', color: primario ? '#fff' : C.ink, border: primario ? 'none' : `1px solid ${C.line}`, fontFamily: BODY, fontWeight: 700, fontSize: 18, padding: '12px 22px', borderRadius: 10, ...style }}>{children}</div>
);

export const Campo: React.FC<{ label: string; valor?: string; placeholder?: string; activo?: boolean; style?: React.CSSProperties }> =
  ({ label, valor, placeholder, activo, style }) => (
    <div style={{ marginBottom: 18, ...style }}>
      <div style={{ color: C.mut, fontFamily: BODY, fontSize: 15, fontWeight: 600, marginBottom: 7 }}>{label}</div>
      <div style={{ background: '#fff', border: `2px solid ${activo ? C.naranja : C.line}`, borderRadius: 10, padding: '13px 16px', fontSize: 18, color: valor ? C.ink : '#9aa7b8', minHeight: 24 }}>
        {valor || placeholder || ''}
      </div>
    </div>
  );

// Panel/overlay (drawer) que entra desde la derecha según `p` (0..1).
export const Drawer: React.FC<{ p: number; titulo: string; children: React.ReactNode }> = ({ p, titulo, children }) => (
  <>
    <AbsoluteFill style={{ background: `rgba(14,23,38,${0.35 * p})` }} />
    <div style={{ position: 'absolute', top: 0, right: 0, width: 720, height: WORLD.h, background: '#fff', boxShadow: '-20px 0 60px rgba(0,0,0,.25)', transform: `translateX(${(1 - p) * 760}px)`, padding: 32, overflow: 'hidden' }}>
      <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 28, marginBottom: 22 }}>{titulo}</div>
      {children}
    </div>
  </>
);

export { spring, interpolate, useCurrentFrame, useVideoConfig, AbsoluteFill, Easing };
