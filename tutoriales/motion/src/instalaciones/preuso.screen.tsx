import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };
const Fill: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, ...style }}>{children}</div>
);
const Status: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', color: dark ? '#fff' : C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 15, zIndex: 8 }}>
    <span>9:41</span><span>100%</span>
  </div>
);
const CsdIcon: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.24, background: C.navy, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <span style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: size * 0.32 }}>CSD</span>
    <span style={{ position: 'absolute', left: size * 0.17, bottom: size * 0.17, width: size * 0.11, height: size * 0.11, borderRadius: '50%', background: C.naranja }} />
  </div>
);

const Check: React.FC<{ label: string; on: boolean; hi?: boolean }> = ({ label, on, hi }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${hi ? C.naranja : C.line}`, borderRadius: 12, padding: '14px 16px', boxShadow: hi ? `0 0 0 3px ${C.naranja}44` : 'none' }}>
    <div style={{ width: 26, height: 26, borderRadius: 7, background: on ? '#16a34a' : '#fff', border: `2px solid ${on ? '#16a34a' : C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {on && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
    </div>
    <span style={{ flex: 1, color: C.ink, fontSize: 16, fontWeight: 600 }}>{label}</span>
    <span style={{ color: on ? '#16a34a' : C.mut, fontSize: 14, fontWeight: 700 }}>{on ? 'Bien' : '—'}</span>
  </div>
);

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  if (fase === 0) {
    return (
      <Fill style={{ background: `radial-gradient(130% 120% at 30% 0%, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <Status dark /><CsdIcon size={120} />
        <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Pre-uso</div>
        <div style={{ color: '#cdd8e6', fontSize: 17, textAlign: 'center', padding: '0 40px' }}>Revisa el vehículo antes de usarlo</div>
      </Fill>
    );
  }
  if (fase === 7) {
    const pop = interpolate(frame, [atOf(7) + 4, atOf(7) + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (
      <Fill style={{ background: `radial-gradient(130% 120% at 30% 0%, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Status dark />
        <div style={{ width: 92, height: 92, borderRadius: '50%', background: '#12b76a', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${pop})` }}>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 26 }}>¡Pre-uso enviado!</div>
        <div style={{ color: '#cdd8e6', fontSize: 16, textAlign: 'center', padding: '0 44px' }}>Ya puedes usar el Camión DEMO-001.</div>
      </Fill>
    );
  }
  // fases 1-6: pantalla de inspección
  const foto = fase >= 5;
  return (
    <Fill style={{ background: '#f4f6fa' }}>
      <Status dark />
      <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 92, background: `linear-gradient(160deg, ${C.navy}, ${C.deep})`, display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px' }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: '#ffffff22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}><rect x="2" y="8" width="16" height="9" rx="2" /><path d="M18 11h3l1 3v3h-4" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>
        </div>
        <div><div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 19 }}>Camión DEMO-001</div>
          <div style={{ color: '#cdd8e6', fontSize: 13 }}>Pre-uso · tu vehículo asignado</div></div>
      </div>
      <div style={{ position: 'absolute', top: 160, left: 18, right: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Check label="Luces" on={fase >= 2} hi={fase === 2} />
        <Check label="Llantas" on={fase >= 3} hi={fase === 3} />
        <Check label="Frenos y aceite" on={fase >= 4} hi={fase === 4} />
        <div style={{ marginTop: 6, background: '#fff', border: `1px solid ${foto ? C.naranja : C.line}`, borderRadius: 12, padding: '16px', textAlign: 'center', boxShadow: fase === 5 ? `0 0 0 3px ${C.naranja}44` : 'none' }}>
          {foto ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#16a34a', fontWeight: 700 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={3}><polyline points="20 6 9 17 4 12" /></svg> Foto del tablero lista
            </div>
          ) : (
            <div style={{ color: C.mut, fontWeight: 600 }}>📷 Toma la foto del tablero</div>
          )}
        </div>
        <div style={{ marginTop: 8, background: fase >= 6 ? C.naranja : '#e7ebf1', color: fase >= 6 ? '#fff' : C.mut, fontFamily: BODY, fontWeight: 800, fontSize: 19, padding: '16px 0', borderRadius: 13, textAlign: 'center', boxShadow: fase === 6 ? `0 0 0 3px ${C.naranja}44` : 'none' }}>Enviar pre-uso</div>
      </div>
    </Fill>
  );
};
