-- ============================================================================
-- CD3 (nota #94) — MT 03 "asignado por un problema" y atascado a Edward Mota.
--
-- Diagnóstico (prod, 30-sep): la migración OFF-LEDGER `2026-08-29-alinear-asignaciones-
-- a-uso.sql` (corrida desde scratchpad, ver sql/_recuperadas/) convirtió cada
-- `vehiculo_usos` abierto de ese día en una `vehiculo_asignaciones` AUTO permanente
-- (`origen='auto'`, `activa=true`, `hasta=null`, nota "Alineada al vehículo en uso
-- (2026-08-29)"). Edward tenía un uso de MT 03 abierto desde el 2026-08-14 (un uso de
-- prueba nunca cerrado) → quedó asignado a MT 03; el dashboard lo lee como "Mi vehículo".
-- MT 03.responsable_id = Edward (mismo origen). Afectados (4): POLIN RAMIREZ (L441660),
-- ing.Misael Encarnacion (L478815), MANOLO DURAN (L473027), EDWARD MOTA (MT 03).
--
-- 🔴 CORRECCIÓN DE DATOS EN PROD — la lista exacta va en el REPORTE y la revisa Xaviel
-- /Raykler ANTES de aplicar a prod (regla del prompt). En dev se aplica libremente.
-- Nada se BORRA: las asignaciones se retiran (activa=false + hasta + motivo).
--
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd3-asignaciones-auto.sql --env dev  →  (tras OK) --env prod
-- ============================================================================
begin;

-- ── Parte A — cerrar usos huérfanos abiertos > 24 h ────────────────────────
do $partA$
declare r record; n int := 0;
begin
  for r in
    select vu.id, vu.usuario_id, vu.vehiculo_id, vu.inicio_at, v.placa, u.nombre
    from sgc.vehiculo_usos vu
    left join sgc.vehiculos v on v.id = vu.vehiculo_id
    left join sgc.usuarios  u on u.id = vu.usuario_id
    where vu.fin_at is null
      and coalesce(vu.es_prueba,false) = false
      and vu.inicio_at < now() - interval '24 hours'
  loop
    raise notice 'CD3-A cerrar uso huerfano: % (% · %) abierto desde %',
      r.id, coalesce(r.nombre,'?'), coalesce(r.placa,'?'), r.inicio_at;
    update sgc.vehiculo_usos
       set fin_at = now(),
           notas  = concat_ws(' · ', notas, 'Cerrado automaticamente: uso sin cierre > 24 h (CD3, 2026-09-30)')
     where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'CD3-A: % uso(s) huerfano(s) cerrado(s).', n;
end $partA$;

-- ── Parte B — retirar asignaciones AUTO del script 29-08 sin respaldo ───────
-- Solo las de nota "Alineada…" (origen auto) que NO tengan actividad posterior que
-- las respalde: sin un uso iniciado después del 29-08 ni otra asignación NO-auto vigente.
do $partB$
declare r record; n int := 0;
begin
  for r in
    select va.id, va.usuario_id, va.vehiculo_id, u.nombre, v.placa
    from sgc.vehiculo_asignaciones va
    left join sgc.usuarios  u on u.id = va.usuario_id
    left join sgc.vehiculos v on v.id = va.vehiculo_id
    where va.origen = 'auto' and va.activa
      and va.notas ilike '%Alineada%uso%'
      and not exists (
        select 1 from sgc.vehiculo_usos vu
         where vu.vehiculo_id = va.vehiculo_id and vu.usuario_id = va.usuario_id
           and vu.inicio_at > date '2026-08-29')
      and not exists (
        select 1 from sgc.vehiculo_asignaciones va2
         where va2.vehiculo_id = va.vehiculo_id and va2.usuario_id = va.usuario_id
           and va2.activa and va2.origen <> 'auto')
  loop
    raise notice 'CD3-B retirar asignacion AUTO: % (% · %)', r.id, coalesce(r.nombre,'?'), coalesce(r.placa,'?');
    update sgc.vehiculo_asignaciones
       set activa = false,
           hasta  = now(),
           notas  = concat_ws(' · ', notas, 'CD3 — asignacion automatica erronea del 29-08 (retirada 2026-09-30)')
     where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'CD3-B: % asignacion(es) AUTO retirada(s).', n;
end $partB$;

-- ── Parte C — limpiar responsable_id sin respaldo ──────────────────────────
-- Un vehículo cuyo responsable_id coincide con un chofer que solo quedó ligado por la
-- asignación AUTO ya retirada, y que no tiene otra asignación NO-auto vigente ni uso
-- abierto, pierde el responsable (queda null hasta que Raykler defina el real).
do $partC$
declare r record; n int := 0;
begin
  for r in
    select v.id, v.placa, v.responsable_id, u.nombre
    from sgc.vehiculos v
    left join sgc.usuarios u on u.id = v.responsable_id
    where v.responsable_id is not null
      and not exists (
        select 1 from sgc.vehiculo_asignaciones va
         where va.vehiculo_id = v.id and va.usuario_id = v.responsable_id
           and va.activa and va.origen <> 'auto')
      and not exists (
        select 1 from sgc.vehiculo_usos vu
         where vu.vehiculo_id = v.id and vu.usuario_id = v.responsable_id and vu.fin_at is null)
      and exists (   -- solo los que quedaron por el auto-align (tenian la asignacion Alineada)
        select 1 from sgc.vehiculo_asignaciones va3
         where va3.vehiculo_id = v.id and va3.usuario_id = v.responsable_id
           and va3.origen = 'auto' and va3.notas ilike '%Alineada%uso%')
  loop
    raise notice 'CD3-C limpiar responsable_id: % (%) era % -> null', r.id, coalesce(r.placa,'?'), coalesce(r.nombre,'?');
    update sgc.vehiculos set responsable_id = null where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'CD3-C: % responsable(s) limpiado(s).', n;
end $partC$;

-- ── Parte D — cron: cerrar usos huérfanos a diario (recurrencia) ───────────
-- Cierra usos abiertos > 24 h y avisa al chofer. Evita que un uso sin cerrar vuelva a
-- "pegar" un vehículo (y a alimentar cualquier alineación futura). NO crea asignaciones.
create or replace function sgc.cerrar_usos_huerfanos(p_horas int default 24)
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare r record; n int := 0;
begin
  for r in
    select vu.id, vu.usuario_id, vu.vehiculo_id, v.placa
    from sgc.vehiculo_usos vu
    left join sgc.vehiculos v on v.id = vu.vehiculo_id
    where vu.fin_at is null
      and coalesce(vu.es_prueba,false) = false
      and vu.inicio_at < now() - make_interval(hours => greatest(1, p_horas))
  loop
    update sgc.vehiculo_usos
       set fin_at = now(),
           notas  = concat_ws(' · ', notas, 'Cerrado automaticamente: uso sin cierre > ' || p_horas || ' h')
     where id = r.id;
    if r.usuario_id is not null then
      perform sgc.notificar_usuarios(
        array[r.usuario_id], 'flota_uso_cerrado',
        'Uso de vehiculo cerrado', 'Cerramos tu uso de ' || coalesce(r.placa,'un vehiculo') ||
        ' porque quedo abierto mas de ' || p_horas || ' horas. Si lo sigues usando, abrelo de nuevo.',
        '/flota/mi-vehiculo', r.vehiculo_id, 'vehiculo_uso');
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

grant execute on function sgc.cerrar_usos_huerfanos(int) to authenticated;

select cron.schedule(
  'sgc-cerrar-usos-huerfanos',
  '0 9 * * *',                       -- 09:00 UTC (05:00 RD) diario
  $cron$ select sgc.cerrar_usos_huerfanos(24); $cron$
);

commit;
