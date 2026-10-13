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
      <AppShell active="Flota" breadcrumb="Flota · Responsabilidad">
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Responsabilidad de vehículos</div>
            <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Quién tiene cada vehículo ahora mismo</div>
          </div>
          <div style={{ marginLeft: 'auto' }}><Boton primario>+ Tomar un vehículo</Boton></div>
        </div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 150px 150px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Vehículo</span><span>Responsable</span><span>Desde</span><span>Estado</span>
          </div>
          {[
            { v: 'Camión DEMO-002', r: 'Pedro Gómez (demo)', d: 'Hoy 7:10 a.m.', e: 'En uso' },
          ].map((r) => (
            <div key={r.v} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 150px 150px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.v}</span><span>{r.r}</span><span>{r.d}</span>
              <span style={{ color: '#16a34a', fontWeight: 700 }}>{r.e}</span>
            </div>
          ))}
          {fase >= 7 && (
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 150px 150px', gap: 12, padding: '16px 20px', borderTop: `2px solid ${C.naranja}`, fontSize: 16, color: C.ink, alignItems: 'center', background: '#fff7ed' }}>
              <span style={{ fontWeight: 700 }}>Camión DEMO-001</span><span>Tú (demo)</span><span>Ahora</span>
              <span style={{ color: '#16a34a', fontWeight: 700 }}>En uso</span>
            </div>
          )}
        </div>
      </AppShell>

      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Tomar un vehículo">
          <Campo label="Vehículo" activo={fase === 2} valor={fase >= 2 ? 'Camión DEMO-001' : undefined} placeholder="— Elige el vehículo —" />
          <Campo label="Kilometraje de salida" activo={fase === 3} valor={fase >= 3 ? '48,355 km' : undefined} placeholder="km con el que lo recibes" />
          <Campo label="Estado (luces · llantas · aceite)" activo={fase === 4} valor={fase >= 4 ? 'Todo bien ✓' : undefined} placeholder="Revisa el estado" />
          <Campo label="Firma de quien recibe" activo={fase === 5} valor={fase >= 5 ? 'Firmado ✓' : undefined} placeholder="Firma con el dedo" />
          <div style={{ marginTop: 14 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 6 ? `3px solid ${C.naranja}66` : 'none' }}>Tomar vehículo</Boton>
          </div>
        </Drawer>
      )}

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Tomaste el Camión DEMO-001 · ahora eres responsable</span>
          </div>
        </div>
      )}
    </>
  );
};
