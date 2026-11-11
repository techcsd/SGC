# Release 1.214.0

- Equipo/tester: Xaviel
- Qué se probó: ronda DN (PROMPT-142) — módulo Claude (conexión real, un
  paso para conectar), Cargos y alias (detalle al clic), RRHH ampliado
  (Contratos y documentos, Organigrama, Reclutamiento, Capacitación,
  Evaluaciones, Nómina-parámetros) y Administración (Gastos, Trámites,
  Proveedores administrativos, Activos de oficina).
- Versión de origen: 1.213.0
- Resultado: **OK — Xaviel probó en dev.sgcconstructorasd.com y autoriza
  continuar el pipeline dev → main (regla 18 / CP5).**
- Fecha: 2026-11-11 (construcción) / 2026-11-11 (prueba y OK de Xaviel)
- Probado por: Xaviel · 2026-11-11

## Casillas

### Módulo Claude (`/claude`)
- [x] Inicio: "Conecté el SGC a Claude" se marca sola cuando Claude está conectado de verdad (ya no es un checkbox que no responde).
- [x] "Mi conexión" queda en un solo paso para miembros (Ajustes › Conectores › SGC › Conectar); el enlace del conector queda en un desplegable aparte.
- [x] Skills: buscador filtra la biblioteca; "Descargar pack de mi rol" aparece si hay un pack para el rol.
- [x] Auditoría › Técnica muestra el resumen real de hallazgos, no solo la ruta del archivo.

### Cargos y alias (`/proyectos/cargos`)
- [x] Clic (o Enter) en una fila del catálogo abre el panel de detalle: alias, cuántas personas de obra tienen ese cargo, enlace a Personal filtrado.
- [x] Agregar/eliminar un alias desde el panel funciona (eliminar pide confirmación propia, no `confirm()` del navegador).

### RRHH — Personas
- [x] Contratos y documentos: la lista de "por vencer" aparece; elegir un empleado muestra sus documentos y se puede editar la vigencia.
- [x] Organigrama: la lista de empleados aparece ordenada por jefatura.
- [x] Reclutamiento: crear una vacante, agregar un candidato, avanzarlo de etapa (aplicó → entrevista → oferta → contratado) y rechazar funcionan.
- [x] Capacitación: agregar un curso con vencimiento al empleado y verlo en "por vencer".
- [x] Evaluaciones: solo visible para RRHH/Gerencia; agregar una evaluación por período funciona.
- [x] Nómina: ver/editar parámetros TSS/AFP/ISR y marcar "validado por contador"; crear un período en borrador. **Sin botón de calcular** (correcto, a propósito).

### RRHH — Administración
- [x] Gastos y caja chica (menú RRHH) abre la misma pantalla que Compras › Gastos.
- [x] Trámites y cumplimiento: agregar un trámite con vencimiento, verlo en "vencidos"/"por vencer", marcarlo renovado.
- [x] Proveedores administrativos: agregar, activar/desactivar, eliminar.
- [x] Activos de oficina: agregar, enviar a mantenimiento, marcar reparado.

## Pendiente antes de promover a prod

- Migraciones nuevas de esta ronda (`sql/2026-11-11-dn26-*`, `dn27-*`, `dn29-*`)
  están SOLO en dev — aplicarlas a prod cuando se mezcle a `main`.
- `admin-entrar-como`/`admin-fin-impersonacion` cambiaron de código (DN-18,
  sin cambiar comportamiento) — redesplegar a prod.
- Validar con el contador las fórmulas de `sgc.rrhh_nomina_parametros` antes
  de construir el motor de cálculo real (fuera de alcance de esta ronda).
- Decidir sobre el reporte `c1102070` (ver HANDOFF.md) — ya cerrado en prod.
