import React from 'react';
import { interpolate } from 'remotion';
import { C, BODY, HEAD } from '../lib/kit';

type P = { fase: number; frame: number; atOf: (fase: number) => number };

const Fill: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, ...style }}>{children}</div>
);

const Status: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', color: dark ? '#fff' : C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 15, zIndex: 8 }}>
    <span>9:41</span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>100%
      <span style={{ display: 'inline-block', width: 22, height: 11, border: `2px solid ${dark ? '#fff' : C.ink}`, borderRadius: 3 }} />
    </span>
  </div>
);

// Ícono de la CSD App (cuadro navy + "CSD" + punto naranja del logo).
const CsdIcon: React.FC<{ size: number; ring?: boolean }> = ({ size, ring }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.24, background: C.navy, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: ring ? `0 0 0 4px ${C.naranja}` : 'none' }}>
    <span style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: size * 0.32, letterSpacing: 1 }}>CSD</span>
    <span style={{ position: 'absolute', left: size * 0.17, bottom: size * 0.17, width: size * 0.11, height: size * 0.11, borderRadius: '50%', background: C.naranja }} />
  </div>
);

const Btn: React.FC<{ children: React.ReactNode; ghost?: boolean; style?: React.CSSProperties }> = ({ children, ghost, style }) => (
  <div style={{ textAlign: 'center', padding: '15px 0', borderRadius: 13, fontFamily: BODY, fontWeight: 800, fontSize: 19, background: ghost ? 'transparent' : C.naranja, color: ghost ? C.mut : '#fff', border: ghost ? `1px solid ${C.line}` : 'none', ...style }}>{children}</div>
);

export const Pantalla: React.FC<P> = ({ fase, frame, atOf }) => {
  // 0 · Portada
  if (fase === 0) {
    return (
      <Fill style={{ background: `radial-gradient(130% 120% at 30% 0%, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <Status dark />
        <CsdIcon size={128} />
        <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 34 }}>CSD App</div>
        <div style={{ color: '#cdd8e6', fontSize: 18, textAlign: 'center', padding: '0 40px', lineHeight: 1.4 }}>Instala la CSD App en tu Android</div>
        <div style={{ color: C.naranja, fontWeight: 700, fontSize: 15, marginTop: 6 }}>1 minuto y medio</div>
      </Fill>
    );
  }

  // 1 · Navegador: enlace WhatsApp → página con "Descargar APK"
  if (fase === 1) {
    return (
      <Fill style={{ background: '#eef1f6' }}>
        <Status />
        <div style={{ position: 'absolute', top: 44, left: 14, right: 14, height: 42, background: '#fff', borderRadius: 999, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', color: C.mut, fontSize: 14 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.mut} strokeWidth={2.2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          sgcconstructorasd.com/app-movil
        </div>
        <div style={{ position: 'absolute', top: 112, left: 22, right: 22, bottom: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ marginTop: 24 }}><CsdIcon size={88} /></div>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 27, marginTop: 16 }}>CSD App</div>
          <div style={{ color: C.mut, fontSize: 15, marginTop: 8, lineHeight: 1.4 }}>La app de Constructora SD para tu teléfono Android.</div>
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <Btn>Descargar APK</Btn>
            <div style={{ color: C.mut, fontSize: 12, marginTop: 10 }}>o escanea el QR de esta página</div>
          </div>
        </div>
      </Fill>
    );
  }

  // 2 · Aviso de Chrome al descargar el APK
  if (fase === 2) {
    return (
      <Fill style={{ background: '#eef1f6' }}>
        <Status />
        <Fill style={{ background: 'rgba(0,0,0,.4)' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderRadius: '20px 20px 0 0', padding: 24 }}>
          <div style={{ color: C.mut, fontSize: 13, fontWeight: 700 }}>Chrome</div>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 21, marginTop: 8, lineHeight: 1.3 }}>Este tipo de archivo puede dañar tu dispositivo</div>
          <div style={{ color: C.mut, fontSize: 14, marginTop: 8 }}>Es seguro: es la app de la empresa.</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
            <Btn ghost style={{ flex: 1 }}>Cancelar</Btn>
            <Btn style={{ flex: 1.4, fontSize: 16 }}>Descargar de todas formas</Btn>
          </div>
        </div>
      </Fill>
    );
  }

  // 3 · Descarga completa → Abrir
  if (fase === 3) {
    return (
      <Fill style={{ background: '#eef1f6' }}>
        <Status />
        <div style={{ position: 'absolute', top: 48, left: 14, right: 14, background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,.12)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#e8edf5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.navy, fontWeight: 800, fontSize: 12 }}>APK</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 16 }}>Descarga completa</div>
            <div style={{ color: C.mut, fontSize: 13 }}>csd-app.apk</div>
          </div>
          <div style={{ background: C.naranja, color: '#fff', fontWeight: 800, fontSize: 15, padding: '9px 20px', borderRadius: 10 }}>Abrir</div>
        </div>
      </Fill>
    );
  }

  // 4 · Ajustes: permitir instalar de esta fuente (interruptor)
  if (fase === 4) {
    const on = interpolate(frame, [atOf(4) + 12, atOf(4) + 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (
      <Fill style={{ background: '#f4f6fa' }}>
        <Status />
        <div style={{ position: 'absolute', top: 48, left: 0, right: 0, height: 52, background: '#fff', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 20px', color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 18 }}>Instalar apps desconocidas</div>
        <div style={{ position: 'absolute', top: 160, left: 18, right: 18, background: '#fff', borderRadius: 16, padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#e8edf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.navy} strokeWidth={2}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 16 }}>Chrome</div>
            <div style={{ color: C.mut, fontSize: 13 }}>Permitir de esta fuente</div>
          </div>
          <div style={{ width: 52, height: 30, borderRadius: 999, background: on > 0.5 ? C.naranja : C.line, position: 'relative', transition: 'none' }}>
            <div style={{ position: 'absolute', top: 3, left: 3 + on * 22, width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
          </div>
        </div>
      </Fill>
    );
  }

  // 5 · Instalador del sistema → Instalar (con progreso)
  if (fase === 5) {
    const prog = interpolate(frame, [atOf(5) + 18, atOf(5) + 55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (
      <Fill style={{ background: '#e9edf3' }}>
        <Status />
        <div style={{ position: 'absolute', left: 24, right: 24, top: 180, background: '#fff', borderRadius: 20, padding: 26, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><CsdIcon size={72} /></div>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 22, marginTop: 14 }}>CSD App</div>
          {prog < 0.02 ? (
            <>
              <div style={{ color: C.mut, fontSize: 14, marginTop: 6 }}>¿Quieres instalar esta app?</div>
              <div style={{ marginTop: 20 }}><Btn>Instalar</Btn></div>
            </>
          ) : (
            <>
              <div style={{ color: C.mut, fontSize: 14, marginTop: 6 }}>{prog >= 1 ? 'Instalada' : 'Instalando…'}</div>
              <div style={{ height: 8, background: C.line, borderRadius: 999, marginTop: 18, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${prog * 100}%`, background: C.naranja }} />
              </div>
            </>
          )}
        </div>
      </Fill>
    );
  }

  // 6 · CSD App — login
  if (fase === 6) {
    return (
      <Fill style={{ background: '#f4f6fa' }}>
        <Status dark />
        <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 150, background: `linear-gradient(160deg, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <CsdIcon size={56} />
          <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 20 }}>CSD App</div>
        </div>
        <div style={{ position: 'absolute', top: 220, left: 24, right: 24, textAlign: 'center' }}>
          <div style={{ color: C.ink, fontFamily: HEAD, fontWeight: 800, fontSize: 24 }}>Bienvenido</div>
          <div style={{ color: C.mut, fontSize: 14, marginTop: 4 }}>Entra con tu usuario</div>
          <div style={{ marginTop: 18, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Usuario</div>
          <div style={{ marginTop: 10, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px', textAlign: 'left', color: C.mut }}>Contraseña</div>
          <div style={{ marginTop: 16 }}><Btn>Entrar</Btn></div>
          <div style={{ color: C.mut, fontSize: 13, marginTop: 14 }}>o entra con tu cédula y tu PIN</div>
        </div>
      </Fill>
    );
  }

  // 7 · Listo
  const pop = interpolate(frame, [atOf(7) + 4, atOf(7) + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Fill style={{ background: `radial-gradient(130% 120% at 30% 0%, ${C.navy}, ${C.deep})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Status dark />
      <div style={{ width: 92, height: 92, borderRadius: '50%', background: '#12b76a', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${pop})` }}>
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 28 }}>¡Listo!</div>
      <div style={{ color: '#cdd8e6', fontSize: 16, textAlign: 'center', padding: '0 44px', lineHeight: 1.4 }}>Permite los avisos y la ubicación para que te lleguen tus trabajos.</div>
      <div style={{ marginTop: 10, background: '#ffffff18', border: '1px solid #ffffff33', borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 14, textAlign: 'center', maxWidth: 360 }}>¿Ya la tenías? Instala encima: no se borra nada.</div>
    </Fill>
  );
};
