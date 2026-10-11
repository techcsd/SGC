import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { C, BODY, HEAD, WORLD, AppShell, Boton, Campo, Drawer } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  // Progreso del drawer: abre en fase 2, cierra en fase 8.
  const open = atOf(2), close = atOf(8);
  const drawerP = interpolate(frame, [open, open + 14, close, close + 14], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toast = interpolate(frame, [close, close + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <AppShell active="Inventario" breadcrumb="Constructora Scheker & Domínguez">
        {/* Encabezado + botón Nueva */}
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Requisiciones</div>
            <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Pide material para tus obras</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <Boton primario>+ Nueva requisición</Boton>
          </div>
        </div>
        {/* Tabla mock */}
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 160px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Folio</span><span>Obra</span><span>Solicita</span><span>Estado</span>
          </div>
          {[
            { f: 'REQ-0042', o: 'OBRA DEMO — Torre Norte', s: 'Xavier T.', e: 'Aprobada', col: '#16a34a' },
            { f: 'REQ-0041', o: 'OBRA DEMO — Residencial Sur', s: 'Xavier T.', e: 'Pendiente', col: C.naranja },
          ].map((r) => (
            <div key={r.f} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 160px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.f}</span><span>{r.o}</span><span>{r.s}</span>
              <span style={{ color: r.col, fontWeight: 700 }}>{r.e}</span>
            </div>
          ))}
          {/* Fila nueva al terminar */}
          {fase >= 8 && (
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 160px', gap: 12, padding: '16px 20px', borderTop: `2px solid ${C.naranja}`, fontSize: 16, color: C.ink, alignItems: 'center', background: '#fff7ed' }}>
              <span style={{ fontWeight: 700 }}>REQ-0043</span><span>OBRA DEMO — Torre Norte</span><span>Xavier T.</span>
              <span style={{ color: C.naranja, fontWeight: 700 }}>Pendiente</span>
            </div>
          )}
        </div>
      </AppShell>

      {/* Drawer "Nueva requisición" */}
      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Nueva requisición">
          <Campo label="Obra" activo={fase === 2 || fase === 3}
            valor={fase >= 3 ? 'OBRA DEMO — Torre Norte' : undefined} placeholder="— Elige la obra —" />

          <div style={{ color: C.mut, fontFamily: BODY, fontSize: 15, fontWeight: 600, margin: '6px 0 7px' }}>Materiales</div>
          <Campo label="" activo={fase === 4} valor={fase >= 4 ? 'Cemento gris 42.5 (saco)' : undefined} placeholder="— Elige un material —" style={{ marginBottom: 10 }} />
          {fase >= 4 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f7f9fc', border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
              <span style={{ flex: 1, color: C.ink, fontSize: 17 }}>Cemento gris 42.5 (saco)</span>
              <div style={{ width: 120, background: '#fff', border: `2px solid ${fase === 5 ? C.naranja : C.line}`, borderRadius: 8, padding: '8px 12px', textAlign: 'center', fontSize: 18, fontWeight: 700, color: fase >= 5 ? C.ink : '#9aa7b8' }}>{fase >= 5 ? '100' : '0'}</div>
            </div>
          )}

          <Campo label="Fecha de necesidad" activo={fase === 6} valor={fase >= 6 ? '15 / 10 / 2026' : undefined} placeholder="dd / mm / aaaa" />
          <Campo label="¿Para qué? (motivo)" activo={fase === 6} valor={fase >= 6 ? 'Fundición de la losa del nivel 3' : undefined} placeholder="Explica para qué es…" />

          <div style={{ marginTop: 14 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 7 ? `3px solid ${C.naranja}66` : 'none' }}>Enviar requisición</Boton>
          </div>
        </Drawer>
      )}

      {/* Toast de éxito */}
      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#ffffff', border: `1px solid ${C.line}`, borderLeft: `6px solid #16a34a`, borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>¡Requisición REQ-0043 creada!</span>
          </div>
        </div>
      )}
    </>
  );
};
