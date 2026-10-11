import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD, AppShell, Boton, Campo, Drawer } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const open = atOf(2), close = atOf(7);
  const drawerP = interpolate(frame, [open, open + 14, close, close + 14], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toast = interpolate(frame, [close, close + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <AppShell active="Flota" breadcrumb="Transporte · Conduces">
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Conduces</div>
            <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Documenta cada traslado de material</div>
          </div>
          <div style={{ marginLeft: 'auto' }}><Boton primario>+ Nuevo conduce</Boton></div>
        </div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 150px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Conduce</span><span>Material</span><span>Destino</span><span>Estado</span>
          </div>
          {[
            { c: 'CE-000124', m: 'Cemento (100)', d: 'Torre Norte', e: 'Entregado', col: '#16a34a' },
            { c: 'CE-000123', m: 'Varilla (50)', d: 'Residencial Sur', e: 'En tránsito', col: C.naranja },
          ].map((r) => (
            <div key={r.c} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 150px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.c}</span><span>{r.m}</span><span>{r.d}</span><span style={{ color: r.col, fontWeight: 700 }}>{r.e}</span>
            </div>
          ))}
          {fase >= 7 && (
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 150px', gap: 12, padding: '16px 20px', borderTop: `2px solid ${C.naranja}`, fontSize: 16, color: C.ink, alignItems: 'center', background: '#fff7ed' }}>
              <span style={{ fontWeight: 700 }}>CE-000125</span><span>Cemento (80)</span><span>Torre Norte</span><span style={{ color: C.naranja, fontWeight: 700 }}>Emitido</span>
            </div>
          )}
        </div>
      </AppShell>

      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Nuevo conduce">
          <Campo label="Almacén de origen" activo={fase === 2} valor={fase >= 2 ? 'Almacén Central' : undefined} placeholder="— ¿Desde dónde? —" />
          <Campo label="Obra destino" activo={fase === 3} valor={fase >= 3 ? 'OBRA DEMO — Torre Norte' : undefined} placeholder="— ¿A qué obra? —" />
          <Campo label="Chofer" activo={fase === 4} valor={fase >= 4 ? 'Juan Pérez (chofer)' : undefined} placeholder="— ¿Quién lo lleva? —" />
          <div style={{ color: C.mut, fontFamily: BODY, fontSize: 15, fontWeight: 700, margin: '6px 0 7px' }}>Material a transportar</div>
          <Campo label="" activo={fase === 5} valor={fase >= 5 ? 'Cemento gris 42.5 (saco)' : undefined} placeholder="— Elige un material —" style={{ marginBottom: 10 }} />
          {fase >= 5 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f7f9fc', border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
              <span style={{ flex: 1, color: C.ink, fontSize: 17 }}>Cemento gris 42.5 (saco)</span>
              <div style={{ width: 120, background: '#fff', border: `2px solid ${C.line}`, borderRadius: 8, padding: '8px 12px', textAlign: 'center', fontSize: 18, fontWeight: 700, color: C.ink }}>80</div>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 6 ? `3px solid ${C.naranja}66` : 'none' }}>Emitir conduce</Boton>
          </div>
        </Drawer>
      )}

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Conduce CE-000125 emitido</span>
          </div>
        </div>
      )}
    </>
  );
};
