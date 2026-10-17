-- CQ3 (16-oct-2026) — Auditoría legible: "qué hizo quién, cuándo, desde dónde,
-- qué cambió". Mock aprobado: C:\developer\improvements\octubre 2026\imp 16102026\
-- mock-cq\Auditoria.dc.html — pestañas Actividad/Resumen/Acciones de admin.
--
-- ⚠️ ADITIVA, sin tocar auditoria_listar/auditoria_resumen/auditoria_opciones/
-- audit_log_listado (siguen vivos, "Resumen" y "Acciones de admin" los reusan
-- tal cual). NO repite el fix de audit_log_listado (ya resuelto en
-- sql/2026-10-16-cq3-audit-log-listado-text.sql).
--
-- Contenido:
--   1) sgc.auditoria + columna `origen` ("desde dónde": web@1.193.0 / app@2.55.0 /
--      null si la fila es anterior a esta migración — SOLO aplica hacia adelante).
--   2) Índices (actor+fecha, registro+fecha, fecha sola para el feed sin filtros).
--   3) sgc.auditoria_frases — catálogo de frases en español por (tabla, operación,
--      condición opcional) + cómo armar el "código" legible del registro.
--   4) Semilla de 35 tablas (las ~30 más auditadas en PROD, consulta real +
--      un puñado de tablas hermanas para no dejar huecos obvios).
--   5) sgc.auditoria_frase() — arma "verbo + sustantivo [+ código]" para una fila.
--   6) sgc._auditoria_resumen_cambios() — "Campo: antes → después" en una línea.
--   7) sgc.fn_auditoria() — se re-crea IGUAL + captura `origen` del header
--      `x-sgc-client` (mismo patrón defensivo que impersonado_por()).
--   8) sgc.auditoria_actividad() — línea de tiempo con cursor (no OFFSET).
--   9) sgc.auditoria_historia_registro() — toda la vida de UN registro.
--
-- Decisiones de diseño (spec no 100% explícita):
--   · `plantilla_codigo` (mini-DSL) descartado a favor de `codigo_prefijo` +
--     `codigo_campo` (columna real del registro) — la propia spec se auto-corrige
--     hacia esto ("NO — mejor…").
--   · `condicion` es un texto `campo=valor` evaluado contra el jsonb de cambios/
--     datos (equality simple) — no un lenguaje de expresiones completo.
--   · Añadidas `padre_tabla`/`padre_fk_campo` (no pedidas explícitamente) para que
--     las tablas de renglones (solicitud_material_items, solicitud_compra_items)
--     puedan mostrar el código del PADRE (ej. "un renglón de la requisición
--     REQ-000091") en vez de quedarse genéricas — sin esto, el ejemplo del mock
--     ("cambió 2 renglones de REQ-000091") no tendría código visible.
--   · La búsqueda por texto NO intenta adivinar si "parece un código": busca en
--     TODAS las estrategias a la vez (registro_id, tabla, nombre del actor, y
--     resolución dinámica de código→id en las tablas con `codigo_campo`) y las
--     une con OR — nunca esconde resultados válidos por conveniencia (regla 10).
--   · Agrupar varias filas de auditoria en una sola línea de timeline (el
--     "cambió 2 renglones" del mock proviene de 2 filas UPDATE reales) NO se
--     implementó — cada fila de auditoria se muestra como su propia línea. Ver
--     nota de pendientes en el reporte de la ronda.

begin;

-- ── 1) Columna de origen ("desde dónde") ──────────────────────────────────────
alter table sgc.auditoria add column if not exists origen text;

comment on column sgc.auditoria.origen is
  'CQ3 — "web@1.193.0" / "app@2.55.0", tomado del header x-sgc-client en el '
  'momento de la escritura. NULL en filas anteriores a esta migración (16-oct-2026) '
  'o si el cliente no mandó el header — nunca se infiere retroactivamente.';

-- ── 2) Índices (41k+ filas y creciendo; actor/registro ya no pueden ir por seq-scan) ──
create index if not exists ix_auditoria_actor_fecha on sgc.auditoria (actor_id, creado_en desc);
create index if not exists ix_auditoria_registro_fecha on sgc.auditoria (tabla, registro_id, creado_en desc);
-- No pedido explícitamente, pero el feed "Actividad" SIN filtro de persona (el caso
-- más común) ordena por fecha sola — sin este índice cae a seq-scan + sort.
create index if not exists ix_auditoria_fecha on sgc.auditoria (creado_en desc, id desc);

-- ── 3) Catálogo de frases ──────────────────────────────────────────────────────
create table if not exists sgc.auditoria_frases (
  id serial primary key,
  tabla text not null,
  operacion text not null, -- 'INSERT' | 'UPDATE' | 'DELETE'
  -- '' = fila por-defecto de (tabla,operacion). 'campo=valor' = condición simple,
  -- evaluada contra cambios->campo->>'despues' (UPDATE) o datos_despues/antes->>campo.
  condicion text not null default '',
  verbo text not null,
  sustantivo text not null, -- en minúscula CON artículo: "la requisición", "el vehículo"
  codigo_prefijo text, -- ej. 'REQ-' (null = el valor de codigo_campo ya viene formateado)
  codigo_campo text, -- columna del registro (datos_despues/antes) con el código humano
  -- Para tablas "renglón" (sin código propio): de dónde sacar el código del PADRE.
  padre_tabla text,
  padre_fk_campo text, -- columna de ESTE registro que apunta al id del padre
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (tabla, operacion, condicion)
);

comment on table sgc.auditoria_frases is
  'CQ3 — catálogo servidor de "verbo + sustantivo" en español por (tabla, accion, '
  'condición opcional), usado por auditoria_actividad()/auditoria_historia_registro() '
  'para armar una frase legible sin traer todo el log al cliente. Tabla SIN tocar '
  'desde ninguna tabla del repo. Si una combinación no está aquí, el RPC cae a un '
  'genérico ("modificó un registro de {tabla}") — nunca deja la frase vacía.';

grant select on sgc.auditoria_frases to authenticated;

-- ── 4) Semilla — las ~30 tablas más auditadas en PROD (select tabla, count(*) ──
--      from sgc.auditoria group by tabla order by 2 desc limit 30, corrida real
--      16-oct-2026) + solicitud_compra_items/reportes_usuario/mantenimientos/
--      vehiculo_entregas/ordenes_compra (35 en total) para no dejar huecos en
--      flujos de compras/flota que SÍ importan para auditar aunque su volumen
--      sea menor. Estados tomados de los valores REALES vistos en PROD (no
--      inventados) — por eso no hay "aprobó…→aprobada" literal del mock: ese
--      estado no existe en el enum real de solicitudes_material.
insert into sgc.auditoria_frases (tabla, operacion, condicion, verbo, sustantivo, codigo_prefijo, codigo_campo, padre_tabla, padre_fk_campo) values
  -- usuarios (11 153 filas prod — el más auditado, incl. altas/bajas/cambios de perfil)
  ('usuarios','INSERT','', 'creó','el usuario',null,'nombre',null,null),
  ('usuarios','UPDATE','', 'actualizó','al usuario',null,'nombre',null,null),
  ('usuarios','UPDATE','activo=false', 'desactivó','al usuario',null,'nombre',null,null),
  ('usuarios','UPDATE','activo=true', 'reactivó','al usuario',null,'nombre',null,null),
  ('usuarios','DELETE','', 'eliminó','al usuario',null,'nombre',null,null),

  -- conteo_items (renglones de conteo de inventario)
  ('conteo_items','INSERT','', 'agregó','un renglón de conteo de inventario',null,null,null,null),
  ('conteo_items','UPDATE','', 'ajustó','un renglón de conteo de inventario',null,null,null,null),
  ('conteo_items','DELETE','', 'quitó','un renglón de conteo de inventario',null,null,null,null),

  -- weather_snapshots / weather_alerts (mayormente generadas por el cron de clima)
  ('weather_snapshots','INSERT','', 'registró','una lectura del clima',null,null,null,null),
  ('weather_snapshots','UPDATE','', 'actualizó','una lectura del clima',null,null,null,null),
  ('weather_snapshots','DELETE','', 'eliminó','una lectura del clima',null,null,null,null),
  ('weather_alerts','INSERT','', 'emitió','una alerta de clima',null,null,null,null),
  ('weather_alerts','UPDATE','', 'actualizó','una alerta de clima',null,null,null,null),
  ('weather_alerts','DELETE','', 'eliminó','una alerta de clima',null,null,null,null),

  -- stock_apertura
  ('stock_apertura','INSERT','', 'registró','el stock de apertura',null,null,null,null),
  ('stock_apertura','UPDATE','', 'ajustó','el stock de apertura',null,null,null,null),
  ('stock_apertura','DELETE','', 'eliminó','el stock de apertura',null,null,null,null),

  -- rutas
  ('rutas','INSERT','', 'creó','la ruta',null,null,null,null),
  ('rutas','UPDATE','', 'actualizó','la ruta',null,null,null,null),
  ('rutas','UPDATE','estado=completada', 'completó','la ruta',null,null,null,null),
  ('rutas','UPDATE','estado=cancelada', 'canceló','la ruta',null,null,null,null),
  ('rutas','UPDATE','estado=en_curso', 'inició','la ruta',null,null,null,null),
  ('rutas','DELETE','', 'eliminó','la ruta',null,null,null,null),

  -- proveedores
  ('proveedores','INSERT','', 'creó','el proveedor',null,'nombre',null,null),
  ('proveedores','UPDATE','', 'actualizó','al proveedor',null,'nombre',null,null),
  ('proveedores','UPDATE','activo=false', 'desactivó','al proveedor',null,'nombre',null,null),
  ('proveedores','DELETE','', 'eliminó','al proveedor',null,'nombre',null,null),

  -- salidas_inventario (conduces de salida)
  ('salidas_inventario','INSERT','', 'creó','la salida de inventario',null,null,null,null),
  ('salidas_inventario','UPDATE','', 'actualizó','la salida de inventario',null,null,null,null),
  ('salidas_inventario','UPDATE','estado=despachado', 'despachó','la salida de inventario',null,null,null,null),
  ('salidas_inventario','UPDATE','estado=entregado', 'marcó como entregada','la salida de inventario',null,null,null,null),
  ('salidas_inventario','UPDATE','estado=entregado_incompleto', 'marcó como entregada parcial','la salida de inventario',null,null,null,null),
  ('salidas_inventario','UPDATE','estado=rechazada', 'rechazó','la salida de inventario',null,null,null,null),
  ('salidas_inventario','UPDATE','estado=anulado', 'anuló','la salida de inventario',null,null,null,null),
  ('salidas_inventario','DELETE','', 'eliminó','la salida de inventario',null,null,null,null),

  -- registros_combustible
  ('registros_combustible','INSERT','', 'registró','una carga de combustible',null,null,null,null),
  ('registros_combustible','UPDATE','', 'corrigió','un registro de combustible',null,null,null,null),
  ('registros_combustible','DELETE','', 'eliminó','un registro de combustible',null,null,null,null),

  -- articulos
  ('articulos','INSERT','', 'creó','el artículo',null,'nombre',null,null),
  ('articulos','UPDATE','', 'actualizó','el artículo',null,'nombre',null,null),
  ('articulos','UPDATE','activo=false', 'desactivó','el artículo',null,'nombre',null,null),
  ('articulos','DELETE','', 'eliminó','el artículo',null,'nombre',null,null),

  -- bitacora_archivos / bitacora_actividades / bitacora_restricciones / bitacora_catalogos
  ('bitacora_archivos','INSERT','', 'adjuntó','un archivo de bitácora',null,null,null,null),
  ('bitacora_archivos','UPDATE','', 'actualizó','un archivo de bitácora',null,null,null,null),
  ('bitacora_archivos','DELETE','', 'eliminó','un archivo de bitácora',null,null,null,null),
  ('bitacora_actividades','INSERT','', 'registró','una actividad de bitácora',null,null,null,null),
  ('bitacora_actividades','UPDATE','', 'modificó','una actividad de bitácora',null,null,null,null),
  ('bitacora_actividades','DELETE','', 'eliminó','una actividad de bitácora',null,null,null,null),
  ('bitacora_restricciones','INSERT','', 'registró','una restricción de bitácora',null,null,null,null),
  ('bitacora_restricciones','UPDATE','', 'modificó','una restricción de bitácora',null,null,null,null),
  ('bitacora_restricciones','DELETE','', 'eliminó','una restricción de bitácora',null,null,null,null),
  ('bitacora_catalogos','INSERT','', 'creó','un catálogo de bitácora',null,null,null,null),
  ('bitacora_catalogos','UPDATE','', 'actualizó','un catálogo de bitácora',null,null,null,null),
  ('bitacora_catalogos','DELETE','', 'eliminó','un catálogo de bitácora',null,null,null,null),

  -- detalle_salidas / detalle_entradas (renglones de conduces)
  ('detalle_salidas','INSERT','', 'agregó','un renglón a la salida de inventario',null,null,null,null),
  ('detalle_salidas','UPDATE','', 'modificó','un renglón de la salida de inventario',null,null,null,null),
  ('detalle_salidas','DELETE','', 'quitó','un renglón de la salida de inventario',null,null,null,null),
  ('detalle_entradas','INSERT','', 'agregó','un renglón a la entrada de inventario',null,null,null,null),
  ('detalle_entradas','UPDATE','', 'modificó','un renglón de la entrada de inventario',null,null,null,null),
  ('detalle_entradas','DELETE','', 'quitó','un renglón de la entrada de inventario',null,null,null,null),
  ('entradas_inventario','INSERT','', 'creó','la entrada de inventario',null,null,null,null),
  ('entradas_inventario','UPDATE','', 'modificó','la entrada de inventario',null,null,null,null),
  ('entradas_inventario','DELETE','', 'eliminó','la entrada de inventario',null,null,null,null),

  -- vehiculos
  ('vehiculos','INSERT','', 'creó','el vehículo',null,'placa',null,null),
  ('vehiculos','UPDATE','', 'actualizó','el vehículo',null,'placa',null,null),
  ('vehiculos','UPDATE','activo=false', 'dio de baja','el vehículo',null,'placa',null,null),
  ('vehiculos','DELETE','', 'eliminó','el vehículo',null,'placa',null,null),

  -- solicitud_material_items — renglones de REQUISICIÓN; código = el folio del padre
  ('solicitud_material_items','INSERT','', 'agregó','un renglón a la requisición',null,null,'solicitudes_material','solicitud_id'),
  ('solicitud_material_items','UPDATE','', 'cambió','un renglón de la requisición',null,null,'solicitudes_material','solicitud_id'),
  ('solicitud_material_items','DELETE','', 'quitó','un renglón de la requisición',null,null,'solicitudes_material','solicitud_id'),

  -- solicitudes_material (requisiciones) — el flagship del mock
  ('solicitudes_material','INSERT','', 'creó','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','', 'modificó','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','estado=por_despachar', 'aprobó','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','estado=parcial', 'despachó parcialmente','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','estado=completada', 'completó','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','estado=entregada', 'marcó como entregada','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','estado=rechazada', 'rechazó','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','estado=cancelada', 'canceló','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','UPDATE','estado=cerrada', 'cerró','la requisición','REQ-','folio',null,null),
  ('solicitudes_material','DELETE','', 'eliminó','la requisición','REQ-','folio',null,null),

  -- bitacoras
  ('bitacoras','INSERT','', 'creó','el parte de bitácora',null,null,null,null),
  ('bitacoras','UPDATE','', 'modificó','el parte de bitácora',null,null,null,null),
  ('bitacoras','DELETE','', 'eliminó','el parte de bitácora',null,null,null,null),

  -- bodegas (almacenes)
  ('bodegas','INSERT','', 'creó','el almacén',null,'nombre',null,null),
  ('bodegas','UPDATE','', 'actualizó','el almacén',null,'nombre',null,null),
  ('bodegas','UPDATE','activo=false', 'desactivó','el almacén',null,'nombre',null,null),
  ('bodegas','DELETE','', 'eliminó','el almacén',null,'nombre',null,null),

  -- roles
  ('roles','INSERT','', 'creó','el rol',null,'nombre',null,null),
  ('roles','UPDATE','', 'actualizó','el rol',null,'nombre',null,null),
  ('roles','DELETE','', 'eliminó','el rol',null,'nombre',null,null),

  -- proyectos
  ('proyectos','INSERT','', 'creó','el proyecto',null,'codigo',null,null),
  ('proyectos','UPDATE','', 'actualizó','el proyecto',null,'codigo',null,null),
  ('proyectos','UPDATE','estado=terminada', 'cerró','el proyecto',null,'codigo',null,null),
  ('proyectos','UPDATE','activo=false', 'archivó','el proyecto',null,'codigo',null,null),
  ('proyectos','DELETE','', 'eliminó','el proyecto',null,'codigo',null,null),

  -- conductores
  ('conductores','INSERT','', 'creó','el conductor',null,'nombre',null,null),
  ('conductores','UPDATE','', 'actualizó','al conductor',null,'nombre',null,null),
  ('conductores','UPDATE','activo=false', 'desactivó','al conductor',null,'nombre',null,null),
  ('conductores','DELETE','', 'eliminó','al conductor',null,'nombre',null,null),

  -- tareas
  ('tareas','INSERT','', 'creó','la tarea',null,'titulo',null,null),
  ('tareas','UPDATE','', 'actualizó','la tarea',null,'titulo',null,null),
  ('tareas','DELETE','', 'eliminó','la tarea',null,'titulo',null,null),

  -- conteos_inventario
  ('conteos_inventario','INSERT','', 'inició','un conteo de inventario',null,null,null,null),
  ('conteos_inventario','UPDATE','', 'actualizó','el conteo de inventario',null,null,null,null),
  ('conteos_inventario','UPDATE','estado=aplicado', 'aplicó','el conteo de inventario',null,null,null,null),
  ('conteos_inventario','DELETE','', 'eliminó','el conteo de inventario',null,null,null,null),

  -- categorias_inventario
  ('categorias_inventario','INSERT','', 'creó','la categoría de inventario',null,'nombre',null,null),
  ('categorias_inventario','UPDATE','', 'actualizó','la categoría de inventario',null,'nombre',null,null),
  ('categorias_inventario','DELETE','', 'eliminó','la categoría de inventario',null,'nombre',null,null),

  -- vehiculo_entrega_fotos
  ('vehiculo_entrega_fotos','INSERT','', 'adjuntó','una foto de entrega de vehículo',null,null,null,null),
  ('vehiculo_entrega_fotos','UPDATE','', 'actualizó','una foto de entrega de vehículo',null,null,null,null),
  ('vehiculo_entrega_fotos','DELETE','', 'eliminó','una foto de entrega de vehículo',null,null,null,null),

  -- solicitudes_compra
  ('solicitudes_compra','INSERT','', 'creó','la solicitud de compra',null,null,null,null),
  ('solicitudes_compra','UPDATE','', 'actualizó','la solicitud de compra',null,null,null,null),
  ('solicitudes_compra','UPDATE','estado=rechazada', 'rechazó','la solicitud de compra',null,null,null,null),
  ('solicitudes_compra','UPDATE','estado=convertida', 'convirtió a orden de compra','la solicitud de compra',null,null,null,null),
  ('solicitudes_compra','DELETE','', 'eliminó','la solicitud de compra',null,null,null,null),

  -- extras no-top-30 pero huecos obvios de compras/flota (5 tablas, total 35)
  ('solicitud_compra_items','INSERT','', 'agregó','un renglón a la solicitud de compra',null,null,'solicitudes_compra','solicitud_id'),
  ('solicitud_compra_items','UPDATE','', 'modificó','un renglón de la solicitud de compra',null,null,'solicitudes_compra','solicitud_id'),
  ('solicitud_compra_items','DELETE','', 'quitó','un renglón de la solicitud de compra',null,null,'solicitudes_compra','solicitud_id'),
  ('reportes_usuario','INSERT','', 'reportó','un problema',null,null,null,null),
  ('reportes_usuario','UPDATE','', 'actualizó','un reporte de usuario',null,null,null,null),
  ('reportes_usuario','UPDATE','estado=resuelto', 'resolvió','un reporte de usuario',null,null,null,null),
  ('reportes_usuario','UPDATE','estado=descartado', 'descartó','un reporte de usuario',null,null,null,null),
  ('reportes_usuario','DELETE','', 'eliminó','un reporte de usuario',null,null,null,null),
  ('mantenimientos','INSERT','', 'registró','un mantenimiento',null,null,null,null),
  ('mantenimientos','UPDATE','', 'actualizó','el mantenimiento',null,null,null,null),
  ('mantenimientos','UPDATE','estado=completado', 'completó','el mantenimiento',null,null,null,null),
  ('mantenimientos','UPDATE','estado=en_proceso', 'inició','el mantenimiento',null,null,null,null),
  ('mantenimientos','DELETE','', 'eliminó','el mantenimiento',null,null,null,null),
  ('vehiculo_entregas','INSERT','', 'abrió','una entrega/recepción de vehículo',null,null,null,null),
  ('vehiculo_entregas','UPDATE','', 'actualizó','la entrega de vehículo',null,null,null,null),
  ('vehiculo_entregas','UPDATE','estado=cerrada', 'cerró','la entrega de vehículo',null,null,null,null),
  ('vehiculo_entregas','DELETE','', 'eliminó','la entrega de vehículo',null,null,null,null),
  ('ordenes_compra','INSERT','', 'creó','la orden de compra',null,'numero',null,null),
  ('ordenes_compra','UPDATE','', 'actualizó','la orden de compra',null,'numero',null,null),
  ('ordenes_compra','UPDATE','estado=recibida', 'marcó como recibida','la orden de compra',null,'numero',null,null),
  ('ordenes_compra','DELETE','', 'eliminó','la orden de compra',null,'numero',null,null)
on conflict (tabla, operacion, condicion) do nothing;

-- ── 5) sgc.auditoria_frase() — arma "verbo sustantivo [código]" para UNA fila ──
create or replace function sgc.auditoria_frase(
  p_tabla text,
  p_accion text,
  p_cambios jsonb,
  p_datos_despues jsonb,
  p_datos_antes jsonb
)
returns table(frase_resumen text, codigo text, verbo text, sustantivo text)
language plpgsql
stable
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_rec record;
  v_verbo text;
  v_sustantivo text;
  v_codigo_prefijo text;
  v_codigo_campo text;
  v_padre_tabla text;
  v_padre_fk_campo text;
  v_cond_campo text;
  v_cond_valor text;
  v_valor text;
  v_raw text;
  v_fk_id text;
begin
  -- Condiciones específicas primero (condicion <> ''), default ('') al final.
  for v_rec in
    select f.condicion, f.verbo, f.sustantivo, f.codigo_prefijo, f.codigo_campo,
           f.padre_tabla, f.padre_fk_campo
    from sgc.auditoria_frases f
    where f.tabla = p_tabla and f.operacion = p_accion and f.activo
    order by (f.condicion <> '') desc, f.id
  loop
    if v_rec.condicion = '' then
      v_verbo := v_rec.verbo; v_sustantivo := v_rec.sustantivo;
      v_codigo_prefijo := v_rec.codigo_prefijo; v_codigo_campo := v_rec.codigo_campo;
      v_padre_tabla := v_rec.padre_tabla; v_padre_fk_campo := v_rec.padre_fk_campo;
      exit;
    end if;
    v_cond_campo := split_part(v_rec.condicion, '=', 1);
    v_cond_valor := split_part(v_rec.condicion, '=', 2);
    v_valor := case p_accion
      when 'INSERT' then p_datos_despues ->> v_cond_campo
      when 'DELETE' then p_datos_antes ->> v_cond_campo
      else coalesce(p_cambios -> v_cond_campo ->> 'despues', p_datos_despues ->> v_cond_campo)
    end;
    if v_valor is not null and v_valor = v_cond_valor then
      v_verbo := v_rec.verbo; v_sustantivo := v_rec.sustantivo;
      v_codigo_prefijo := v_rec.codigo_prefijo; v_codigo_campo := v_rec.codigo_campo;
      v_padre_tabla := v_rec.padre_tabla; v_padre_fk_campo := v_rec.padre_fk_campo;
      exit;
    end if;
  end loop;

  -- Nada en el catálogo (ni siquiera un default) → genérico, NUNCA vacío (regla 16).
  if v_verbo is null then
    v_verbo := case p_accion when 'INSERT' then 'creó' when 'UPDATE' then 'modificó'
                 when 'DELETE' then 'eliminó' else 'actuó sobre' end;
    v_sustantivo := 'un registro de ' || replace(p_tabla, '_', ' ');
  end if;

  -- Código: directo, o heredado del padre (renglones sin código propio).
  if v_codigo_campo is not null then
    v_raw := case p_accion when 'DELETE' then p_datos_antes ->> v_codigo_campo
                else coalesce(p_datos_despues ->> v_codigo_campo, p_datos_antes ->> v_codigo_campo) end;
  elsif v_padre_tabla is not null and v_padre_fk_campo is not null then
    v_fk_id := case p_accion when 'DELETE' then p_datos_antes ->> v_padre_fk_campo
                 else coalesce(p_datos_despues ->> v_padre_fk_campo, p_datos_antes ->> v_padre_fk_campo) end;
    if v_fk_id is not null then
      select f.codigo_prefijo, f.codigo_campo into v_codigo_prefijo, v_codigo_campo
        from sgc.auditoria_frases f
        where f.tabla = v_padre_tabla and f.operacion = 'UPDATE' and f.condicion = '' and f.activo
        limit 1;
      if v_codigo_campo is not null then
        begin
          execute format('select %I::text from sgc.%I where id = $1', v_codigo_campo, v_padre_tabla)
            into v_raw using v_fk_id::uuid;
        exception when others then
          v_raw := null; -- el padre pudo cambiar de forma; nunca tumbar la frase por esto
        end;
      end if;
    end if;
  end if;

  if v_raw is not null and v_raw <> '' then
    if v_codigo_prefijo is not null and v_raw ~ '^[0-9]+$' then
      codigo := v_codigo_prefijo || lpad(v_raw, 6, '0');
    elsif v_codigo_prefijo is not null then
      codigo := v_codigo_prefijo || v_raw;
    else
      codigo := v_raw;
    end if;
  else
    codigo := null;
  end if;

  verbo := v_verbo;
  sustantivo := v_sustantivo;
  frase_resumen := v_verbo || ' ' || v_sustantivo || (case when codigo is not null then ' ' || codigo else '' end);
  return next;
end;
$function$;

grant execute on function sgc.auditoria_frase(text, text, jsonb, jsonb, jsonb) to authenticated;

-- ── 6) sgc._auditoria_resumen_cambios() — "Campo: antes → después" en 1 línea ──
create or replace function sgc._auditoria_resumen_cambios(p_cambios jsonb)
returns text
language plpgsql
stable
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  k text; v jsonb; label text; antes text; despues text;
  partes text[] := '{}';
  total int; n int := 0;
begin
  if p_cambios is null or p_cambios = '{}'::jsonb then return null; end if;
  select count(*) into total from jsonb_object_keys(p_cambios);
  for k in select jsonb_object_keys(p_cambios) order by k loop
    n := n + 1;
    exit when n > 3;
    v := p_cambios -> k;
    label := case k
      when 'estado' then 'Estado' when 'activo' then 'Activo' when 'monto' then 'Monto'
      when 'cantidad' then 'Cantidad' when 'folio' then 'Folio' when 'nombre' then 'Nombre'
      when 'placa' then 'Placa' when 'cedula' then 'Cédula' when 'email' then 'Correo'
      when 'notas' then 'Notas' when 'urgencia' then 'Urgencia' when 'bodega_id' then 'Almacén'
      when 'proyecto_id' then 'Proyecto' when 'motivo_rechazo' then 'Motivo de rechazo'
      when 'fecha_necesidad' then 'Fecha necesaria' when 'autoaprobada' then 'Autoaprobada'
      when 'numero' then 'Número' when 'unidad' then 'Unidad'
      else initcap(replace(k, '_', ' '))
    end;
    antes := case when (v -> 'antes') is null or (v -> 'antes') = 'null'::jsonb then '—'
                  when jsonb_typeof(v -> 'antes') = 'boolean' then (case when (v ->> 'antes')::boolean then 'sí' else 'no' end)
                  else left(trim(both '"' from (v -> 'antes')::text), 40) end;
    despues := case when (v -> 'despues') is null or (v -> 'despues') = 'null'::jsonb then '—'
                  when jsonb_typeof(v -> 'despues') = 'boolean' then (case when (v ->> 'despues')::boolean then 'sí' else 'no' end)
                  else left(trim(both '"' from (v -> 'despues')::text), 40) end;
    partes := partes || (label || ': ' || antes || ' → ' || despues);
  end loop;
  if total > 3 then
    partes := partes || ('y ' || (total - 3) || ' campo(s) más');
  end if;
  return array_to_string(partes, ' · ');
end;
$function$;

grant execute on function sgc._auditoria_resumen_cambios(jsonb) to authenticated;

-- ── 7) sgc.fn_auditoria() — igual que PROD + captura `origen` del header ──────
-- Definición base tomada de PROD vía pg_get_functiondef (regla 19, 16-oct-2026).
create or replace function sgc.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_imp   uuid := sgc.impersonado_por();
  v_origen text;
  v_old   jsonb;
  v_new   jsonb;
  v_cambios jsonb := '{}'::jsonb;
  k text;
  v_skip constant text[] := array['updated_at','actualizado_en','search','tsv','fts','embedding','search_vector'];
begin
  -- CQ3 — "desde dónde" (web@1.193.0 / app@2.55.0). Mismo patrón defensivo que
  -- impersonado_por(): si el header no viene (ej. llamadas vía SQL directo,
  -- service_role, o un PostgREST sin ese GUC) nunca tumba el trigger.
  begin
    v_origen := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-sgc-client', '');
  exception when others then
    v_origen := null;
  end;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, datos_despues, origen)
      values (tg_table_name, coalesce(v_new->>'id',''), 'INSERT', v_actor, v_imp, v_new, v_origen);
    return new;

  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      if k = any(v_skip) then continue; end if;
      if (v_new->k) is distinct from (v_old->k) then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k));
      end if;
    end loop;
    if v_cambios <> '{}'::jsonb then
      insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, cambios, origen)
        values (tg_table_name, coalesce(v_new->>'id',''), 'UPDATE', v_actor, v_imp, v_cambios, v_origen);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, impersonado_por, datos_antes, origen)
      values (tg_table_name, coalesce(v_old->>'id',''), 'DELETE', v_actor, v_imp, v_old, v_origen);
    return old;
  end if;
  return null;
end;
$function$;

-- ── 8) sgc.auditoria_actividad() — línea de tiempo con cursor ─────────────────
create or replace function sgc.auditoria_actividad(
  p_filtros jsonb default '{}'::jsonb,
  p_cursor text default null,
  p_limite int default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_persona uuid;
  v_modulo text := nullif(p_filtros->>'modulo', '');
  v_accion text := nullif(p_filtros->>'accion', '');
  v_desde date;
  v_hasta date;
  v_texto text := nullif(trim(p_filtros->>'texto'), '');
  v_limite int := greatest(1, least(coalesce(p_limite, 40), 100));
  v_cursor_fecha timestamptz;
  v_cursor_id bigint;
  v_raw text;
  v_coded text[] := '{}';
  v_found text[];
  v_rec record;
  v_buscar text;
  i int;
  v_out jsonb;
begin
  if not sgc.puede_ver_auditoria() then raise exception 'No autorizado.'; end if;

  begin v_persona := nullif(p_filtros->>'persona', '')::uuid; exception when others then v_persona := null; end;
  begin v_desde := nullif(p_filtros->>'desde', '')::date; exception when others then v_desde := null; end;
  begin v_hasta := nullif(p_filtros->>'hasta', '')::date; exception when others then v_hasta := null; end;

  if p_cursor is not null and p_cursor <> '' then
    begin
      v_raw := convert_from(decode(p_cursor, 'base64'), 'utf8');
      v_cursor_fecha := split_part(v_raw, '|', 1)::timestamptz;
      v_cursor_id := split_part(v_raw, '|', 2)::bigint;
    exception when others then
      v_cursor_fecha := null; v_cursor_id := null;
    end;
  end if;

  -- Búsqueda de texto: código legible → id, SIN adivinar el formato (regla 10 —
  -- nunca esconde una estrategia válida). Solo tablas con código propio (no las
  -- de "renglón", esas no tienen un valor propio que buscar).
  if v_texto is not null then
    for v_rec in
      select distinct tabla, codigo_campo, codigo_prefijo
      from sgc.auditoria_frases
      where codigo_campo is not null and padre_tabla is null
    loop
      -- Si el texto trae el prefijo del código (ej. "REQ-000091" sobre folio=91),
      -- lo despojamos antes de buscar contra la columna cruda (folio::text='91').
      -- Sin esto, buscar el código EXACTO que la propia pantalla muestra (bold en
      -- el timeline) nunca encontraría nada — regresión silenciosa.
      v_buscar := v_texto;
      if v_rec.codigo_prefijo is not null and v_texto ilike (v_rec.codigo_prefijo || '%') then
        v_buscar := ltrim(substring(v_texto from length(v_rec.codigo_prefijo) + 1), '0');
        if v_buscar = '' then v_buscar := '0'; end if;
      end if;
      begin
        execute format('select array_agg(id::text) from sgc.%I where %I::text ilike $1 limit 50', v_rec.tabla, v_rec.codigo_campo)
          into v_found using '%' || v_buscar || '%';
      exception when others then
        v_found := null;
      end;
      if v_found is not null then
        for i in 1 .. array_length(v_found, 1) loop
          v_coded := v_coded || (v_rec.tabla || '|' || v_found[i]);
        end loop;
      end if;
    end loop;
  end if;

  with base as (
    select a.*, u.nombre::text as actor_nombre, im.nombre::text as impersonador_nombre
    from sgc.auditoria a
    left join sgc.usuarios u on u.id = a.actor_id
    left join sgc.usuarios im on im.id = a.impersonado_por
    where (v_persona is null or a.actor_id = v_persona)
      and (v_modulo is null or a.tabla = v_modulo)
      and (v_accion is null or a.accion = v_accion)
      and (v_desde is null or a.creado_en >= v_desde::timestamptz)
      and (v_hasta is null or a.creado_en < (v_hasta + 1)::timestamptz)
      and (
        v_texto is null
        or a.registro_id ilike '%' || v_texto || '%'
        or a.tabla ilike '%' || v_texto || '%'
        or u.nombre::text ilike '%' || v_texto || '%'
        or (a.tabla || '|' || a.registro_id) = any(v_coded)
      )
      and (
        v_cursor_fecha is null
        or (a.creado_en, a.id) < (v_cursor_fecha, v_cursor_id)
      )
  ),
  -- LIMIT se aplica ANTES de numerar (sobre `base` directamente, aprovechando
  -- ix_auditoria_fecha/ix_auditoria_actor_fecha para un top-N sin ordenar todo
  -- sgc.auditoria) — si el row_number() se calculara sobre `base` completo, Postgres
  -- tendría que materializar y ordenar TODAS las filas filtradas antes de poder
  -- recortar, perdiendo el top-N scan.
  pagina as (
    select * from base order by creado_en desc, id desc limit v_limite + 1
  ),
  enumerada as (
    select *, row_number() over (order by creado_en desc, id desc) as rn from pagina
  )
  select jsonb_build_object(
    'filas', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'tabla', p.tabla,
        'registro_id', p.registro_id,
        'accion', p.accion,
        'creado_en', p.creado_en,
        'actor_id', p.actor_id,
        'actor_nombre', p.actor_nombre,
        'actor_roles', (
          select coalesce(jsonb_agg(r.nombre::text order by r.nombre), '[]'::jsonb)
          from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
          where ur.usuario_id = p.actor_id
        ),
        'impersonado_por', p.impersonado_por,
        'impersonador_nombre', p.impersonador_nombre,
        'origen', p.origen,
        'frase_resumen', fr.frase_resumen,
        'codigo', fr.codigo,
        'resumen_cambio', sgc._auditoria_resumen_cambios(p.cambios),
        'cambios', p.cambios,
        'datos_antes', p.datos_antes,
        'datos_despues', p.datos_despues
      ) order by p.creado_en desc, p.id desc
    ) filter (where p.rn <= v_limite), '[]'::jsonb),
    'cursor_siguiente', (
      select encode((creado_en::text || '|' || id::text)::bytea, 'base64')
      from enumerada where rn = v_limite
    ),
    'hay_mas', (select count(*) > v_limite from enumerada)
  )
  into v_out
  from enumerada p
  left join lateral sgc.auditoria_frase(p.tabla, p.accion, p.cambios, p.datos_despues, p.datos_antes) fr on true
  where p.rn <= v_limite;

  return coalesce(v_out, jsonb_build_object('filas', '[]'::jsonb, 'cursor_siguiente', null, 'hay_mas', false));
end;
$function$;

grant execute on function sgc.auditoria_actividad(jsonb, text, int) to authenticated;

-- ── 9) sgc.auditoria_historia_registro() — toda la vida de UN registro ────────
create or replace function sgc.auditoria_historia_registro(p_tabla text, p_registro_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_out jsonb;
begin
  if not sgc.puede_ver_auditoria() then raise exception 'No autorizado.'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'tabla', a.tabla,
      'registro_id', a.registro_id,
      'accion', a.accion,
      'creado_en', a.creado_en,
      'actor_id', a.actor_id,
      'actor_nombre', u.nombre::text,
      'actor_roles', (
        select coalesce(jsonb_agg(r.nombre::text order by r.nombre), '[]'::jsonb)
        from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = a.actor_id
      ),
      'impersonado_por', a.impersonado_por,
      'impersonador_nombre', im.nombre::text,
      'origen', a.origen,
      'frase_resumen', fr.frase_resumen,
      'codigo', fr.codigo,
      'resumen_cambio', sgc._auditoria_resumen_cambios(a.cambios),
      'cambios', a.cambios,
      'datos_antes', a.datos_antes,
      'datos_despues', a.datos_despues
    ) order by a.creado_en asc, a.id asc
  ), '[]'::jsonb)
  into v_out
  from sgc.auditoria a
  left join sgc.usuarios u on u.id = a.actor_id
  left join sgc.usuarios im on im.id = a.impersonado_por
  left join lateral sgc.auditoria_frase(a.tabla, a.accion, a.cambios, a.datos_despues, a.datos_antes) fr on true
  where a.tabla = p_tabla and a.registro_id = p_registro_id;

  return v_out;
end;
$function$;

grant execute on function sgc.auditoria_historia_registro(text, text) to authenticated;

commit;
