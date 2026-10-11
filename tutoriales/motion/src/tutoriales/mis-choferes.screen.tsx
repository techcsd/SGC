import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD, AppShell, Boton } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

const Chip: React.FC<{ texto: string; color: string; bg: string }> = ({ texto, color, bg }) => (
  <span style={{ display: 'inline-block', background: bg, color, fontFamily: BODY, fontWeight: 700, fontSize: 15, padding: '5px 14px', borderRadius: 999 }}>{texto}</span>
);

const Card: React.FC<{ nombre: string; iniciales: string; estado: React.ReactNode; detalle: string; accion?: React.ReactNode }> =
  ({ nombre, iniciales, estado, detalle, accion }) => (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, boxShadow: '0 2px 10px rgba(16,27,45,.05)', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 230 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontWeight: 800, fontSize: 22 }}>{iniciales}</div>
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 22 }}>{nombre}</div>
      </div>
      <div>{estado}</div>
      <div style={{ color: C.mut, fontSize: 16 }}>{detalle}</div>
      <div style={{ marginTop: 'auto' }}>{accion}</div>
    </div>
  );

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const toast = interpolate(frame, [atOf(5), atOf(5) + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <AppShell active="Flota" breadcrumb="Transporte · Mis choferes">
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Mis choferes</div>
        <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Estado del equipo en tiempo real</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 24 }}>
          <Card nombre="Juan Pérez" iniciales="JP"
            estado={fase >= 5 ? <Chip texto="En ruta" color={C.naranja} bg="#fff7ed" /> : <Chip texto="Disponible" color="#16a34a" bg="#eafaf0" />}
            detalle={fase >= 5 ? 'Nueva ruta → Residencial Sur' : 'Sin ruta asignada'}
            accion={fase >= 5 ? null : <Boton primario style={{ fontSize: 16, padding: '11px 20px', outline: fase === 4 ? `3px solid ${C.naranja}66` : 'none' }}>Asignar ruta</Boton>} />
          <Card nombre="Pedro Gómez" iniciales="PG"
            estado={<Chip texto="En ruta" color={C.naranja} bg="#fff7ed" />}
            detalle="Llevando material → Torre Norte" />
          <Card nombre="Carlos Méndez" iniciales="CM"
            estado={<Chip texto="Descansando" color={C.mut} bg="#eef1f6" />}
            detalle="Vuelve mañana" />
        </div>
      </AppShell>

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>Ruta asignada a Juan Pérez</span>
          </div>
        </div>
      )}
    </>
  );
};
