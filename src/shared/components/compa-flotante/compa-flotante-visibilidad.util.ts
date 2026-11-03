// DG — Compa flotante: regla de visibilidad PURA (sin servicios/DOM), para poder
// probarla sin montar el Shell completo. El shell solo le pasa 3 hechos que ya
// conoce por otra vía (preferencia cargada, ruta actual, práctica activa); esta
// función no inventa una segunda fuente de verdad para ninguno de los tres.

export interface CompaFlotanteVisibilidadOpciones {
  /** `prefs()?.compa_flotante ?? true` — apagado por la persona en Configuración. */
  prefActiva: boolean;
  /** La ruta activa es `/asistente` (pantalla completa) — sería redundante mostrarla. */
  enPantallaAsistente: boolean;
  /** `PracticaService.activa()` — hay una misión de práctica en curso. */
  practicaActiva: boolean;
}

export function compaFlotanteVisible(opciones: CompaFlotanteVisibilidadOpciones): boolean {
  return opciones.prefActiva && !opciones.enPantallaAsistente && !opciones.practicaActiva;
}
