import React from 'react';
import {
  AbsoluteFill, Sequence, Img, Audio, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing, delayRender, continueRender,
} from 'remotion';
import { INTRO, TAG, PER_SHOT } from './Root';

// ── Paleta SGC (tokens de la app) ──
const NAVY = '#1e3a5f';
const DEEP = '#0e1726';
const NARANJA = '#f97316';
const WHITE = '#ffffff';
const BODY = "Inter, system-ui, -apple-system, sans-serif";
const HEAD = "InterTight, Inter, system-ui, sans-serif";

// ── Fuentes (se cargan una vez en el Chromium de render) ──
const h = delayRender('fuentes');
Promise.all([
  new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
  new FontFace('InterTight', `url(${staticFile('inter-tight.woff2')})`, { weight: '100 900' }).load(),
]).then((fs) => { fs.forEach((f) => (document as unknown as { fonts: FontFaceSet }).fonts.add(f)); continueRender(h); })
  .catch(() => continueRender(h));

type Shot = { src: string; modulo: string; beneficio: string };
type Props = {
  shots: Shot[];
  titulo: string;
  marca: string;
  subtitulo: string;
  tagline: string[];
  dominio: string;
};

// Fade de entrada/salida dentro de un bloque de `len` frames.
const edgeFade = (f: number, len: number, inN = 12, outN = 12) =>
  interpolate(f, [0, inN, len - outN, len], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

// ── Fondo animado: degradado navy + blobs naranja flotando + viñeta ──
const Fondo: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = interpolate(frame, [0, durationInFrames], [0, 1]);
  const bx = interpolate(Math.sin(frame / 90), [-1, 1], [-60, 60]);
  const by = interpolate(Math.cos(frame / 110), [-1, 1], [-40, 40]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(130% 120% at ${20 + drift * 20}% 0%, ${NAVY} 0%, ${DEEP} 70%)` }}>
      <div style={{
        position: 'absolute', width: 900, height: 900, borderRadius: '50%',
        left: 1100 + bx, top: -300 + by,
        background: `radial-gradient(circle, ${NARANJA}2e 0%, transparent 65%)`, filter: 'blur(10px)',
      }} />
      <div style={{
        position: 'absolute', width: 700, height: 700, borderRadius: '50%',
        left: -250 - bx, top: 500 - by,
        background: `radial-gradient(circle, #2e75b62e 0%, transparent 65%)`, filter: 'blur(10px)',
      }} />
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 420px rgba(0,0,0,.55)' }} />
    </AbsoluteFill>
  );
};

// ── Intro: logo + marca + título gigante + subtítulo ──
const Intro: React.FC<Props> = ({ titulo, marca, subtitulo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const op = edgeFade(frame, INTRO, 10, 14);
  const logoS = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const titS = spring({ frame: frame - 8, fps, config: { damping: 12, mass: 0.7 } });
  const subY = interpolate(frame, [18, 40], [24, 0], { extrapolateRight: 'clamp' });
  const subO = interpolate(frame, [18, 40], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: op }}>
      <Img src={staticFile('logo.png')} style={{ width: 150, marginBottom: 26, transform: `scale(${logoS})`, filter: 'drop-shadow(0 10px 30px rgba(0,0,0,.5))' }} />
      <div style={{ color: WHITE, opacity: 0.72, fontFamily: BODY, fontSize: 26, letterSpacing: 10, textTransform: 'uppercase' }}>{marca}</div>
      <div style={{ color: WHITE, fontFamily: HEAD, fontWeight: 800, fontSize: 200, lineHeight: 1, letterSpacing: -4, transform: `scale(${0.8 + titS * 0.2})`, textShadow: '0 20px 60px rgba(0,0,0,.45)' }}>{titulo}</div>
      <div style={{ color: NARANJA, fontFamily: BODY, fontWeight: 600, fontSize: 40, marginTop: 6, transform: `translateY(${subY}px)`, opacity: subO }}>{subtitulo}</div>
    </AbsoluteFill>
  );
};

// ── Tagline: frases que entran con máscara ──
const Tagline: React.FC<Props> = ({ tagline }) => {
  const frame = useCurrentFrame();
  const op = edgeFade(frame, TAG, 8, 14);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: op }}>
      <div style={{ textAlign: 'center' }}>
        {tagline.map((linea, i) => {
          const d = i * 10;
          const y = interpolate(frame, [d, d + 18], [60, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
          const o = interpolate(frame, [d, d + 18], [0, 1], { extrapolateRight: 'clamp' });
          return (
            <div key={i} style={{ overflow: 'hidden', padding: '2px 0' }}>
              <div style={{
                color: i === tagline.length - 1 ? NARANJA : WHITE, fontFamily: HEAD, fontWeight: 800,
                fontSize: 96, lineHeight: 1.08, letterSpacing: -2, transform: `translateY(${y}px)`, opacity: o,
              }}>{linea}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── Tarjeta de pantalla: screenshot con Ken Burns + chip de módulo + beneficio ──
const Pantalla: React.FC<{ shot: Shot; idx: number }> = ({ shot, idx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const op = edgeFade(frame, PER_SHOT, 12, 12);
  const kb = interpolate(frame, [0, PER_SHOT], [1.06, 1.14]);
  const kx = interpolate(frame, [0, PER_SHOT], [0, idx % 2 === 0 ? -28 : 28]);
  const cardS = spring({ frame, fps, config: { damping: 16, mass: 0.7 } });
  const chipX = interpolate(frame, [8, 26], [-80, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const chipO = interpolate(frame, [8, 26], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: op }}>
      {/* chip de módulo + beneficio (izquierda) */}
      <div style={{ position: 'absolute', left: 90, top: 150, maxWidth: 560, transform: `translateX(${chipX}px)`, opacity: chipO, zIndex: 2 }}>
        <div style={{ display: 'inline-block', background: NARANJA, color: WHITE, fontFamily: BODY, fontWeight: 700, fontSize: 26, padding: '8px 20px', borderRadius: 999, letterSpacing: 1 }}>{shot.modulo}</div>
        <div style={{ color: WHITE, fontFamily: HEAD, fontWeight: 800, fontSize: 60, lineHeight: 1.08, marginTop: 18, textShadow: '0 8px 30px rgba(0,0,0,.5)' }}>{shot.beneficio}</div>
      </div>
      {/* screenshot en marco */}
      <div style={{
        width: 1180, height: 664, borderRadius: 18, overflow: 'hidden',
        transform: `translateX(220px) scale(${0.92 + cardS * 0.08}) rotate(-0.6deg)`,
        boxShadow: '0 40px 120px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)',
        border: `1px solid ${NAVY}`, background: NAVY,
      }}>
        {shot.src === '__none__' ? (
          <AbsoluteFill style={{ background: `linear-gradient(135deg, ${NAVY}, ${DEEP})`, alignItems: 'center', justifyContent: 'center', color: '#ffffff55', fontFamily: HEAD, fontSize: 40 }}>
            (vista del sistema)
          </AbsoluteFill>
        ) : (
          <Img src={staticFile('shots/' + shot.src)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', transform: `scale(${kb}) translateX(${kx}px)` }} />
        )}
      </div>
    </AbsoluteFill>
  );
};

// ── Outro: logo + dominio + CTA ──
const Outro: React.FC<Props> = ({ dominio, marca }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const op = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const s = spring({ frame, fps, config: { damping: 15 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: op }}>
      <Img src={staticFile('logo.png')} style={{ width: 130, marginBottom: 24, transform: `scale(${0.8 + s * 0.2})` }} />
      <div style={{ color: WHITE, fontFamily: HEAD, fontWeight: 800, fontSize: 72, letterSpacing: -1 }}>Tu obra, en una sola plataforma.</div>
      <div style={{ marginTop: 28, background: NARANJA, color: WHITE, fontFamily: BODY, fontWeight: 700, fontSize: 34, padding: '14px 36px', borderRadius: 14, letterSpacing: 0.5 }}>{dominio}</div>
      <div style={{ color: WHITE, opacity: 0.6, fontFamily: BODY, fontSize: 24, marginTop: 20, letterSpacing: 6, textTransform: 'uppercase' }}>{marca}</div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC<Props> = (props) => {
  const shots = props.shots?.length ? props.shots : [{ src: '__none__', modulo: 'SGC', beneficio: 'Todo tu negocio en un solo lugar' }];
  const montageStart = INTRO + TAG;
  return (
    <AbsoluteFill style={{ backgroundColor: DEEP }}>
      <Fondo />
      <Sequence durationInFrames={INTRO}><Intro {...props} /></Sequence>
      <Sequence from={INTRO} durationInFrames={TAG}><Tagline {...props} /></Sequence>
      {shots.map((shot, i) => (
        <Sequence key={i} from={montageStart + i * PER_SHOT} durationInFrames={PER_SHOT}>
          <Pantalla shot={shot} idx={i} />
        </Sequence>
      ))}
      <Sequence from={montageStart + shots.length * PER_SHOT}><Outro {...props} /></Sequence>
      <Audio src={staticFile('music.mp3')} volume={(f) => interpolate(f, [0, 20], [0, 0.6], { extrapolateRight: 'clamp' })} />
    </AbsoluteFill>
  );
};
