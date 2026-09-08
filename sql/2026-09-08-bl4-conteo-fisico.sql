-- BL4 — Conteo físico de almacén (Raykler): unir las dos mitades que existían
-- sin hablarse. El conteo se registra (cabecera + items + motivo + auditoría) Y el
-- cierre reconcilia el stock SIN tocar el ledger (rebasa la apertura, como
-- ajuste_real_stock), en vez de escribir N movimientos.
--
-- Ciclo de vida: borrador → contado → aplicado (o cancelado). Borrador reanudable
-- (vive en BD, no en signals). "Aplicar" es el único paso que toca el stock, por el
-- mismo primitivo _aplicar_apertura (no ledger). Deshacer restaura la apertura.
--
-- Reglas: 3 (estado nuevo ⇒ constraint en la misma migración) · 8 (nada afirma lo
-- que no puede probar). Aditivo.

begin;

-- ── Cabecera: ciclo de vida ──────────────────────────────────────────────────
alter table sgc.conteos_inventario
  add column if not exists estado       text        not null default 'aplicado',
  add column if not exists fecha_conteo date,
  add column if not exists cerrado_por  uuid,
  add column if not exists aprobado_por uuid,
  add column if not exists aplicado_at  timestamptz,
  add column if not exists ciego        boolean     not null default false;

-- Los conteos previos (ajuste / chequeo_semanal) se aplicaban en el acto → 'aplicado'.
update sgc.conteos_inventario set estado = 'aplicado' where estado is null;

-- Regla 3 — constraint del estado en la MISMA migración.
alter table sgc.conteos_inventario drop constraint if exists conteos_inventario_estado_check;
alter table sgc.conteos_inventario
  add constraint conteos_inventario_estado_check
  check (estado in ('borrador','contado','aplicado','cancelado'));

-- Snapshot de la apertura ANTES de aplicar (para poder deshacer).
alter table sgc.conteo_items
  add column if not exists apertura_antes numeric;

-- 🔴 Clave del "sin tocar el ledger": hoy stock_movimientos_sigma SUMA
-- (cantidad_contada - cantidad_antes) de TODOS los conteo_items (así el chequeo
-- semanal mueve el stock). Un conteo_fisico se reconcilia por APERTURA al aplicar,
-- así que sus items NO deben contar como movimiento. Se excluye tipo='conteo_fisico'
-- del término de conteos. Aditivo: hoy no hay filas conteo_fisico → sin cambio de
-- comportamiento; correcto para el flujo nuevo.
create or replace function sgc.stock_movimientos_sigma(p_articulo_id uuid, p_bodega_id uuid)
returns numeric language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
      coalesce((select sum(de.cantidad)
                from sgc.detalle_entradas de
                join sgc.entradas_inventario e on e.id = de.entrada_id
                where de.articulo_id = p_articulo_id and e.bodega_id = p_bodega_id
                  and not coalesce(e.es_prueba, false)), 0)
    - coalesce((select sum(d.cantidad)
                from sgc.detalle_salidas d
                join sgc.salidas_inventario s on s.id = d.salida_id
                where d.articulo_id = p_articulo_id and s.bodega_id = p_bodega_id
                  and not coalesce(s.es_prueba, false)), 0)
    + coalesce((select sum(ci.cantidad_contada - ci.cantidad_antes)
                from sgc.conteo_items ci
                join sgc.conteos_inventario c on c.id = ci.conteo_id
                where ci.articulo_id = p_articulo_id and c.bodega_id = p_bodega_id
                  and not coalesce(c.es_prueba, false)
                  and coalesce(c.tipo,'') <> 'conteo_fisico'), 0);  -- BL4
$function$;

-- ── Gate: operar del submódulo inventario.conteos (o admin) ──────────────────
create or replace function sgc.puede_operar_conteo()
returns boolean language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$ select sgc.is_admin() or sgc.nivel_submodulo('inventario.conteos') = 'operar'; $$;
grant execute on function sgc.puede_operar_conteo() to authenticated, service_role;

-- ── Abrir / reanudar un conteo físico de una bodega ──────────────────────────
create or replace function sgc.conteo_fisico_abrir(p_bodega_id uuid, p_ciego boolean default false)
returns uuid language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid; v_existente uuid;
begin
  if not sgc.puede_operar_conteo() then
    raise exception 'No tienes permiso para hacer conteos de inventario' using errcode = '42501';
  end if;
  if p_bodega_id is null then raise exception 'Bodega requerida' using errcode = 'AT400'; end if;

  -- Reanudable: si ya hay un borrador de esta bodega, se devuelve (no se duplica).
  select id into v_existente from sgc.conteos_inventario
   where bodega_id = p_bodega_id and tipo = 'conteo_fisico' and estado = 'borrador'
   order by created_at desc limit 1;
  if v_existente is not null then return v_existente; end if;

  -- Un conteo 'contado' pendiente de aplicar bloquea abrir otro para esa bodega.
  if exists (select 1 from sgc.conteos_inventario
             where bodega_id = p_bodega_id and tipo = 'conteo_fisico' and estado = 'contado') then
    raise exception 'Ya hay un conteo de esta bodega por aplicar. Aplícalo o cancélalo primero.'
      using errcode = 'AT409';
  end if;

  insert into sgc.conteos_inventario (id, bodega_id, tipo, estado, ciego, fecha_conteo, creado_por)
  values (gen_random_uuid(), p_bodega_id, 'conteo_fisico', 'borrador', coalesce(p_ciego,false),
          (now() at time zone 'America/Santo_Domingo')::date, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function sgc.conteo_fisico_abrir(uuid, boolean) to authenticated, service_role;

-- ── Guardar (autosave del borrador; reemplaza los items) ─────────────────────
--   p_items: [{ "articulo_id": uuid, "cantidad_contada": numeric }]
create or replace function sgc.conteo_fisico_guardar(p_conteo_id uuid, p_items jsonb)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_bodega uuid; v_estado text; v_row jsonb; v_art uuid; v_cant numeric;
begin
  if not sgc.puede_operar_conteo() then
    raise exception 'No tienes permiso para hacer conteos de inventario' using errcode = '42501';
  end if;
  select bodega_id, estado into v_bodega, v_estado from sgc.conteos_inventario where id = p_conteo_id;
  if v_bodega is null then raise exception 'Conteo no encontrado' using errcode = 'AT404'; end if;
  if v_estado <> 'borrador' then
    raise exception 'Solo un conteo en borrador se puede editar (estado: %)', v_estado using errcode = 'AT409';
  end if;

  delete from sgc.conteo_items where conteo_id = p_conteo_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_art  := nullif(v_row->>'articulo_id','')::uuid;
    v_cant := nullif(v_row->>'cantidad_contada','')::numeric;
    if v_art is null then continue; end if;
    insert into sgc.conteo_items (conteo_id, articulo_id, cantidad_antes, cantidad_contada)
    values (p_conteo_id, v_art,
            sgc.apertura_efectiva(v_art, v_bodega) + sgc.stock_movimientos_sigma(v_art, v_bodega),
            v_cant);
  end loop;
end;
$function$;
grant execute on function sgc.conteo_fisico_guardar(uuid, jsonb) to authenticated, service_role;

-- ── Cerrar: borrador → contado (listo para aplicar) ──────────────────────────
create or replace function sgc.conteo_fisico_cerrar(p_conteo_id uuid)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_estado text;
begin
  if not sgc.puede_operar_conteo() then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  select estado into v_estado from sgc.conteos_inventario where id = p_conteo_id;
  if v_estado is null then raise exception 'Conteo no encontrado' using errcode = 'AT404'; end if;
  if v_estado <> 'borrador' then
    raise exception 'Solo un borrador se puede cerrar (estado: %)', v_estado using errcode = 'AT409';
  end if;
  if not exists (select 1 from sgc.conteo_items where conteo_id = p_conteo_id and cantidad_contada is not null) then
    raise exception 'El conteo no tiene ninguna cantidad registrada' using errcode = 'AT400';
  end if;
  update sgc.conteos_inventario
     set estado = 'contado', cerrado_por = auth.uid()
   where id = p_conteo_id;
end;
$function$;
grant execute on function sgc.conteo_fisico_cerrar(uuid) to authenticated, service_role;

-- ── Aplicar: contado → aplicado. Reconcilia el stock SIN tocar el ledger ─────
--   (rebasa la apertura, igual que ajuste_real_stock, pero registrando todo).
create or replace function sgc.conteo_fisico_aplicar(p_conteo_id uuid, p_motivo text)
returns jsonb language plpgsql security definer
set search_path to 'sgc', 'public'
as $function$
declare v_bodega uuid; v_estado text; v_it record; v_n int := 0; v_sigma numeric;
begin
  if not sgc.puede_operar_conteo() then
    raise exception 'No tienes permiso para aplicar conteos' using errcode = '42501';
  end if;
  if coalesce(nullif(trim(p_motivo),''), '') = '' then
    raise exception 'El motivo es obligatorio (queda en la auditoría)' using errcode = 'AT400';
  end if;
  select bodega_id, estado into v_bodega, v_estado from sgc.conteos_inventario where id = p_conteo_id;
  if v_bodega is null then raise exception 'Conteo no encontrado' using errcode = 'AT404'; end if;
  if v_estado <> 'contado' then
    raise exception 'Solo un conteo cerrado (contado) se puede aplicar (estado: %)', v_estado using errcode = 'AT409';
  end if;

  for v_it in
    select articulo_id, cantidad_contada from sgc.conteo_items
     where conteo_id = p_conteo_id and cantidad_contada is not null
  loop
    -- Snapshot de la apertura vigente (para deshacer) y rebase para que el stock
    -- final sea exactamente lo contado: apertura := contado - Σ movimientos.
    v_sigma := sgc.stock_movimientos_sigma(v_it.articulo_id, v_bodega);
    update sgc.conteo_items
       set apertura_antes = sgc.apertura_efectiva(v_it.articulo_id, v_bodega)
     where conteo_id = p_conteo_id and articulo_id = v_it.articulo_id;
    perform sgc._aplicar_apertura(v_it.articulo_id, v_bodega, v_it.cantidad_contada - v_sigma,
                                  auth.uid(), coalesce(nullif(trim(p_motivo),''), 'Conteo físico'));
    v_n := v_n + 1;
  end loop;

  update sgc.conteos_inventario
     set estado = 'aplicado', aprobado_por = auth.uid(), aplicado_at = now(),
         motivo = nullif(trim(p_motivo),'')
   where id = p_conteo_id;

  return jsonb_build_object('ok', true, 'ajustados', v_n);
end;
$function$;
grant execute on function sgc.conteo_fisico_aplicar(uuid, text) to authenticated, service_role;

-- ── Deshacer: aplicado → cancelado. Restaura la apertura previa ──────────────
create or replace function sgc.conteo_fisico_deshacer(p_conteo_id uuid)
returns void language plpgsql security definer
set search_path to 'sgc', 'public'
as $function$
declare v_bodega uuid; v_estado text; v_it record;
begin
  if not sgc.puede_operar_conteo() then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  select bodega_id, estado into v_bodega, v_estado from sgc.conteos_inventario where id = p_conteo_id;
  if v_bodega is null then raise exception 'Conteo no encontrado' using errcode = 'AT404'; end if;
  if v_estado <> 'aplicado' then
    raise exception 'Solo un conteo aplicado se puede deshacer (estado: %)', v_estado using errcode = 'AT409';
  end if;
  for v_it in
    select articulo_id, apertura_antes from sgc.conteo_items
     where conteo_id = p_conteo_id and apertura_antes is not null
  loop
    perform sgc._aplicar_apertura(v_it.articulo_id, v_bodega, v_it.apertura_antes,
                                  auth.uid(), 'Deshacer conteo físico');
  end loop;
  update sgc.conteos_inventario set estado = 'cancelado' where id = p_conteo_id;
end;
$function$;
grant execute on function sgc.conteo_fisico_deshacer(uuid) to authenticated, service_role;

-- ── Lector para la hoja (cabecera + items con nombre de artículo) ────────────
create or replace function sgc.conteo_fisico_detalle(p_conteo_id uuid)
returns jsonb language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
    'id', c.id, 'bodega_id', c.bodega_id, 'estado', c.estado, 'ciego', c.ciego,
    'fecha_conteo', c.fecha_conteo, 'motivo', c.motivo,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'articulo_id', ci.articulo_id, 'nombre', a.nombre, 'codigo', a.codigo,
        'cantidad_antes', ci.cantidad_antes, 'cantidad_contada', ci.cantidad_contada)
        order by a.nombre)
      from sgc.conteo_items ci join sgc.articulos a on a.id = ci.articulo_id
      where ci.conteo_id = c.id), '[]'::jsonb))
  from sgc.conteos_inventario c
  where c.id = p_conteo_id and sgc.puede_operar_conteo();
$function$;
grant execute on function sgc.conteo_fisico_detalle(uuid) to authenticated, service_role;

commit;
