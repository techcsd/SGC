import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

const Fill: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, ...style }}>{children}</div>
);

const Status: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', color: dark ? '#fff' : C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 15, zIndex: 8 }}>
    <span>9:41</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>100%
      <span style={{ display: 'inline-block', width: 22, height: 11, border: `2px solid ${dark ? '#fff' : C.ink}`, borderRadius: 3 }} />
    </span>
  </div>
);

const CsdIcon: React.FC<{ size: number; ring?: boolean }> = ({ size, ring }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.24, background: C.navy, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: ring ? `0 0 0 5px ${C.naranja}` : 'none' }}>
    <span style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: size * 0.32, letterSpacing: 1 }}>CSD</span>
    <span style={{ position: 'absolute', left: size * 0.17, bottom: size * 0.17, width: size * 0.11, height: size * 0.11, borderRadius: '50%', background: C.naranja }} />
  </div>
);

// Barra inferior de Safari con el botón Compartir.
const SafariBar: React.FC<{ hiShare?: boolean }> = ({ hiShare }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 72, background: '#f2f2f7', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-around', color: '#3478f6' }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3478f6" strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b9c0cc" strokeWidth={2}><path d="M9 6l6 6-6 6" /></svg>
    <div style={{ padding: hiShare ? 6 : 0, borderRadius: 10, background: hiShare ? '#3478f622' : 'transparent', boxShadow: hiShare ? `0 0 0 2px #3478f6` : 'none' }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3478f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 7l4-4 4 4" /><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /></svg>
    </div>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3478f6" strokeWidth={2}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="8" y="8" width="16" height="16" rx="2" /></svg>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3478f6" strokeWidth={2}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M7 20h10" /></svg>
  </div>
);

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  // 0 · Portada
  if (fase === 0) {
    return (
      <Fill style={{ background: `radial-gradient(130% 120% at 30% 0%, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <Status dark />
        <CsdIcon size={128} />
        <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 34 }}>CSD App</div>
        <div style={{ color: '#cdd8e6', fontSize: 18, textAlign: 'center', padding: '0 40px', lineHeight: 1.4 }}>Instala la CSD App en tu iPhone</div>
        <div style={{ color: C.naranja, fontWeight: 700, fontSize: 15, marginTop: 6 }}>Un minuto</div>
      </Fill>
    );
  }

  // 1 · Safari con la URL app.sgcconstructorasd.com
  // 2 · igual, resaltando el botón Compartir
  if (fase === 1 || fase === 2) {
    return (
      <Fill style={{ background: '#fff' }}>
        <Status />
        <div style={{ position: 'absolute', top: 44, left: 12, right: 12, height: 42, background: '#f2f2f7', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.ink, fontSize: 15, fontWeight: 600 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.mut} strokeWidth={2.2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          app.sgcconstructorasd.com
        </div>
        <div style={{ position: 'absolute', top: 120, left: 22, right: 22, bottom: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ marginTop: 40 }}><CsdIcon size={96} /></div>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 28, marginTop: 18 }}>CSD App</div>
          <div style={{ color: C.mut, fontSize: 15, marginTop: 8, lineHeight: 1.4 }}>Agrégala a tu pantalla de inicio para usarla como una app.</div>
        </div>
        <SafariBar hiShare={fase === 2} />
      </Fill>
    );
  }

  // 3 · Hoja de Compartir con "Añadir a pantalla de inicio"
  if (fase === 3) {
    return (
      <Fill style={{ background: '#fff' }}>
        <Status />
        <Fill style={{ background: 'rgba(0,0,0,.25)' }} />
        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, background: '#f2f2f7', borderRadius: 18, padding: 14 }}>
          <div style={{ display: 'flex', gap: 12, padding: '6px 6px 14px', borderBottom: `1px solid ${C.line}` }}>
            <CsdIcon size={46} />
            <div><div style={{ color: C.ink, fontWeight: 700, fontSize: 16 }}>CSD App</div><div style={{ color: C.mut, fontSize: 13 }}>app.sgcconstructorasd.com</div></div>
          </div>
          {['Copiar', 'Añadir a Favoritos'].map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 6px', borderBottom: `1px solid ${C.line}`, color: C.ink, fontSize: 16 }}>{t}<span style={{ color: C.mut }}>○</span></div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 6px', color: C.ink, fontSize: 16, fontWeight: 700, background: '#e7effd', borderRadius: 10, boxShadow: `0 0 0 2px #3478f6` }}>
            Añadir a pantalla de inicio
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth={2}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
          </div>
        </div>
      </Fill>
    );
  }

  // 4 · Diálogo "Añadir a pantalla de inicio" → nombre CSD App + Añadir
  if (fase === 4) {
    return (
      <Fill style={{ background: '#e9edf3' }}>
        <Status />
        <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 54, background: '#f7f8fa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px' }}>
          <span style={{ color: '#3478f6', fontSize: 16 }}>Cancelar</span>
          <span style={{ color: C.ink, fontWeight: 800, fontSize: 17, fontFamily: HEAD }}>Pantalla de inicio</span>
          <span style={{ color: '#3478f6', fontSize: 16, fontWeight: 800, background: '#e7effd', padding: '6px 14px', borderRadius: 10, boxShadow: `0 0 0 2px #3478f6` }}>Añadir</span>
        </div>
        <div style={{ position: 'absolute', top: 130, left: 18, right: 18, background: '#fff', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <CsdIcon size={56} />
          <div style={{ flex: 1, borderBottom: `1px solid ${C.line}`, paddingBottom: 8 }}>
            <div style={{ color: C.ink, fontWeight: 700, fontSize: 18 }}>CSD App</div>
          </div>
        </div>
        <div style={{ position: 'absolute', top: 210, left: 22, right: 22, color: C.mut, fontSize: 13 }}>Un ícono para abrir la CSD App aparecerá en tu pantalla de inicio.</div>
      </Fill>
    );
  }

  // 5 · Pantalla de inicio de iOS con el ícono CSD App
  if (fase === 5) {
    const pulse = 1 + Math.sin((frame - atOf(5)) / 9) * 0.04;
    const apps = ['#34c759', '#007aff', '#ff9500', '#ff3b30', '#5856d6', '#30b0c7', '#ffcc00', '#8e8e93'];
    return (
      <Fill style={{ background: 'linear-gradient(170deg, #4a6fa5, #22314a)' }}>
        <Status dark />
        <div style={{ position: 'absolute', top: 96, left: 30, right: 30, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '28px 22px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, transform: `scale(${pulse})` }}>
            <CsdIcon size={60} ring />
            <span style={{ color: '#fff', fontSize: 12 }}>CSD App</span>
          </div>
          {apps.map((c, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 60, height: 60, borderRadius: 15, background: c }} />
              <span style={{ color: '#fff', fontSize: 12, opacity: 0.85 }}>App</span>
            </div>
          ))}
        </div>
      </Fill>
    );
  }

  // 6 · CSD App — login + permitir avisos
  if (fase === 6) {
    const dlg = interpolate(frame, [atOf(6) + 20, atOf(6) + 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (
      <Fill style={{ background: '#f4f6fa' }}>
        <Status dark />
        <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 150, background: `linear-gradient(160deg, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <CsdIcon size={56} />
          <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 20 }}>CSD App</div>
        </div>
        <div style={{ position: 'absolute', top: 220, left: 24, right: 24, textAlign: 'center' }}>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 24 }}>Bienvenido</div>
          <div style={{ marginTop: 18, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Usuario</div>
          <div style={{ marginTop: 10, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Contraseña</div>
          <div style={{ marginTop: 16, background: C.naranja, color: '#fff', fontWeight: 800, fontSize: 18, padding: '14px 0', borderRadius: 12 }}>Entrar</div>
        </div>
        {dlg > 0.02 && (
          <div style={{ position: 'absolute', left: 30, right: 30, top: '40%', background: '#fff', borderRadius: 16, padding: 22, textAlign: 'center', transform: `scale(${0.9 + dlg * 0.1})`, opacity: dlg }}>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 17 }}>«CSD App» quiere enviarte avisos</div>
            <div style={{ color: C.mut, fontSize: 13, marginTop: 6 }}>Para avisarte de tus trabajos.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <div style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: `1px solid ${C.line}`, color: C.mut, fontWeight: 700 }}>No permitir</div>
              <div style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: C.naranja, color: '#fff', fontWeight: 800 }}>Permitir</div>
            </div>
          </div>
        )}
      </Fill>
    );
  }

  // 7 · Listo
  const pop = interpolate(frame, [atOf(7) + 4, atOf(7) + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Fill style={{ background: `radial-gradient(130% 120% at 30% 0%, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Status dark />
      <div style={{ width: 92, height: 92, borderRadius: '50%', background: '#12b76a', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${pop})` }}>
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 28 }}>¡Listo!</div>
      <div style={{ color: '#cdd8e6', fontSize: 16, textAlign: 'center', padding: '0 44px', lineHeight: 1.4 }}>Ya está instalada. Ábrela siempre desde su ícono, no desde Safari.</div>
      <div style={{ marginTop: 10, background: '#ffffff18', border: '1px solid #ffffff33', borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 14 }}>¿Dudas? Míralo otra vez en Dudas › Instalar.</div>
    </Fill>
  );
};
