import React from 'react';
import {
  AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig,
  interpolate, spring, Easing, delayRender, continueRender,
} from 'remotion';

// ── Paleta SGC ──
const NAVY = '#1e3a5f';
const NAVY2 = '#17304d';
const DEEP = '#0e1726';
const NARANJA = '#f97316';
const INK = '#0f1b2d';
const CARD = '#ffffff';
const LINE = '#e6eaf0';
const MUT = '#6b7a90';
const BODY = 'Inter, system-ui, sans-serif';
const HEAD = 'InterTight, Inter, system-ui, sans-serif';

const hf = delayRender('fuentes-demo');
Promise.all([
  new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
  new FontFace('InterTight', `url(${staticFile('inter-tight.woff2')})`, { weight: '100 900' }).load(),
]).then((fs) => { fs.forEach((f) => (document as unknown as { fonts: FontFaceSet }).fonts.add(f)); continueRender(hf); })
  .catch(() => continueRender(hf));

// Interpola un valor a través de keyframes {at, v}.
const kf = (frame: number, pts: { at: number; v: number }[]) =>
  interpolate(frame, pts.map((p) => p.at), pts.map((p) => p.v),
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });

// ── "Beats" de la cámara/cursor: cada uno apunta a un punto del mundo (1920x1080) ──
// La cámara centra ese punto y hace zoom; el cursor va al mismo punto → la cámara lo sigue.
const BEATS = [
  { at: 0, x: 960, y: 470, s: 1.0, cap: 'Tu operación, de un vistazo' },
  { at: 60, x: 360, y: 300, s: 1.8, cap: 'Valor de inventario, al instante' },
  { at: 135, x: 1180, y: 300, s: 1.7, cap: 'Flota y alertas, siempre al día' },
  { at: 210, x: 700, y: 760, s: 1.6, cap: 'Movimientos y pendientes en vivo' },
  { at: 285, x: 120, y: 430, s: 1.9, cap: 'Todo un módulo, a un clic' },
  { at: 350, x: 960, y: 470, s: 1.0, cap: 'SGC — hecho para tu obra' },
];
const DUR = 420;

// Número que cuenta hacia arriba cuando su tarjeta se enfoca.
const CountUp: React.FC<{ to: number; prefix?: string; from?: number; dur?: number; style?: React.CSSProperties }> =
  ({ to, prefix = '', from = 0, dur = 50, style }) => {
    const frame = useCurrentFrame();
    const v = Math.round(interpolate(frame, [from, from + dur], [0, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    return <span style={style}>{prefix}{v.toLocaleString('es-DO')}</span>;
  };

const navItems = ['Dashboard', 'Inventario', 'Compras', 'Proyectos', 'Flota', 'Tareas', 'Mensajes'];

// KPI mock
const Kpi: React.FC<{ label: string; children: React.ReactNode; accent?: boolean }> = ({ label, children, accent }) => (
  <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 10px rgba(16,27,45,.05)', minWidth: 0 }}>
    <div style={{ color: MUT, fontFamily: BODY, fontSize: 15, fontWeight: 500 }}>{label}</div>
    <div style={{ color: accent ? NARANJA : INK, fontFamily: HEAD, fontWeight: 800, fontSize: 34, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{children}</div>
  </div>
);

// ── El "mundo": la app SGC mockeada (1920x1080) ──
const AppMundo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const navHi = frame > 270; // resalta "Inventario" al final
  const bars = [40, 62, 48, 80, 58, 72, 35];
  return (
    <div style={{ width: 1920, height: 1080, background: '#f4f6fa', display: 'flex', fontFamily: BODY }}>
      {/* Sidebar */}
      <div style={{ width: 240, background: NAVY, color: '#fff', padding: '22px 14px', flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 20px' }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: NARANJA, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800 }}>S</div>
          <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 20 }}>SGC</div>
        </div>
        {navItems.map((n, i) => {
          const active = i === 0;
          const hi = navHi && n === 'Inventario';
          return (
            <div key={n} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, marginBottom: 4,
              background: active ? '#ffffff14' : hi ? `${NARANJA}26` : 'transparent',
              color: active || hi ? '#fff' : '#c7d2e0', fontWeight: active || hi ? 700 : 500, fontSize: 16,
              outline: hi ? `2px solid ${NARANJA}` : 'none',
            }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, background: active || hi ? NARANJA : '#ffffff22' }} />
              {n}
            </div>
          );
        })}
      </div>
      {/* Main */}
      <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
        {/* Topbar */}
        <div style={{ height: 70, background: '#fff', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', padding: '0 28px', gap: 12 }}>
          <div style={{ color: INK, fontFamily: HEAD, fontWeight: 700, fontSize: 18 }}>Constructora Scheker & Domínguez</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#eef1f6' }} />
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>XT</div>
          </div>
        </div>
        {/* Contenido */}
        <div style={{ padding: 28, flex: 1 }}>
          <div style={{ color: INK, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Bienvenido, Xavier</div>
          <div style={{ color: MUT, fontSize: 16, marginTop: 2 }}>Resumen general del sistema</div>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 20 }}>
            <Kpi label="Valor de inventario"><CountUp to={4820000} prefix="RD$ " from={55} dur={55} /></Kpi>
            <Kpi label="Proyectos en progreso"><CountUp to={7} from={55} dur={40} /></Kpi>
            <Kpi label="Vehículos activos"><CountUp to={34} from={120} dur={40} /></Kpi>
            <Kpi label="Alertas de flota" accent><CountUp to={5} from={120} dur={40} /></Kpi>
            <Kpi label="Entregas por confirmar"><CountUp to={12} from={120} dur={40} /></Kpi>
            <Kpi label="Solicitudes pendientes" accent><CountUp to={9} from={120} dur={40} /></Kpi>
            <Kpi label="Checklists de hoy"><CountUp to={18} from={120} dur={40} /></Kpi>
            <Kpi label="Tareas pendientes"><CountUp to={23} from={120} dur={40} /></Kpi>
          </div>
          {/* Paneles */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 18 }}>
            <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: 22, height: 300 }}>
              <div style={{ color: INK, fontFamily: HEAD, fontWeight: 700, fontSize: 18 }}>Movimientos de inventario — últimos 7 días</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, height: 180, marginTop: 24, paddingLeft: 6 }}>
                {bars.map((b, i) => {
                  const grow = spring({ frame: frame - 150 - i * 4, fps, config: { damping: 14 } });
                  return <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: '100%', maxWidth: 46, height: b * 2 * grow, background: i % 2 ? NARANJA : NAVY, borderRadius: 8 }} />
                    <div style={{ color: MUT, fontSize: 13 }}>{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][i]}</div>
                  </div>;
                })}
              </div>
            </div>
            <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: 22, height: 300 }}>
              <div style={{ color: INK, fontFamily: HEAD, fontWeight: 700, fontSize: 18 }}>Solicitudes pendientes</div>
              {['Cemento — Torre Norte', 'Varilla 1/2" — Res. Sur', 'Bloques — Torre Norte'].map((t, i) => {
                const show = interpolate(frame, [190 + i * 10, 205 + i * 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 4px', borderBottom: `1px solid ${LINE}`, opacity: show }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: NARANJA }} />
                  <div style={{ color: INK, fontSize: 15, fontWeight: 600 }}>{t}</div>
                  <div style={{ marginLeft: 'auto', color: MUT, fontSize: 13 }}>hoy</div>
                </div>;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Cursor (contra-escala para tamaño constante) ──
const Cursor: React.FC<{ x: number; y: number; inv: number; click?: boolean }> = ({ x, y, inv, click }) => (
  <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${inv})`, transformOrigin: '0 0', zIndex: 50 }}>
    {click && <div style={{ position: 'absolute', left: -4, top: -2, width: 40, height: 40, marginLeft: -20, marginTop: -20, borderRadius: '50%', border: `3px solid ${NARANJA}`, opacity: 0.8 }} />}
    <svg width="34" height="34" viewBox="0 0 24 24" fill="#fff" stroke={NAVY} strokeWidth={1.5} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.5))' }}>
      <path d="M5 3l15 9-6 1.6L11 20z" />
    </svg>
  </div>
);

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const camX = kf(frame, BEATS.map((b) => ({ at: b.at, v: b.x })));
  const camY = kf(frame, BEATS.map((b) => ({ at: b.at, v: b.y })));
  const camS = kf(frame, BEATS.map((b) => ({ at: b.at, v: b.s })));
  // Transform de cámara: centra (camX,camY) en el viewport (960,540) con escala camS.
  const tx = 960 - camX * camS;
  const ty = 540 - camY * camS;

  // Cursor sigue el mismo punto, con leve retraso/oscilación para sentirse "humano".
  const curX = kf(frame - 4, BEATS.map((b) => ({ at: b.at, v: b.x }))) + Math.sin(frame / 12) * 3;
  const curY = kf(frame - 4, BEATS.map((b) => ({ at: b.at, v: b.y }))) + Math.cos(frame / 14) * 3;
  // Click cuando llega a cada beat (ventana corta tras cada 'at').
  const clicking = BEATS.some((b) => frame >= b.at && frame < b.at + 8 && b.at > 0);

  // Caption actual
  const current = [...BEATS].reverse().find((b) => frame >= b.at) || BEATS[0];
  const capO = interpolate((frame - current.at), [0, 10, 60, 72], [0, 1, 1, 0.9], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: DEEP }}>
      {/* Mundo con cámara */}
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transform: `translate(${tx}px, ${ty}px) scale(${camS})`, transformOrigin: '0 0' }}>
          <AppMundo />
          <Cursor x={curX} y={curY} inv={1 / camS} click={clicking} />
        </div>
      </AbsoluteFill>
      {/* Caption */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 54, display: 'flex', justifyContent: 'center', opacity: capO }}>
        <div style={{ background: `${NAVY}f0`, color: '#fff', fontFamily: HEAD, fontWeight: 700, fontSize: 36, padding: '16px 34px', borderRadius: 16, boxShadow: '0 14px 48px rgba(0,0,0,.45)', backdropFilter: 'blur(4px)' }}>
          {current.cap}
        </div>
      </div>
      <Audio src={staticFile('music.mp3')} volume={(f) => interpolate(f, [0, 20, DUR - 25, DUR], [0, 0.55, 0.55, 0], { extrapolateRight: 'clamp' })} />
    </AbsoluteFill>
  );
};

export const DEMO_DUR = DUR;
