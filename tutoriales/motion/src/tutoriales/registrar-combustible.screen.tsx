import React from 'react';
import { interpolate } from 'remotion';
import { C, HEAD, AppShell, Boton, Campo, Drawer } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const open = atOf(2), close = atOf(7);
  const drawerP = interpolate(frame, [open, open + 14, close, close + 14], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toast = interpolate(frame, [close, close + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <AppShell active="Flota" breadcrumb="Flota · Combustible">
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Combustible</div>
            <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Las echadas de tus vehículos y su rendimiento</div>
          </div>
          <div style={{ marginLeft: 'auto' }}><Boton primario>+ Registrar combustible</Boton></div>
        </div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '170px 110px 130px 140px 1fr', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Vehículo</span><span>Galones</span><span>Monto</span><span>Kilometraje</span><span>Rendimiento</span>
          </div>
          {[
            { v: 'Camión DEMO-001', g: '10.0', m: 'RD$ 2,800', k: '48,100 km', r: '9.2 km/gal' },
            { v: 'Camión DEMO-002', g: '14.0', m: 'RD$ 3,920', k: '61,540 km', r: '8.1 km/gal' },
          ].map((r) => (
            <div key={r.v} style={{ display: 'grid', gridTemplateColumns: '170px 110px 130px 140px 1fr', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.v}</span><span>{r.g}</span><span>{r.m}</span><span>{r.k}</span><span>{r.r}</span>
            </div>
          ))}
          {fase >= 7 && (
            <div style={{ display: 'grid', gridTemplateColumns: '170px 110px 130px 140px 1fr', gap: 12, padding: '16px 20px', borderTop: `2px solid ${C.naranja}`, fontSize: 16, color: C.ink, alignItems: 'center', background: '#fff7ed' }}>
              <span style={{ fontWeight: 700 }}>Camión DEMO-001</span><span>12.5</span><span>RD$ 3,500</span><span>48,355 km</span><span>8.9 km/gal</span>
            </div>
          )}
        </div>
      </AppShell>

      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Registrar combustible">
          <Campo label="Vehículo" activo={fase === 2} valor={fase >= 2 ? 'Camión DEMO-001' : undefined} placeholder="— Elige el vehículo —" />
          <Campo label="Galones" activo={fase === 3} valor={fase >= 3 ? '12.5 gal' : undefined} placeholder="Galones echados" />
          <Campo label="Monto (RD$)" activo={fase === 4} valor={fase >= 4 ? 'RD$ 3,500' : undefined} placeholder="Lo que pagaste" />
          <Campo label="Kilometraje del tablero" activo={fase === 5} valor={fase >= 5 ? '48,355 km' : undefined} placeholder="km del tablero" />
          <Campo label="Fotos (recibo y tablero)" activo={fase === 6} valor={fase >= 6 ? '2 fotos adjuntas' : undefined} placeholder="Sube las 2 fotos" />
          <div style={{ marginTop: 14 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 6 ? `3px solid ${C.naranja}66` : 'none' }}>Guardar</Boton>
          </div>
        </Drawer>
      )}

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Combustible registrado · 8.9 km/gal</span>
          </div>
        </div>
      )}
    </>
  );
};
