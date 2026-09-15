-- BQ3 + BQ5 — Saneamiento de echadas: gate hermano + edición completa  ·  14/09/2026
-- ---------------------------------------------------------------------------------
-- BQ3.  El toast "Ocurrió un error inesperado" al abrir Saneamiento NO es un bug del
--   cuerpo del RPC: verificado en prod, `echadas_sospechosas()` corre limpio y halla
--   22 filas.  El único fallo es el gate `is_admin()` (línea 9) que levanta 42501 —
--   y `42501` matchea el regex `42\d{3}` de friendly-error.util.ts:57-58 → toast.
--   El arreglo de UI (estado de error honesto) va en el front.
-- BQ5.  `registrar_combustible_app` ya está en es_flota_elevado() (BO4) pero sus RPCs
--   hermanos de edición seguían en is_admin() → regla 14.  Aquí:
--     (1) echadas_sospechosas / sanear_echada: is_admin() → es_flota_elevado() + grant
--     (2) traza `saneada_como_rol` (con qué rol elevado actuó)
--     (3) §F-3 (decisión Xaviel = edición completa): tabla historial + editar_echada
-- Copias VIVAS (pg_get_functiondef).  Validar begin/rollback.  Aplicar con OK.
-- ---------------------------------------------------------------------------------

-- ── (2) Traza: con qué rol elevado se saneó/editó ────────────────────────────────
alter table sgc.registros_combustible
  add column if not exists saneada_como_rol text;

-- Helper: el rol elevado con el que actúa el caller (para traza).  STABLE.
create or replace function sgc.mi_rol_flota_elevado()
returns text
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $$
  select r.codigo
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
   where ur.usuario_id = auth.uid()
     and r.codigo in ('admin','direccion','gerencia','jefe_flota','logistica')
   order by array_position(array['admin','direccion','gerencia','jefe_flota','logistica'], r.codigo)
   limit 1;
$$;
grant execute on function sgc.mi_rol_flota_elevado() to authenticated;

-- ── (1a) echadas_sospechosas: gate → es_flota_elevado ────────────────────────────
CREATE OR REPLACE FUNCTION sgc.echadas_sospechosas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_pmin numeric := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
  v_pmax numeric := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
  v_rmin numeric := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
  v_rmax numeric := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
  v_capnv numeric := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
begin
  -- BQ5 — antes is_admin(); ahora el mismo predicado que registrar_combustible_app.
  if not sgc.es_flota_elevado() then raise exception 'Solo referentes de flota' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.fecha desc)
    from (
      select r.id, r.fecha, r.vehiculo_id, v.placa, v.marca, v.tipo,
             r.galones, r.monto, r.precio_por_galon, r.kilometraje, r.km_recorridos,
             r.rendimiento_km_gal, r.estado, r.es_prueba, r.invalidada,
             case when r.vehiculo_id is not null then sgc.cap_tanque_vehiculo(r.vehiculo_id) else v_capnv end as cap,
             (select array_agg(m) from unnest(array_remove(array[
                case when r.vehiculo_id is not null and r.galones > sgc.cap_tanque_vehiculo(r.vehiculo_id)
                     then 'Galones sobre la capacidad de tanque' end,
                case when r.vehiculo_id is null and r.galones > v_capnv
                     then 'Galones sobre el tope de depósito' end,
                case when coalesce(r.monto,0) > 0 and r.precio_por_galon is not null
                          and (r.precio_por_galon < v_pmin or r.precio_por_galon > v_pmax)
                     then 'Precio/galón fuera de banda' end,
                case when r.rendimiento_km_gal is not null and r.rendimiento_km_gal > v_rmax
                     then 'Rendimiento imposiblemente alto (error de dato)' end,
                case when r.rendimiento_km_gal is not null and r.km_recorridos is not null
                          and r.rendimiento_km_gal < v_rmin
                     then 'Rendimiento imposiblemente bajo' end
              ], null)) ) as motivos
      from sgc.registros_combustible r
      left join sgc.vehiculos v on v.id = r.vehiculo_id
      where not coalesce(r.invalidada, false)
        and (
          (r.vehiculo_id is not null and r.galones > sgc.cap_tanque_vehiculo(r.vehiculo_id)) or
          (r.vehiculo_id is null and r.galones > v_capnv) or
          (coalesce(r.monto,0) > 0 and r.precio_por_galon is not null
             and (r.precio_por_galon < v_pmin or r.precio_por_galon > v_pmax)) or
          (r.rendimiento_km_gal is not null and r.rendimiento_km_gal > v_rmax) or
          (r.rendimiento_km_gal is not null and r.km_recorridos is not null and r.rendimiento_km_gal < v_rmin)
        )
    ) x
  ), '[]'::jsonb);
end;
$function$;
grant execute on function sgc.echadas_sospechosas() to authenticated;

-- ── (1b) sanear_echada: gate → es_flota_elevado + traza rol ──────────────────────
CREATE OR REPLACE FUNCTION sgc.sanear_echada(p_id uuid, p_accion text, p_galones numeric DEFAULT NULL::numeric, p_monto numeric DEFAULT NULL::numeric, p_kilometraje integer DEFAULT NULL::integer, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare v_row sgc.registros_combustible%rowtype; v_uid uuid := auth.uid(); v_rol text := sgc.mi_rol_flota_elevado();
begin
  -- BQ5 — antes is_admin(); ahora es_flota_elevado() (incluye logística = Raykler).
  if not sgc.es_flota_elevado() then
    raise exception 'Solo referentes de flota pueden sanear echadas' using errcode = '42501';
  end if;
  select * into v_row from sgc.registros_combustible where id = p_id;
  if not found then raise exception 'Echada no encontrada'; end if;

  if p_accion = 'invalidar' then
    update sgc.registros_combustible
       set invalidada = true, saneada = true,
           saneamiento_motivo = coalesce(nullif(trim(p_motivo),''), 'Excluida por dato inválido'),
           saneada_por = v_uid, saneada_at = now(), saneada_como_rol = v_rol,
           valor_original = coalesce(valor_original, to_jsonb(v_row))
     where id = p_id;

  elsif p_accion = 'revalidar' then
    update sgc.registros_combustible
       set invalidada = false, saneada = true,
           saneamiento_motivo = coalesce(nullif(trim(p_motivo),''), 'Revalidada'),
           saneada_por = v_uid, saneada_at = now(), saneada_como_rol = v_rol
     where id = p_id;

  elsif p_accion = 'corregir' then
    update sgc.registros_combustible
       set valor_original = coalesce(valor_original, to_jsonb(v_row)),
           galones     = coalesce(p_galones, galones),
           monto       = coalesce(p_monto, monto),
           kilometraje = coalesce(p_kilometraje, kilometraje),
           precio_por_galon = case
             when coalesce(p_monto, monto) > 0 and coalesce(p_galones, galones) > 0
             then round(coalesce(p_monto, monto) / coalesce(p_galones, galones), 2)
             else precio_por_galon end,
           invalidada = false, saneada = true,
           saneamiento_motivo = coalesce(nullif(trim(p_motivo),''), 'Corregida'),
           saneada_por = v_uid, saneada_at = now(), saneada_como_rol = v_rol
     where id = p_id;
    update sgc.registros_combustible r
       set km_recorridos = case
             when r.km_anterior is not null and r.kilometraje is not null and r.kilometraje > r.km_anterior
             then r.kilometraje - r.km_anterior else r.km_recorridos end
     where r.id = p_id;
    update sgc.registros_combustible r
       set rendimiento_km_gal = case
             when coalesce(r.km_recorridos,0) > 0 and coalesce(r.galones,0) > 0
             then round(r.km_recorridos::numeric / r.galones, 2) else null end,
           costo_por_km = case
             when coalesce(r.km_recorridos,0) > 0 and coalesce(r.monto,0) > 0
             then round(r.monto / r.km_recorridos, 2) else null end
     where r.id = p_id;

  else
    raise exception 'Acción no válida: % (usa corregir | invalidar | revalidar)', p_accion;
  end if;

  perform sgc.recalcular_estados_combustible();
  select * into v_row from sgc.registros_combustible where id = p_id;
  return to_jsonb(v_row);
end;
$function$;
grant execute on function sgc.sanear_echada(uuid,text,numeric,numeric,integer,text) to authenticated;

-- ── (3) §F-3 — Edición completa de cualquier echada, con historial ───────────────
create table if not exists sgc.registros_combustible_historial (
  id            uuid primary key default gen_random_uuid(),
  registro_id   uuid not null references sgc.registros_combustible(id) on delete cascade,
  antes         jsonb not null,
  despues       jsonb not null,
  motivo        text,
  editado_por   uuid references sgc.usuarios(id),
  editado_como_rol text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_rc_historial_registro on sgc.registros_combustible_historial(registro_id, created_at desc);

alter table sgc.registros_combustible_historial enable row level security;
-- RLS: solo referentes de flota leen el historial (misma frontera que el saneamiento).
drop policy if exists rc_hist_select on sgc.registros_combustible_historial;
create policy rc_hist_select on sgc.registros_combustible_historial
  for select to authenticated using (sgc.es_flota_elevado());
-- No INSERT policy: solo el RPC security-definer escribe.

grant select on sgc.registros_combustible_historial to authenticated;

-- editar_echada — edición completa con whitelist, historial y recálculo de cadena.
create or replace function sgc.editar_echada(p_id uuid, p_cambios jsonb, p_motivo text default null)
returns jsonb
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_row     sgc.registros_combustible%rowtype;
  v_antes   jsonb;
  v_uid     uuid := auth.uid();
  v_rol     text := sgc.mi_rol_flota_elevado();
  v_next    uuid;
begin
  if not sgc.es_flota_elevado() then
    raise exception 'Solo referentes de flota pueden editar echadas' using errcode = '42501';
  end if;
  select * into v_row from sgc.registros_combustible where id = p_id;
  if not found then raise exception 'Echada no encontrada'; end if;
  v_antes := to_jsonb(v_row);

  -- Whitelist estricta (regla 10): solo estos 7 campos son editables.
  update sgc.registros_combustible
     set vehiculo_id = case when p_cambios ? 'vehiculo_id'
                            then nullif(p_cambios->>'vehiculo_id','')::uuid else vehiculo_id end,
         estacion    = case when p_cambios ? 'estacion'    then nullif(p_cambios->>'estacion','') else estacion end,
         fecha       = case when p_cambios ? 'fecha'       then (p_cambios->>'fecha')::date else fecha end,
         galones     = case when p_cambios ? 'galones'     then (p_cambios->>'galones')::numeric else galones end,
         monto       = case when p_cambios ? 'monto'       then nullif(p_cambios->>'monto','')::numeric else monto end,
         kilometraje = case when p_cambios ? 'kilometraje' then (p_cambios->>'kilometraje')::integer else kilometraje end,
         producto    = case when p_cambios ? 'producto'    then nullif(p_cambios->>'producto','') else producto end,
         valor_original = coalesce(valor_original, v_antes),
         saneada = true, saneada_por = v_uid, saneada_at = now(), saneada_como_rol = v_rol,
         saneamiento_motivo = coalesce(nullif(trim(p_motivo),''), 'Editada')
   where id = p_id;

  -- Recalcular precio, km_anterior (max de echadas previas no invalidadas del mismo
  -- vehículo, mismo es_prueba), km_recorridos y derivados de ESTA echada.
  update sgc.registros_combustible r
     set precio_por_galon = case when coalesce(r.monto,0)>0 and coalesce(r.galones,0)>0
                                 then round(r.monto/r.galones,2) else null end,
         km_anterior = (
           select max(r2.kilometraje) from sgc.registros_combustible r2
            where r2.vehiculo_id = r.vehiculo_id and r2.id <> r.id
              and r2.kilometraje is not null and not coalesce(r2.invalidada,false)
              and coalesce(r2.es_prueba,false) = coalesce(r.es_prueba,false)
              and r2.created_at < r.created_at)
   where r.id = p_id;
  update sgc.registros_combustible r
     set km_recorridos = case when r.km_anterior is not null and r.kilometraje is not null and r.kilometraje > r.km_anterior
                              then r.kilometraje - r.km_anterior else null end
   where r.id = p_id;
  update sgc.registros_combustible r
     set rendimiento_km_gal = case when coalesce(r.km_recorridos,0)>0 and coalesce(r.galones,0)>0
                                   then round(r.km_recorridos::numeric/r.galones,2) else null end,
         costo_por_km = case when coalesce(r.km_recorridos,0)>0 and coalesce(r.monto,0)>0
                             then round(r.monto/r.km_recorridos,2) else null end
   where r.id = p_id;

  -- La SIGUIENTE echada del mismo vehículo hereda esta lectura como km_anterior.
  select r.id into v_next from sgc.registros_combustible r
   where r.vehiculo_id = v_row.vehiculo_id and r.id <> p_id
     and not coalesce(r.invalidada,false)
     and coalesce(r.es_prueba,false) = coalesce(v_row.es_prueba,false)
     and r.created_at > v_row.created_at
   order by r.created_at asc limit 1;
  if v_next is not null then
    update sgc.registros_combustible r
       set km_anterior = (
             select max(r2.kilometraje) from sgc.registros_combustible r2
              where r2.vehiculo_id = r.vehiculo_id and r2.id <> r.id
                and r2.kilometraje is not null and not coalesce(r2.invalidada,false)
                and coalesce(r2.es_prueba,false) = coalesce(r.es_prueba,false)
                and r2.created_at < r.created_at)
     where r.id = v_next;
    update sgc.registros_combustible r
       set km_recorridos = case when r.km_anterior is not null and r.kilometraje is not null and r.kilometraje > r.km_anterior
                                then r.kilometraje - r.km_anterior else null end
     where r.id = v_next;
    update sgc.registros_combustible r
       set rendimiento_km_gal = case when coalesce(r.km_recorridos,0)>0 and coalesce(r.galones,0)>0
                                     then round(r.km_recorridos::numeric/r.galones,2) else null end,
           costo_por_km = case when coalesce(r.km_recorridos,0)>0 and coalesce(r.monto,0)>0
                               then round(r.monto/r.km_recorridos,2) else null end
     where r.id = v_next;
  end if;

  perform sgc.recalcular_estados_combustible();

  select * into v_row from sgc.registros_combustible where id = p_id;
  insert into sgc.registros_combustible_historial (registro_id, antes, despues, motivo, editado_por, editado_como_rol)
  values (p_id, v_antes, to_jsonb(v_row), nullif(trim(p_motivo),''), v_uid, v_rol);

  return to_jsonb(v_row);
end;
$function$;
grant execute on function sgc.editar_echada(uuid,jsonb,text) to authenticated;
