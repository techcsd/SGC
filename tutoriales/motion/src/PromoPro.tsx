import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig,
  interpolate, spring,
} from 'remotion';
import { C, BODY, HEAD, WORLD, Camara, cargarFuentes, Confetti } from './lib/kit';
import { SCREENS } from './tutoriales/registry';

cargarFuentes();

const DEEP = C.deep, NAVY = C.navy, NARANJA = C.naranja;

// Escenas del promo: cada una muestra una pantalla mock con un push-in de cámara + rótulo.
const ESCENAS = [
  { screen: 'crear-requisicion', fase: 0, modulo: 'Inventario', frase: 'Pide y despacha material sin perder nada' },
  { screen: 'transferir-conduce', fase: 0, modulo: 'Conduces', frase: 'Traza cada entrega, de punta a punta' },
  { screen: 'registrar-mantenimiento', fase: 0, modulo: 'Flota', frase: 'Vehículos y mantenimientos al día' },
  { screen: 'mis-choferes', fase: 0, modulo: 'Transporte', frase: 'Tu equipo, en tiempo real' },
];
const INTRO = 96, ESC = 96, OUTRO = 108;
export const PROMOPRO_DUR = INTRO + ESCENAS.length * ESC + OUTRO;

const Intro: React.FC = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const o = interpolate(frame, [0, 12, INTRO - 14, INTRO], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  const logoS = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const titS = spring({ frame: frame - 8, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: o }}>
      <Img src={staticFile('logo.png')} style={{ width: 150, marginBottom: 24, transform: `scale(${logoS})`, filter: 'drop-shadow(0 10px 30px rgba(0,0,0,.5))' }} />
      <div style={{ color: '#fff', opacity: 0.72, fontFamily: BODY, fontSize: 26, letterSpacing: 10, textTransform: 'uppercase' }}>Constructora SD</div>
      <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 190, lineHeight: 1, letterSpacing: -4, transform: `scale(${0.8 + titS * 0.2})` }}>SGC</div>
      <div style={{ color: NARANJA, fontFamily: BODY, fontWeight: 600, fontSize: 38, marginTop: 4 }}>Todo tu negocio, en un solo lugar</div>
    </AbsoluteFill>
  );
};

const Escena: React.FC<{ e: typeof ESCENAS[number] }> = ({ e }) => {
  const frame = useCurrentFrame();
  const Pantalla = SCREENS[e.screen];
  const o = interpolate(frame, [0, 10, ESC - 10, ESC], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Push-in lento, alternando lado.
  const beats = [
    { at: 0, x: 980, y: 440, s: 1.06 },
    { at: ESC, x: 1040, y: 470, s: 1.16 },
  ];
  const rotX = interpolate(frame, [6, 24], [-60, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rotO = interpolate(frame, [6, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: DEEP, opacity: o }}>
      <AbsoluteFill>
        <Camara beats={beats}>
          {/* atOf con valores separados (y futuros) → los drawers/toasts quedan cerrados en fase 0. */}
          {Pantalla ? <Pantalla fase={e.fase} frame={0} atOf={(x) => 100000 + x * 1000} /> : null}
        </Camara>
      </AbsoluteFill>
      {/* Rótulo */}
      <div style={{ position: 'absolute', left: 70, bottom: 80, transform: `translateX(${rotX}px)`, opacity: rotO }}>
        <div style={{ display: 'inline-block', background: NARANJA, color: '#fff', fontFamily: BODY, fontWeight: 800, fontSize: 26, padding: '8px 20px', borderRadius: 999, letterSpacing: 1 }}>{e.modulo}</div>
        <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 56, maxWidth: 820, marginTop: 14, textShadow: '0 8px 30px rgba(0,0,0,.6)' }}>{e.frase}</div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const o = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const s = spring({ frame, fps, config: { damping: 15 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: o }}>
      <Img src={staticFile('logo.png')} style={{ width: 120, marginBottom: 22, transform: `scale(${0.8 + s * 0.2})` }} />
      <div style={{ color: '#fff', fontFamily: HEAD, fontWeight: 800, fontSize: 70, letterSpacing: -1, textAlign: 'center', maxWidth: '80%' }}>Tu obra, bajo control.</div>
      <div style={{ marginTop: 26, background: NARANJA, color: '#fff', fontFamily: BODY, fontWeight: 700, fontSize: 34, padding: '14px 36px', borderRadius: 14 }}>sgcconstructorasd.com</div>
      <Confetti startFrame={6} n={70} />
    </AbsoluteFill>
  );
};

// Fondo degradado con blobs (igual que el promo base).
const Fondo: React.FC = () => {
  const frame = useCurrentFrame();
  const bx = interpolate(Math.sin(frame / 90), [-1, 1], [-60, 60]);
  const by = interpolate(Math.cos(frame / 110), [-1, 1], [-40, 40]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(130% 120% at 25% 0%, ${NAVY} 0%, ${DEEP} 70%)` }}>
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', left: 1100 + bx, top: -300 + by, background: `radial-gradient(circle, ${NARANJA}2e 0%, transparent 65%)` }} />
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 420px rgba(0,0,0,.55)' }} />
    </AbsoluteFill>
  );
};

export const PromoPro: React.FC = () => (
  <AbsoluteFill style={{ background: DEEP }}>
    <Sequence durationInFrames={INTRO}><Fondo /><Intro /></Sequence>
    {ESCENAS.map((e, i) => (
      <Sequence key={i} from={INTRO + i * ESC} durationInFrames={ESC}><Escena e={e} /></Sequence>
    ))}
    <Sequence from={INTRO + ESCENAS.length * ESC}><Fondo /><Outro /></Sequence>
    <Audio src={staticFile('music.mp3')} volume={(f) => interpolate(f, [0, 20, PROMOPRO_DUR - 25, PROMOPRO_DUR], [0, 0.55, 0.55, 0], { extrapolateRight: 'clamp' })} />
  </AbsoluteFill>
);
