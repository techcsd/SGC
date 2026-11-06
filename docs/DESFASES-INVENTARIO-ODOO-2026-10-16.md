# Inventario SGC y Odoo para revisión de Contabilidad

**16 de octubre de 2026 | Dirigido a Eduardo Ng | Propuestas pendientes de aprobación**

Antes de sincronizar debemos homologar artículos, unidades y ubicaciones. Hay 17 candidatos por nombre; 5 están activos y tienen unidad compatible. Todavía no hay diferencias de cantidad confirmadas ni importes calculados.

| Tipo de problema | Ejemplos del corte | Consecuencia de aplicar la solución |
| --- | --- | --- |
| Catálogo e identidad (F01-F04) | ART-0002: variante 1142 / plantilla 1146; CINTA METRICA 8M: registros 346 y 1009. | Vincular y revisar duplicados evita movimientos en otro artículo; no cambia saldos por sí solo. |
| Unidades y empaques (F05-F07) | ALM-020: caja 50 lb frente a Units; ART-0003: unidad “32”; Pies(30) frente a ft(18). | Las conversiones pueden cambiar cantidades y costo unitario: validar presentación y efecto antes de aplicar. |
| Bodegas y estados (F08-F10) | Monterezzo inactivo: 25 saldos positivos; City Place: 2 almacenes candidatos; Brisas: proyecto inactivo/bodega activa. | Definir sedes y resolver residuos puede reubicar o corregir stock; requiere conteo y documentos. |
| Pruebas y apertura (F11, F13) | 540 filas en contexto de prueba; 3 cadenas mixtas; 3.416 filas de apertura frente a 3.444 de saldo actual. | Excluir pruebas y separar apertura evita inflar saldos. Se conserva el historial. |
| Saldos y pendientes (F12, F14-F16) | 91 salidas incompletas; poloche M: 52 físicos / 25 reservados / 27 disponibles; OFI-011 inactivo: saldo 999 unidades. | Solo corregir hechos acreditados; puede afectar existencia y valor. Reserva no equivale a pérdida. |

**Se solicita a Contabilidad y Almacén:** aprobar equivalencias, sedes y el piloto de 5 artículos; los ajustes de cantidades e importes se aprobarán después, por lote sustentado. No se ha corregido stock.

**Para el desarrollador:** por favor notifíquenle que ya se creó el [issue #20](https://github.com/techcsd/SGC/issues/20), asignado a XavielT, para evaluar campos adicionales en la base SGC/Supabase. Debe probarse en dev antes de producción. Aún no está aplicado y por sí solo no activa sincronización.

**Detalle y 2-3 ejemplos por cada hallazgo:** [anexo técnico](ANEXO-TECNICO-DESFASES-INVENTARIO-ODOO-2026-10-16.md). Datos del corte del 16/10/2026; propuestas sin ejecutar.
