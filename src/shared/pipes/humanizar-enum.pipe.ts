import { Pipe, PipeTransform } from '@angular/core';
import { humanizarEnum } from '../utils/dominio-labels.util';

/**
 * AU15 — pipe para que ninguna pantalla muestre un valor de enum crudo (snake_case /
 * MAYÚSCULAS). Convierte p. ej. `en_curso` → "En curso", `entregado_incompleto` →
 * "Entregado incompleto". Uso: {{ x.estado | humanizarEnum }}. Red de seguridad del
 * diccionario central de etiquetas (dominio-labels.util).
 */
@Pipe({ name: 'humanizarEnum' })
export class HumanizarEnumPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return humanizarEnum(value);
  }
}
