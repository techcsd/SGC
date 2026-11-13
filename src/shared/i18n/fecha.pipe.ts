import { inject, Pipe, PipeTransform } from '@angular/core';
import { DatePipe, registerLocaleData } from '@angular/common';
import localeEsDO from '@angular/common/locales/es-DO';
import localeEnUS from '@angular/common/locales/en';
import { I18nService } from './i18n.service';
import { localeActual, MESES_HT_ABR, MESES_HT } from './locale.util';

// Se registran aquí (no solo en app.config.ts) para que el pipe funcione
// igual en tests unitarios que no arrancan el bootstrap completo de la app.
registerLocaleData(localeEsDO);
registerLocaleData(localeEnUS, 'en-US');

/**
 * DP-11 — pipe `fecha` que reemplaza `| date` en las plantillas: reacciona al
 * cambio de idioma (signal, `pure: false`) y usa el locale correcto (`es-DO`/
 * `en-US`). Para `ht`, los patrones con nombre de mes (`MMM`/`MMMM`) usan la
 * tabla de `locale.util.ts` porque ningún motor tiene datos CLDR reales para
 * Kreyòl ayisyen (ver comentario ahí). El resto de los patrones (solo
 * números) se delega siempre a Angular `DatePipe`, igual que antes.
 */
@Pipe({ name: 'fecha', pure: false })
export class FechaPipe implements PipeTransform {
  private i18n = inject(I18nService);
  private datePipe = new DatePipe('es-DO');

  transform(value: string | number | Date | null | undefined, format = 'd MMM, HH:mm'): string | null {
    if (value === null || value === undefined || value === '') return null;
    const idioma = this.i18n.idioma();
    if (idioma === 'ht' && /MMMM?/.test(format)) {
      return this.formatearHt(value, format);
    }
    return this.datePipe.transform(value, format, undefined, localeActual(idioma));
  }

  private formatearHt(value: string | number | Date, format: string): string | null {
    const fecha = value instanceof Date ? value : new Date(value);
    if (isNaN(fecha.getTime())) return null;
    const dia = fecha.getDate();
    const anio = fecha.getFullYear();
    const hh = String(fecha.getHours()).padStart(2, '0');
    const mm = String(fecha.getMinutes()).padStart(2, '0');
    const nombreMes = format.includes('MMMM') ? MESES_HT[fecha.getMonth()] : MESES_HT_ABR[fecha.getMonth()];

    // Patrones conocidos usados hoy en el repo (exactos, el caso común).
    if (format === 'd MMM') return `${dia} ${nombreMes}`;
    if (format === 'd MMM, HH:mm') return `${dia} ${nombreMes}, ${hh}:${mm}`;
    if (format === 'd MMM y') return `${dia} ${nombreMes} ${anio}`;
    if (format === 'MMMM y') return `${nombreMes} ${anio}`;

    // Patrón con MMM no previsto: sustitución genérica token a token (best-effort).
    return format
      .replace(/MMMM?/, nombreMes)
      .replace(/\bd\b/, String(dia))
      .replace(/\by\b/, String(anio))
      .replace('HH', hh)
      .replace('mm', mm);
  }
}
