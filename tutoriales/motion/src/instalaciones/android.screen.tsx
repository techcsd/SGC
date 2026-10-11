import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };
const Fill: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, ...style }}>{children}</div>
);
const Status: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', color: dark ? '#fff' : C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 15, zIndex: 8 }}>
    <span>9:41</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>100%
      <span style={{ display: 'inline-block', width: 22, height: 12, border: `2px solid ${dark ? '#fff' : C.ink}`, borderRadius: 3 }} />
    </span>
  </div>
);

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const dlg = interpolate(frame, [atOf(2) - 6, atOf(2) + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const inst = interpolate(frame, [atOf(3), atOf(3) + 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // fase 0-3: navegador; fase 3 también muestra el diálogo→instalando; fase 4: inicio; fase 5: app.
  if (fase <= 3) {
    return (
      <Fill style={{ background: '#eef1f6' }}>
        <Status />
        {/* barra de navegador */}
        <div style={{ position: 'absolute', top: 44, left: 16, right: 16, height: 46, background: '#fff', borderRadius: 999, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', color: C.mut, fontSize: 16 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.mut} strokeWidth={2.2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          sgcconstructorasd.com
        </div>
        {/* contenido */}
        <div style={{ position: 'absolute', top: 120, left: 24, right: 24, bottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 92, height: 92, borderRadius: 22, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800, fontSize: 44, marginTop: 26 }}>S</div>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30, marginTop: 18 }}>App móvil SGC</div>
          <div style={{ color: C.mut, fontSize: 16, marginTop: 8, lineHeight: 1.4 }}>Descárgala e instálala en tu teléfono Android.</div>
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <div style={{ background: C.naranja, color: '#fff', fontFamily: BODY, fontWeight: 800, fontSize: 22, padding: '18px 0', borderRadius: 14, textAlign: 'center' }}>Descargar APK</div>
            <div style={{ color: C.mut, fontSize: 13, marginTop: 10 }}>o escanea el QR de esta página</div>
          </div>
        </div>
        {/* diálogo de instalación (fase 2) → instalando (fase 3) */}
        {dlg > 0.01 && fase < 3 && (
          <>
            <Fill style={{ background: `rgba(0,0,0,${0.4 * dlg})` }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderRadius: '22px 22px 0 0', padding: 24, transform: `translateY(${(1 - dlg) * 260}px)` }}>
              <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 24 }}>¿Instalar SGC?</div>
              <div style={{ color: C.mut, fontSize: 15, marginTop: 8, lineHeight: 1.4 }}>Permite instalar apps de esta fuente para continuar.</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <div style={{ flex: 1, textAlign: 'center', padding: '14px 0', borderRadius: 12, border: `1px solid ${C.line}`, color: C.mut, fontWeight: 700, fontSize: 18 }}>Cancelar</div>
                <div style={{ flex: 1, textAlign: 'center', padding: '14px 0', borderRadius: 12, background: C.naranja, color: '#fff', fontWeight: 800, fontSize: 18 }}>Instalar</div>
              </div>
            </div>
          </>
        )}
        {fase >= 3 && (
          <>
            <Fill style={{ background: 'rgba(0,0,0,.4)' }} />
            <div style={{ position: 'absolute', left: 40, right: 40, top: '42%', background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center' }}>
              <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 22 }}>{inst >= 1 ? 'Instalada' : 'Instalando…'}</div>
              <div style={{ height: 8, background: C.line, borderRadius: 999, marginTop: 16, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${inst * 100}%`, background: C.naranja }} />
              </div>
            </div>
          </>
        )}
      </Fill>
    );
  }

  // fase 4: pantalla de inicio con ícono SGC. fase 5: app abierta.
  if (fase === 4) {
    const icons = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4'];
    return (
      <Fill style={{ background: 'linear-gradient(160deg, #2a4a74, #14243a)' }}>
        <Status dark />
        <div style={{ position: 'absolute', top: 90, left: 28, right: 28, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22 }}>
          {/* SGC primero, resaltado */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 62, height: 62, borderRadius: 16, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800, fontSize: 30, boxShadow: `0 0 0 4px ${C.naranja}` }}>S</div>
            <span style={{ color: '#fff', fontSize: 13 }}>SGC</span>
          </div>
          {icons.map((c, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 62, height: 62, borderRadius: 16, background: c }} />
              <span style={{ color: '#fff', fontSize: 13, opacity: 0.8 }}>App</span>
            </div>
          ))}
        </div>
      </Fill>
    );
  }

  return (
    <Fill style={{ background: '#f4f6fa' }}>
      <Status dark />
      <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 56, background: C.navy, display: 'flex', alignItems: 'center', padding: '0 20px', color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 20 }}>SGC</div>
      <div style={{ position: 'absolute', top: 130, left: 24, right: 24, textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, borderRadius: 20, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800, fontSize: 38, margin: '10px auto 0' }}>S</div>
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 26, marginTop: 18 }}>Bienvenido</div>
        <div style={{ color: C.mut, fontSize: 15, marginTop: 4 }}>Entra con tu usuario</div>
        <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Usuario</div>
        <div style={{ marginTop: 10, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Contraseña</div>
        <div style={{ marginTop: 16, background: C.naranja, color: '#fff', fontWeight: 800, fontSize: 18, padding: '14px 0', borderRadius: 12 }}>Entrar</div>
      </div>
    </Fill>
  );
};
