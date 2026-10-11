import React from 'react';
import { Pantalla as CrearRequisicion } from './crear-requisicion.screen';
import { Pantalla as AprobarDespachar } from './aprobar-despachar.screen';
import { Pantalla as TransferirConduce } from './transferir-conduce.screen';
import { Pantalla as EntradaInventario } from './entrada-inventario.screen';
import { Pantalla as Conteo } from './conteo.screen';
import { Pantalla as CrearConduce } from './crear-conduce.screen';
import { Pantalla as RegistrarMantenimiento } from './registrar-mantenimiento.screen';

// id de pantalla → componente mock. Al agregar un tutorial nuevo, regístralo aquí.
export const SCREENS: Record<string, React.FC<{ fase: number; frame: number; atOf: (f: number) => number }>> = {
  'crear-requisicion': CrearRequisicion,
  'aprobar-despachar': AprobarDespachar,
  'transferir-conduce': TransferirConduce,
  'entrada-inventario': EntradaInventario,
  'conteo': Conteo,
  'crear-conduce': CrearConduce,
  'registrar-mantenimiento': RegistrarMantenimiento,
};
