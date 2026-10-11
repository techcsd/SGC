import { Composition } from 'remotion';
import { Promo } from './Promo';
import { Demo, DEMO_DUR } from './Demo';
import { Tutorial, type TimedPaso } from './Tutorial';
import { PromoPro, PROMOPRO_DUR } from './PromoPro';

const FPS = 30;

// Duraciones (frames) de cada bloque — deben cuadrar con Promo.tsx.
export const INTRO = 108;   // 3.6s
export const TAG = 96;      // 3.2s
export const PER_SHOT = 108; // 3.6s por pantalla
export const OUTRO = 108;   // 3.6s

export const RemotionRoot = () => {
  return (
    <>
    <Composition
      id="Promo"
      component={Promo as never}
      durationInFrames={660}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{
        shots: [] as { src: string; modulo: string; beneficio: string }[],
        titulo: 'SGC',
        marca: 'Constructora SD',
        subtitulo: 'Sistema de Gestión',
        tagline: ['Toda tu obra,', 'bajo control.'],
        dominio: 'sgcconstructorasd.com',
      }}
      calculateMetadata={({ props }) => {
        const n = Math.max(1, (props as { shots?: unknown[] }).shots?.length ?? 1);
        return { durationInFrames: INTRO + TAG + n * PER_SHOT + OUTRO };
      }}
    />
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={DEMO_DUR}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="Tutorial"
      component={Tutorial as never}
      durationInFrames={900}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ screen: 'crear-requisicion', pasos: [] as TimedPaso[], conMusica: true }}
      calculateMetadata={({ props }) => {
        const pasos = (props as { pasos?: TimedPaso[] }).pasos ?? [];
        const last = pasos[pasos.length - 1];
        const dur = last ? last.at + last.dur + 30 : 300;
        return { durationInFrames: dur };
      }}
    />
    <Composition
      id="PromoPro"
      component={PromoPro}
      durationInFrames={PROMOPRO_DUR}
      fps={FPS}
      width={1920}
      height={1080}
    />
    </>
  );
};
