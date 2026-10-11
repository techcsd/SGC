import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD, AppShell, Boton, Campo, Drawer } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

const Reng: React.FC<{ nombre: string; pedido: number; disp: number; despachar: number; show: boolean; activo?: boolean; falta?: number }> =
  ({ nombre, pedido, disp, despachar, show, activo, falta }) => (
    <div style={{ opacity: show ? 1 : 0.25, background: '#f7f9fc', border: `1px solid ${activo ? C.naranja : C.line}`, borderRadius: 10, padding: '12px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, color: C.ink, fontSize: 17, fontWeight: 600 }}>{nombre}</span>
        <span style={{ color: C.mut, fontSize: 14 }}>Pedido <b style={{ color: C.ink }}>{pedido}</b></span>
        <span style={{ color: C.mut, fontSize: 14 }}>Disp. <b style={{ color: C.ink }}>{disp}</b></span>
        <div style={{ width: 90, background: '#fff', border: `2px solid ${activo ? C.naranja : C.line}`, borderRadius: 8, padding: '7px 10px', textAlign: 'center', fontSize: 17, fontWeight: 700, color: C.ink }}>{show ? despachar : 0}</div>
      </div>
      {show && falta ? <div style={{ marginTop: 8, display: 'inline-block', background: '#fff7ed', color: C.naranja, border: `1px solid ${C.naranja}55`, borderRadius: 999, padding: '4px 12px', fontSize: 13, fontWeight: 700 }}>Faltan {falta} → se piden en compra</div> : null}
    </div>
  );

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  const open = atOf(2), close = atOf(7);
  const drawerP = interpolate(frame, [open, open + 14, close, close + 14], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toast = interpolate(frame, [close, close + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const filas = [
    { f: 'REQ-0042', o: 'OBRA DEMO — Torre Norte', e: 'Despachada', col: '#16a34a', pend: false },
    { f: 'REQ-0041', o: 'OBRA DEMO — Residencial Sur', e: fase >= 7 ? 'Despachada' : 'Pendiente', col: fase >= 7 ? '#16a34a' : C.naranja, pend: fase < 7 },
  ];

  return (
    <>
      <AppShell active="Inventario">
        <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>Requisiciones</div>
        <div style={{ color: C.mut, fontSize: 16, marginTop: 2 }}>Atiende lo que piden tus obras</div>
        <div style={{ marginTop: 22, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 150px 180px', gap: 12, padding: '14px 20px', background: '#f7f9fc', color: C.mut, fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Folio</span><span>Obra</span><span>Estado</span><span></span>
          </div>
          {filas.map((r) => (
            <div key={r.f} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 150px 180px', gap: 12, padding: '16px 20px', borderTop: `1px solid ${C.line}`, fontSize: 16, color: C.ink, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{r.f}</span>
              <span>{r.o}</span>
              <span style={{ color: r.col, fontWeight: 700 }}>{r.e}</span>
              <span>{r.pend ? <Boton primario style={{ fontSize: 15, padding: '9px 18px' }}>Atender</Boton> : null}</span>
            </div>
          ))}
        </div>
      </AppShell>

      {drawerP > 0.001 && (
        <Drawer p={drawerP} titulo="Atender — REQ-0041">
          <Campo label="Obra" valor="OBRA DEMO — Residencial Sur" />
          <Campo label="Almacén de origen" activo={fase === 2 || fase === 3} valor={fase >= 3 ? 'Almacén Central' : undefined} placeholder="— ¿Desde dónde? —" />

          <div style={{ color: C.mut, fontFamily: BODY, fontSize: 15, fontWeight: 700, margin: '10px 0 10px' }}>Material a despachar</div>
          <Reng nombre="Cemento gris 42.5 (saco)" pedido={100} disp={320} despachar={100} show={fase >= 4} activo={fase === 4} />
          <Reng nombre='Varilla 1/2" (unidad)' pedido={50} disp={30} despachar={30} show={fase >= 5} activo={fase === 5} falta={20} />

          <div style={{ marginTop: 18, color: C.mut, fontSize: 14 }}>Al aprobar se genera el conduce de salida.</div>
          <div style={{ marginTop: 16 }}>
            <Boton primario style={{ fontSize: 20, padding: '14px 28px', outline: fase === 6 ? `3px solid ${C.naranja}66` : 'none' }}>Aprobar y despachar</Boton>
          </div>
        </Drawer>
      )}

      {toast > 0.001 && (
        <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.line}`, borderLeft: '6px solid #16a34a', borderRadius: 12, padding: '16px 24px', boxShadow: '0 16px 50px rgba(0,0,0,.18)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <span style={{ color: C.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 20 }}>REQ-0041 despachada · Conduce CE-000124 generado</span>
          </div>
        </div>
      )}
    </>
  );
};
