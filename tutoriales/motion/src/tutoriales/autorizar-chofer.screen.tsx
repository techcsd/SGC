import React from 'react';
import { interpolate } from 'remotion';
import { C, HEAD, AppShell, Boton, Campo, Drawer } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const open = atOf(2), close = atOf(5);
  const drawerP = interpolate(frame, [open, open + 14, close, close + 14], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toast = interpolate(frame, [close, close + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <AppShell active="Flota" breadcrumb="Flota · Choferes privados">
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Choferes privados</div>
        <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Autoriza qué vehículos puede usar cada uno</div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 220px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Chofer</span><span>Vehículos autorizados</span><span></span>
          </div>
          {[
            { n: 'Carlos Méndez', a: '1 vehículo' },
            { n: 'Juan Pérez', a: fase >= 5 ? 'Camión DEMO-002' : 'Ninguno', pend: true },
          ].map((r) => (
            <div key={r.n} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 220px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.n}</span>
              <span style={{ color: r.a === 'Ninguno' ? C.mut : C.ink }}>{r.a}</span>
              <span>{r.pend ? <Boton primario style={{ fontSize: 15, padding: '9px 18px' }}>Autorizar vehículo</Boton> : null}</span>
            </div>
          ))}
        </div>
      </AppShell>

      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Autorizar vehículo — Juan Pérez">
          <Campo label="Vehículo" activo={fase === 2} valor={fase >= 2 ? 'Camión DEMO-002' : undefined} placeholder="— Elige el vehículo —" />
          <Campo label="Autorizado hasta" activo={fase === 3} valor={fase >= 3 ? '31 / 12 / 2026' : undefined} placeholder="dd / mm / aaaa" />
          <div style={{ marginTop: 14 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 4 ? `3px solid ${C.naranja}66` : 'none' }}>Autorizar</Boton>
          </div>
        </Drawer>
      )}

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Juan Pérez autorizado · Camión DEMO-002</span>
          </div>
        </div>
      )}
    </>
  );
};
