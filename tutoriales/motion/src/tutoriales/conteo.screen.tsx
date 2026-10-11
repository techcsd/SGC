import React from 'react';
import { interpolate } from 'remotion';
import { C, HEAD, AppShell, Boton } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

const Fila: React.FC<{ nombre: string; sistema: number; contado: number | null; activo?: boolean }> = ({ nombre, sistema, contado, activo }) => {
  const dif = contado == null ? null : contado - sistema;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 180px 160px', gap: 12, padding: '16px 22px', borderTop: `1px solid ${C.line}`, fontSize: 18, color: C.ink, alignItems: 'center', background: activo ? '#fff7ed' : '#fff' }}>
      <span style={{ fontWeight: 600 }}>{nombre}</span>
      <span style={{ color: C.mut, fontVariantNumeric: 'tabular-nums' }}>{sistema.toLocaleString('es-DO')}</span>
      <div style={{ width: 130, background: '#fff', border: `2px solid ${activo ? C.naranja : C.line}`, borderRadius: 8, padding: '8px 12px', textAlign: 'center', fontSize: 18, fontWeight: 700, color: contado == null ? '#9aa7b8' : C.ink, fontVariantNumeric: 'tabular-nums' }}>{contado == null ? '—' : contado.toLocaleString('es-DO')}</div>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: dif == null ? C.mut : dif === 0 ? '#16a34a' : '#b42318' }}>{dif == null ? '' : dif === 0 ? 'cuadra' : dif}</span>
    </div>
  );
};

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const toast = interpolate(frame, [atOf(7), atOf(7) + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // fase < 2 → lista de conteos; fase >= 2 → hoja de conteo.
  if (fase < 2) {
    return (
      <AppShell active="Inventario" breadcrumb="Inventario · Conteos">
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Conteos de inventario</div>
            <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Cuadra el sistema con lo que hay</div>
          </div>
          <div style={{ marginLeft: 'auto' }}><Boton primario>+ Nuevo conteo</Boton></div>
        </div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 160px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Fecha</span><span>Almacén</span><span>Responsable</span><span>Estado</span>
          </div>
          {[{ d: '28 / 09 / 2026', a: 'Almacén Central', r: 'Xavier T.' }, { d: '31 / 08 / 2026', a: 'Almacén Torre Norte', r: 'Xavier T.' }].map((r) => (
            <div key={r.d} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 160px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.d}</span><span>{r.a}</span><span>{r.r}</span><span style={{ color: '#16a34a', fontWeight: 700 }}>Cerrado</span>
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <>
      <AppShell active="Inventario" breadcrumb="Inventario · Conteos">
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Conteo físico — Almacén Central</div>
        <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Escribe la cantidad real que contaste</div>
        <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 180px 160px', gap: 12, padding: '14px 22px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Material</span><span>Sistema</span><span>Contado</span><span>Diferencia</span>
          </div>
          <Fila nombre="Cemento gris 42.5 (saco)" sistema={320} contado={fase >= 3 ? 315 : null} activo={fase === 3} />
          <Fila nombre='Varilla 1/2" (unidad)' sistema={540} contado={fase >= 4 ? 540 : null} activo={fase === 4} />
          <Fila nombre='Bloque 6" (unidad)' sistema={1200} contado={fase >= 5 ? 1180 : null} activo={fase === 5} />
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ color: C.mut, fontSize: 15, fontWeight: 600, marginBottom: 7 }}>Observación</div>
          <div style={{ background: '#fff', border: `2px solid ${fase === 5 ? C.naranja : C.line}`, borderRadius: 10, padding: '13px 16px', fontSize: 17, color: fase >= 5 ? C.ink : '#9aa7b8', minHeight: 24 }}>
            {fase >= 5 ? 'Faltan 20 bloques — rotura en el almacén.' : 'Explica las diferencias…'}
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 6 ? `3px solid ${C.naranja}66` : 'none' }}>Cerrar conteo</Boton>
        </div>
      </AppShell>

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Conteo cerrado · diferencias ajustadas</span>
          </div>
        </div>
      )}
    </>
  );
};
