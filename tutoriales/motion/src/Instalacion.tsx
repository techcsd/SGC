import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate } from 'remotion';
import { C, Camara, TapDot, Caption, Confetti, ProgressDots, PhoneFrame, cargarFuentes, type Beat } from './lib/kit';
import { INSTALL_SCREENS } from './instalaciones/registry';

cargarFuentes();

export type TimedPaso = { fase: number; at: number; dur: number; cap?: string; cam: { x: number; y: number; s: number }; click?: boolean; voz?: string };
export type InstalacionProps = { screen: string; pasos: TimedPaso[] };

export const Instalacion: React.FC<InstalacionProps> = ({ screen, pasos }) => {
  const frame = useCurrentFrame();
  const Pantalla = INSTALL_SCREENS[screen];

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
  const introO = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });

  if (!Pantalla) return <AbsoluteFill style={{ background: C.deep, color: '#fff' }}>screen «{screen}» no registrado</AbsoluteFill>;

  return (
    <AbsoluteFill style={{ background: C.deep }}>
      <AbsoluteFill style={{ opacity: introO }}>
        <Camara beats={beats}>
          <PhoneFrame><Pantalla fase={cur.fase} frame={frame} atOf={atOf} /></PhoneFrame>
          <TapDot beats={beats} />
        </Camara>
      </AbsoluteFill>
      <ProgressDots total={pasos.length} current={curIdx} />
      <Caption beats={capBeats} />
      {last && <Confetti startFrame={last.at + 6} n={60} />}
      {pasos.map((p) => p.voz ? (
        <Sequence key={p.fase} from={p.at} durationInFrames={p.dur + 20}>
          <Audio src={staticFile(`voz/${screen}/${p.voz}`)} />
        </Sequence>
      ) : null)}
      <Audio src={staticFile('music.mp3')} volume={0.09} />
    </AbsoluteFill>
  );
};
