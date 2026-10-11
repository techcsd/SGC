import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };
const Fill: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, ...style }}>{children}</div>
);
const ShareIcon: React.FC<{ color: string; on?: boolean }> = ({ color, on }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ filter: on ? `drop-shadow(0 0 6px ${C.naranja})` : 'none' }}>
    <path d="M12 3v13M8 7l4-4 4 4" /><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </svg>
);

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const sheet = interpolate(frame, [atOf(2) - 6, atOf(2) + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const addDlg = interpolate(frame, [atOf(3) - 4, atOf(3) + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // fase 4: inicio. fase 5: app.
  if (fase === 4) {
    const icons = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4', '#f97316'];
    return (
      <Fill style={{ background: 'linear-gradient(160deg, #3a5b86, #16243a)' }}>
        <div style={{ position: 'absolute', top: 8, left: 26, color: '#fff', fontFamily: BODY, fontWeight: 700, fontSize: 15 }}>9:41</div>
        <div style={{ position: 'absolute', top: 96, left: 28, right: 28, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800, fontSize: 32, boxShadow: `0 0 0 4px ${C.naranja}` }}>S</div>
            <span style={{ color: '#fff', fontSize: 13 }}>SGC</span>
          </div>
          {icons.map((c, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, background: c }} />
              <span style={{ color: '#fff', fontSize: 13, opacity: 0.8 }}>App</span>
            </div>
          ))}
        </div>
      </Fill>
    );
  }
  if (fase === 5) {
    return (
      <Fill style={{ background: '#f4f6fa' }}>
        <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 56, background: C.navy, display: 'flex', alignItems: 'center', padding: '0 20px', color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 20 }}>SGC</div>
        <div style={{ position: 'absolute', top: 140, left: 24, right: 24, textAlign: 'center' }}>
          <div style={{ width: 80, height: 80, borderRadius: 20, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800, fontSize: 38, margin: '0 auto' }}>S</div>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 26, marginTop: 18 }}>Bienvenido</div>
          <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Usuario</div>
          <div style={{ marginTop: 10, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Contraseña</div>
          <div style={{ marginTop: 16, background: C.naranja, color: '#fff', fontWeight: 800, fontSize: 18, padding: '14px 0', borderRadius: 12 }}>Entrar</div>
        </div>
      </Fill>
    );
  }

  // fase 0-3: Safari.
  return (
    <Fill style={{ background: '#eef1f6' }}>
      <div style={{ position: 'absolute', top: 8, left: 26, color: C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 15 }}>9:41</div>
      {/* barra URL arriba (Safari) */}
      <div style={{ position: 'absolute', top: 40, left: 16, right: 16, height: 42, background: '#fff', borderRadius: 12, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.mut, fontSize: 15 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.mut} strokeWidth={2.2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        sgcconstructorasd.com
      </div>
      {/* contenido página */}
      <div style={{ position: 'absolute', top: 108, left: 24, right: 24, textAlign: 'center' }}>
        <div style={{ width: 84, height: 84, borderRadius: 20, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800, fontSize: 40, margin: '20px auto 0' }}>S</div>
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 28, marginTop: 16 }}>App móvil SGC</div>
        <div style={{ color: C.mut, fontSize: 15, marginTop: 8, lineHeight: 1.4 }}>En iPhone se instala como app web desde Safari.</div>
      </div>
      {/* barra inferior de Safari con Compartir */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 72, background: '#f7f8fa', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-around', color: C.mut }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.mut} strokeWidth={2.2}><path d="M15 18l-6-6 6-6" /></svg>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c7ced8" strokeWidth={2.2}><path d="M9 18l6-6-6-6" /></svg>
        <ShareIcon color={fase === 1 ? C.naranja : C.ink} on={fase === 1} />
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.mut} strokeWidth={2.2}><path d="M4 19.5V6a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15" /></svg>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.mut} strokeWidth={2.2}><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
      </div>

      {/* Share sheet (fase 2) */}
      {sheet > 0.01 && fase < 3 && (
        <>
          <Fill style={{ background: `rgba(0,0,0,${0.35 * sheet})` }} />
          <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, background: '#f2f3f5', borderRadius: 18, padding: 16, transform: `translateY(${(1 - sheet) * 300}px)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 12, padding: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>S</div>
              <div><div style={{ color: C.ink, fontWeight: 700, fontSize: 16 }}>App móvil SGC</div><div style={{ color: C.mut, fontSize: 13 }}>sgcconstructorasd.com</div></div>
            </div>
            {[{ t: 'Copiar', on: false }, { t: 'Agregar a Favoritos', on: false }, { t: 'Agregar a pantalla de inicio', on: true }].map((r) => (
              <div key={r.t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderRadius: 12, padding: '15px 14px', marginTop: 10, color: C.ink, fontSize: 17, fontWeight: r.on ? 700 : 500, outline: r.on ? `2px solid ${C.naranja}` : 'none' }}>
                {r.t}
                <span style={{ width: 26, height: 26, borderRadius: 6, border: `2px solid ${r.on ? C.naranja : C.line}` }} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Diálogo "Agregar a pantalla de inicio" (fase 3) */}
      {fase >= 3 && (
        <>
          <Fill style={{ background: `rgba(0,0,0,${0.35 * addDlg})` }} />
          <div style={{ position: 'absolute', left: 14, right: 14, top: 44, background: '#f2f3f5', borderRadius: 16, padding: 16, transform: `translateY(${(1 - addDlg) * -40}px)`, opacity: addDlg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: C.mut, fontSize: 17 }}>Cancelar</span>
              <span style={{ color: C.ink, fontWeight: 800, fontSize: 18 }}>Pantalla de inicio</span>
              <span style={{ color: C.naranja, fontWeight: 800, fontSize: 18 }}>Agregar</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 12, padding: 12, marginTop: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24 }}>S</div>
              <div style={{ color: C.ink, fontWeight: 700, fontSize: 17 }}>SGC</div>
            </div>
          </div>
        </>
      )}
    </Fill>
  );
};
