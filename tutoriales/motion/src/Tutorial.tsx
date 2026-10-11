import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate } from 'remotion';
import { C, Camara, Cursor, Caption, Confetti, ProgressDots, cargarFuentes, type Beat } from './lib/kit';
import { SCREENS } from './tutoriales/registry';

cargarFuentes();

export type TimedPaso = { fase: number; at: number; dur: number; cap?: string; cam: { x: number; y: number; s: number }; click?: boolean; voz?: string };
export type TutorialProps = { screen: string; pasos: TimedPaso[]; conMusica?: boolean };

export const Tutorial: React.FC<TutorialProps> = ({ screen, pasos, conMusica = true }) => {
  const frame = useCurrentFrame();
  const Pantalla = SCREENS[screen];

  // Beats de cámara/cursor: mantiene el punto previo y "llega" al nuevo en ~16 frames.
  const beats: Beat[] = [];
  pasos.forEach((p, i) => {
    if (i === 0) { beats.push({ at: 0, x: p.cam.x, y: p.cam.y, s: p.cam.s }); }
    else {
      const prev = pasos[i - 1].cam;
      beats.push({ at: Math.max(1, p.at - 1), x: prev.x, y: prev.y, s: prev.s });
      beats.push({ at: p.at + 16, x: p.cam.x, y: p.cam.y, s: p.cam.s, click: p.click });
    }
  });

  const atOf = (f: number) => pasos.find((p) => p.fase === f)?.at ?? 0;
  let cur = pasos[0]; let curIdx = 0;
  pasos.forEach((p, i) => { if (frame >= p.at) { cur = p; curIdx = i; } });

  const capBeats: Beat[] = pasos.map((p) => ({ at: p.at, x: 0, y: 0, s: 1, cap: p.cap }));
  const last = pasos[pasos.length - 1];

  // Entrada de la app: aparece con un leve zoom-out + fade.
  const introO = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const introS = interpolate(frame, [0, 16], [1.04, 1], { extrapolateRight: 'clamp' });

  if (!Pantalla) return <AbsoluteFill style={{ background: C.deep, color: '#fff' }}>screen «{screen}» no registrado</AbsoluteFill>;

  return (
    <AbsoluteFill style={{ background: C.deep }}>
      <AbsoluteFill style={{ opacity: introO, transform: `scale(${introS})` }}>
        <Camara beats={beats}>
          <Pantalla fase={cur.fase} frame={frame} atOf={atOf} />
          <Cursor beats={beats} />
        </Camara>
      </AbsoluteFill>
      <ProgressDots total={pasos.length} current={curIdx} />
      <Caption beats={capBeats} />
      {last && <Confetti startFrame={last.at + 6} />}
      {pasos.map((p) => p.voz ? (
        <Sequence key={p.fase} from={p.at} durationInFrames={p.dur + 20}>
          <Audio src={staticFile(`voz/${screen}/${p.voz}`)} />
        </Sequence>
      ) : null)}
      {conMusica && <Audio src={staticFile('music.mp3')} volume={0.1} />}
    </AbsoluteFill>
  );
};
