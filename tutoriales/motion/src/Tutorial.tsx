import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { C, Camara, Cursor, Caption, cargarFuentes, type Beat } from './lib/kit';
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
  let cur = pasos[0];
  for (const p of pasos) if (frame >= p.at) cur = p;

  const capBeats: Beat[] = pasos.map((p) => ({ at: p.at, x: 0, y: 0, s: 1, cap: p.cap }));

  if (!Pantalla) return <AbsoluteFill style={{ background: C.deep, color: '#fff' }}>screen «{screen}» no registrado</AbsoluteFill>;

  return (
    <AbsoluteFill style={{ background: C.deep }}>
      <AbsoluteFill>
        <Camara beats={beats}>
          <Pantalla fase={cur.fase} frame={frame} atOf={atOf} />
          <Cursor beats={beats} />
        </Camara>
      </AbsoluteFill>
      <Caption beats={capBeats} />
      {pasos.map((p) => p.voz ? (
        <Sequence key={p.fase} from={p.at} durationInFrames={p.dur + 20}>
          <Audio src={staticFile(`voz/${screen}/${p.voz}`)} />
        </Sequence>
      ) : null)}
      {conMusica && <Audio src={staticFile('music.mp3')} volume={0.1} />}
    </AbsoluteFill>
  );
};
