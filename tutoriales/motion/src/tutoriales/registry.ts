import React from 'react';
import { Pantalla as CrearRequisicion } from './crear-requisicion.screen';

// id de pantalla → componente mock. Al agregar un tutorial nuevo, regístralo aquí.
export const SCREENS: Record<string, React.FC<{ fase: number; frame: number; atOf: (f: number) => number }>> = {
  'crear-requisicion': CrearRequisicion,
};
