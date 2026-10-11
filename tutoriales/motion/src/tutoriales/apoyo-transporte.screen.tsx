import React from 'react';
import { interpolate } from 'remotion';
import { C, HEAD, AppShell, Boton, Campo, Drawer } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const open = atOf(2), close = atOf(6);
  const drawerP = interpolate(frame, [open, open + 14, close, close + 14], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toast = interpolate(frame, [close, close + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <AppShell active="Flota" breadcrumb="Transporte · Apoyo">
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Apoyo de transporte</div>
            <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Pide un vehículo cuando lo necesites</div>
          </div>
          <div style={{ marginLeft: 'auto' }}><Boton primario>+ Nueva solicitud</Boton></div>
        </div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr 150px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Folio</span><span>Origen → Destino</span><span>Carga</span><span>Estado</span>
          </div>
          {[
            { f: 'AP-0031', r: 'Central → Torre Norte', c: 'Bloques', e: 'Asignado', col: '#16a34a' },
          ].map((r) => (
            <div key={r.f} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr 150px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.f}</span><span>{r.r}</span><span>{r.c}</span><span style={{ color: r.col, fontWeight: 700 }}>{r.e}</span>
            </div>
          ))}
          {fase >= 6 && (
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr 150px', gap: 12, padding: '16px 20px', borderTop: `2px solid ${C.naranja}`, fontSize: 16, color: C.ink, alignItems: 'center', background: '#fff7ed' }}>
              <span style={{ fontWeight: 700 }}>AP-0032</span><span>Central → Residencial Sur</span><span>Cemento y varilla</span><span style={{ color: C.naranja, fontWeight: 700 }}>Pendiente</span>
            </div>
          )}
        </div>
      </AppShell>

      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Nueva solicitud de apoyo">
          <Campo label="Punto de origen" activo={fase === 2} valor={fase >= 2 ? 'Almacén Central' : undefined} placeholder="— ¿Desde dónde? —" />
          <Campo label="Destino" activo={fase === 3} valor={fase >= 3 ? 'OBRA DEMO — Residencial Sur' : undefined} placeholder="— ¿A qué obra? —" />
          <Campo label="¿Qué se mueve?" activo={fase === 4} valor={fase >= 4 ? 'Cemento y varilla (media tonelada)' : undefined} placeholder="Describe la carga…" />
          <div style={{ marginTop: 14 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 5 ? `3px solid ${C.naranja}66` : 'none' }}>Enviar solicitud</Boton>
          </div>
        </Drawer>
      )}

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Solicitud AP-0032 enviada a transporte</span>
          </div>
        </div>
      )}
    </>
  );
};
