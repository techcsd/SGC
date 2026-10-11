import React from 'react';
import { interpolate } from 'remotion';
import { C, HEAD, AppShell, Boton, Campo, Drawer } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const open = atOf(2), close = atOf(7);
  const drawerP = interpolate(frame, [open, open + 14, close, close + 14], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toast = interpolate(frame, [close, close + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const filas = [
    { c: 'CND-0008', m: 'Bloques → Torre Norte', ch: fase >= 7 ? 'Juan Pérez' : 'Pedro Gómez', e: 'Entregado', col: '#16a34a', t: false },
    { c: 'CND-0007', m: 'Cemento → Residencial Sur', ch: fase >= 7 ? 'Juan Pérez' : 'Pedro Gómez', e: 'En tránsito', col: C.naranja, t: fase < 7 },
  ];

  return (
    <>
      <AppShell active="Flota" breadcrumb="Transporte · Conduces">
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Conduces</div>
        <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Traza cada entrega de material</div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 200px 150px 170px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Conduce</span><span>Material</span><span>Chofer</span><span>Estado</span><span></span>
          </div>
          {filas.map((r) => (
            <div key={r.c} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 200px 150px 170px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.c}</span>
              <span>{r.m}</span>
              <span>{r.ch}</span>
              <span style={{ color: r.col, fontWeight: 700 }}>{r.e}</span>
              <span>{r.t ? <Boton primario style={{ fontSize: 15, padding: '9px 18px' }}>Transferir</Boton> : null}</span>
            </div>
          ))}
        </div>
      </AppShell>

      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Transferir — CND-0007">
          <Campo label="Material" valor="Cemento → OBRA DEMO — Residencial Sur" />
          <Campo label="Nuevo chofer" activo={fase === 2 || fase === 3} valor={fase >= 3 ? 'Juan Pérez (chofer)' : undefined} placeholder="— ¿Quién lo lleva? —" />
          <Campo label="Quién recibe en la obra" activo={fase === 4} valor={fase >= 4 ? 'Encargado de obra (demo)' : undefined} placeholder="— Elige el receptor —" />
          <Campo label="Motivo del cambio" activo={fase === 5} valor={fase >= 5 ? 'El chofer original se enfermó' : undefined} placeholder="Explica el porqué…" />
          <div style={{ marginTop: 16 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 6 ? `3px solid ${C.naranja}66` : 'none' }}>Transferir conduce</Boton>
          </div>
        </Drawer>
      )}

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Conduce CND-0007 transferido a Juan Pérez</span>
          </div>
        </div>
      )}
    </>
  );
};
