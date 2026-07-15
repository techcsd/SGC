-- ============================================================================
-- Actualización 2 — FASE 1 (SQL, aditivo/retrocompatible)
-- Cubre: U10 (inspección = 10 tópicos), U22 (geo en bodegas), U5 (normalizar
-- teléfono), U16 (vista de movimientos), U25 (inteligencia de "Otro/s").
-- U1 (pool) no requiere cambio de BD: `vehiculo_asignaciones` ya permite que
-- distintos usuarios usen el mismo vehículo (índice único es por (vehiculo,usuario)
-- solo activa) y `asignarme_vehiculo` valida disponibilidad por estado, no
-- exclusividad. El pool se resuelve en la UI (FASE 2).
-- ============================================================================

set search_path = sgc, public;

-- ── U10 — Inspección de vehículo = los 10 tópicos oficiales ─────────────────
-- Se DESACTIVA PRE-USO-V2 (33 ítems, queda histórico) y se activa PRE-USO-V3 con
-- las 9 preguntas oficiales (§B). NOTA DE PRODUCTO (Xaviel away al aplicar): §B
-- las define "ninguna crítica" para el REPORTE SEMANAL; para el PRE-USO diario se
-- marcan críticas las 5 de seguridad (1 documentación, 2 luces, 3 neumáticos,
-- 4 frenos, 5 motor/fluidos) — decisión de Xaviel (Opción 1) — para conservar el
-- bloqueo de vehículo inseguro de Flota v2. Flags fácilmente configurables (una
-- fila por ítem). PENDIENTE confirmar con el jefe cuáles de los 10 bloquean.
-- Reversible: PRE-USO-V2 (33) sigue existiendo; para volver, reactivarla.
-- El REPORTE-SEMANAL-V2 (semanal, sin críticos) NO se toca: un NO → hallazgo.
update sgc.checklist_plantillas set activo = false where codigo = 'PRE-USO-V2' and activo;

do $$
declare v_pid uuid;
begin
  insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia)
  values ('PRE-USO-V3', 'Inspección de vehículo (pre-uso)', 'general',
          'Inspección oficial de 10 tópicos (9 OK/NO/NA + comentario). Las de seguridad vial bloquean el vehículo si fallan.',
          true, 1, 'preuso')
  on conflict (codigo) do update set activo = true, nombre = excluded.nombre,
    categoria = excluded.categoria, descripcion = excluded.descripcion,
    orden = excluded.orden, frecuencia = excluded.frecuencia;
  select id into v_pid from sgc.checklist_plantillas where codigo = 'PRE-USO-V3';
  delete from sgc.checklist_plantilla_items where plantilla_id = v_pid;
  insert into sgc.checklist_plantilla_items (plantilla_id, seccion, numero, etiqueta, es_critico, aplica_a, orden) values
    (v_pid,'Documentación y autorización','1','Verificar que la matrícula, seguro y permisos estén vigentes.', true,'Ambos',1),
    (v_pid,'Luces y señalización','2','Comprobar funcionamiento de luces delanteras, traseras, freno, direccionales, reversa, parqueo y neblineras.', true,'Ambos',2),
    (v_pid,'Neumáticos y ruedas','3','Revisar presión, desgaste, cortes o fisuras en los neumáticos. Confirmar que el neumático de repuesto esté en buenas condiciones.', true,'Ambos',3),
    (v_pid,'Sistema de frenos','4','Verificar el funcionamiento del freno de servicio y del freno de emergencia antes de iniciar la marcha.', true,'Ambos',4),
    (v_pid,'Motor y fluidos','5','Inspeccionar que no existan fugas de aceite, combustible o refrigerante. Revisar niveles de aceite, refrigerante y otros fluidos visibles.', true,'Ambos',5),
    (v_pid,'Visibilidad del conductor','6','Verificar el funcionamiento de limpiaparabrisas y el nivel del agua del depósito.', false,'Ambos',6),
    (v_pid,'Dispositivos de seguridad','7','Probar la bocina y, cuando aplique, la alarma de retroceso.', false,'Ambos',7),
    (v_pid,'Herramientas y equipos de emergencia','8','Confirmar la presencia y buen estado de gato, llave de ruedas, conos o triángulos y demás herramientas requeridas.', false,'Ambos',8),
    (v_pid,'Estado general del vehículo','9','Revisar visualmente la carrocería, posibles daños, fugas, piezas sueltas u otras condiciones inseguras antes de salir.', false,'Ambos',9);
end $$;

-- ── U22 — Coordenadas en almacenes (proyectos ya tiene latitud/longitud) ────
alter table sgc.bodegas
  add column if not exists latitud     double precision,
  add column if not exists longitud    double precision,
  add column if not exists direccion_geo text;

-- ── U5 — Normalización de teléfono (guardar dígitos) ────────────────────────
create or replace function sgc.normalizar_telefono(p_tel text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p_tel,''), '[^0-9]', '', 'g'), '');
$$;
grant execute on function sgc.normalizar_telefono(text) to authenticated, service_role;

-- ── U16 — Vista de movimientos de inventario (entradas + salidas) ───────────
-- El "conduce" es el documento generado desde la salida (no hay tabla conduce);
-- esta vista alimenta el historial por almacén y global. referencia_id = id del
-- movimiento (para enlazar a su conduce/detalle).
create or replace view sgc.v_movimientos_inventario
with (security_invoker = true) as
  select s.id as referencia_id, 'salida'::text as tipo, s.fecha, s.created_at,
         s.bodega_id, s.motivo as concepto, s.responsable, s.proyecto_id,
         (select count(*) from sgc.detalle_salidas d where d.salida_id = s.id) as items,
         s.creado_por
    from sgc.salidas_inventario s
  union all
  select e.id, 'entrada'::text, e.fecha, e.created_at,
         e.bodega_id, e.referencia, null::varchar, null::uuid,
         (select count(*) from sgc.detalle_entradas d where d.entrada_id = e.id) as items,
         e.creado_por
    from sgc.entradas_inventario e;
grant select on sgc.v_movimientos_inventario to authenticated, service_role;

-- ── U25 — Inteligencia de "Otro/s" ─────────────────────────────────────────
create table if not exists sgc.otros_valores (
  id                uuid primary key default gen_random_uuid(),
  contexto          text not null,               -- p.ej. 'bitacora.restriccion', 'inventario.motivo'
  valor             text not null,               -- lo que escribió el usuario
  valor_normalizado text not null,               -- lower(trim(colapsar espacios))
  usuario_id        uuid references sgc.usuarios(id),
  referencia_id     uuid,                         -- id del registro que lo originó
  created_at        timestamptz not null default now()
);
create index if not exists idx_otros_valores_ctx on sgc.otros_valores(contexto, valor_normalizado);
create index if not exists idx_otros_valores_fecha on sgc.otros_valores(created_at);

alter table sgc.otros_valores enable row level security;
drop policy if exists otros_valores_sel on sgc.otros_valores;
create policy otros_valores_sel on sgc.otros_valores for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.tiene_modulo('direccion'));
drop policy if exists otros_valores_ins on sgc.otros_valores;
create policy otros_valores_ins on sgc.otros_valores for insert to authenticated with check (true);
grant select, insert on sgc.otros_valores to authenticated;
grant all on sgc.otros_valores to service_role;

-- Umbrales configurables (reutiliza flota_config: clave/valor numérico).
insert into sgc.flota_config (clave, valor) values
  ('otros_umbral_repeticiones', 3),
  ('otros_umbral_dias', 30)
on conflict (clave) do nothing;

-- Registrar un valor "Otro" (idempotente por referencia_id+contexto+valor si aplica).
create or replace function sgc.registrar_otro_valor(p_contexto text, p_valor text, p_referencia_id uuid default null)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_norm text;
begin
  v_norm := lower(regexp_replace(trim(coalesce(p_valor,'')), '\s+', ' ', 'g'));
  if v_norm = '' then return; end if;
  insert into sgc.otros_valores (contexto, valor, valor_normalizado, usuario_id, referencia_id)
  values (p_contexto, trim(p_valor), v_norm, auth.uid(), p_referencia_id);
end $$;
grant execute on function sgc.registrar_otro_valor(text, text, uuid) to authenticated, service_role;

-- Vista de inteligencia: valores "Otro" frecuentes por contexto en la ventana
-- configurada, con bandera de si superan el umbral (→ sugerir opción oficial).
create or replace view sgc.v_otros_valores_frecuentes
with (security_invoker = true) as
with cfg as (
  select coalesce((select valor from sgc.flota_config where clave='otros_umbral_repeticiones'), 3) as umbral,
         coalesce((select valor from sgc.flota_config where clave='otros_umbral_dias'), 30)      as dias
)
select o.contexto, o.valor_normalizado,
       (array_agg(o.valor order by o.created_at desc))[1] as ejemplo,
       count(*) as repeticiones,
       max(o.created_at) as ultima_vez,
       (count(*) >= (select umbral from cfg)) as supera_umbral
  from sgc.otros_valores o, cfg
 where o.created_at >= now() - make_interval(days => (select dias from cfg)::int)
 group by o.contexto, o.valor_normalizado
 having count(*) >= 1;
grant select on sgc.v_otros_valores_frecuentes to authenticated, service_role;
