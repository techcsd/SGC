-- BO10 — Cartillas de acero: RPCs (SECURITY DEFINER) + bucket. Sigue al schema.

begin;

-- 1) crear_cartilla — idempotente por p_id (molde BG4/BL9), valida catálogo, pesa,
--    estado 'enviada', notifica a oficina.
create or replace function sgc.crear_cartilla(
  p_id uuid, p_proyecto_id uuid, p_fecha date, p_atados jsonb,
  p_fotos jsonb DEFAULT '[]'::jsonb, p_plano_path text DEFAULT NULL, p_notas text DEFAULT NULL)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
declare
  v_uid uuid := auth.uid();
  v_atado jsonb; v_pieza jsonb; v_foto jsonb;
  v_atado_id uuid; v_kg numeric; v_kg_m numeric; v_long numeric; v_cant int;
  v_diam text; v_fig text; v_tramo jsonb; v_orden_a int := 0; v_orden_p int; v_orden_f int := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('bitacora') or sgc.es_responsable_de_proyecto(p_proyecto_id, v_uid)) then
    raise exception 'No autorizado para crear cartillas en esta obra' using errcode = '42501';
  end if;

  -- Idempotencia por client-UUID.
  if exists (select 1 from sgc.cartillas where id = p_id) then
    return p_id;
  end if;

  insert into sgc.cartillas (id, proyecto_id, ingeniero_id, fecha, plano_path, notas, estado)
  values (p_id, p_proyecto_id, v_uid, coalesce(p_fecha, current_date), nullif(p_plano_path,''), nullif(p_notas,''), 'enviada');

  for v_atado in select * from jsonb_array_elements(coalesce(p_atados, '[]'::jsonb)) loop
    v_orden_a := v_orden_a + 1;
    insert into sgc.cartilla_atados (cartilla_id, identificador, elemento, cantidad_piezas, orden)
    values (p_id, nullif(v_atado->>'identificador',''), nullif(v_atado->>'elemento',''),
            nullif(v_atado->>'cantidad_piezas','')::int, v_orden_a)
    returning id into v_atado_id;

    v_orden_p := 0;
    for v_pieza in select * from jsonb_array_elements(coalesce(v_atado->'piezas', '[]'::jsonb)) loop
      v_orden_p := v_orden_p + 1;
      v_diam := nullif(v_pieza->>'diametro_codigo','');
      v_fig := nullif(v_pieza->>'figura_codigo','');
      v_cant := coalesce(nullif(v_pieza->>'cantidad','')::int, 1);

      if v_diam is null or not exists (select 1 from sgc.acero_diametros where codigo = v_diam and activo) then
        raise exception 'Diámetro inválido: %', coalesce(v_diam,'(vacío)') using errcode = '22023', detail = 'campo=diametro_codigo';
      end if;
      if v_fig is null or not exists (select 1 from sgc.cartilla_figuras where codigo = v_fig and activo) then
        raise exception 'Figura inválida: %', coalesce(v_fig,'(vacío)') using errcode = '22023', detail = 'campo=figura_codigo';
      end if;

      -- longitud total: suma de tramos si vienen, si no la longitud dada.
      v_long := nullif(v_pieza->>'longitud_total_cm','')::numeric;
      if v_pieza ? 'tramos_cm' and jsonb_typeof(v_pieza->'tramos_cm') = 'array' then
        select coalesce(sum((t->>'cm')::numeric), 0) into v_long
          from jsonb_array_elements(v_pieza->'tramos_cm') t;
      end if;
      v_long := coalesce(v_long, 0);
      select kg_por_m into v_kg_m from sgc.acero_diametros where codigo = v_diam;
      v_kg := round((v_long / 100.0) * coalesce(v_kg_m, 0) * v_cant, 3);

      insert into sgc.cartilla_piezas (atado_id, marca, diametro_codigo, figura_codigo, tramos_cm, longitud_total_cm, cantidad, peso_kg, orden)
      values (v_atado_id, nullif(v_pieza->>'marca',''), v_diam, v_fig,
              case when v_pieza ? 'tramos_cm' then v_pieza->'tramos_cm' else null end,
              v_long, v_cant, v_kg, v_orden_p);
    end loop;
  end loop;

  for v_foto in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
    v_orden_f := v_orden_f + 1;
    insert into sgc.cartilla_fotos (cartilla_id, path, orden)
    values (p_id, coalesce(v_foto->>'path', v_foto#>>'{}'), v_orden_f);
  end loop;

  insert into sgc.cartilla_eventos (cartilla_id, estado_desde, estado_hasta, usuario_id, nota)
  values (p_id, null, 'enviada', v_uid, 'Cartilla enviada');

  perform sgc.notificar_modulo('bitacora', 'cartilla_nueva',
    'Nueva cartilla de acero',
    format('Se envió una cartilla para revisión (obra %s).',
      coalesce((select nombre from sgc.proyectos where id = p_proyecto_id), 'sin nombre')),
    '/bitacora/cartillas/' || p_id::text, p_id, 'cartilla');

  return p_id;
end $function$;
grant execute on function sgc.crear_cartilla(uuid, uuid, date, jsonb, jsonb, text, text) to authenticated;

-- 2) cartilla_cambiar_estado — transiciones gateadas + historial + aviso al autor.
create or replace function sgc.cartilla_cambiar_estado(p_id uuid, p_estado text, p_nota text DEFAULT NULL)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
declare
  v_uid uuid := auth.uid();
  c sgc.cartillas%rowtype;
  v_es_autor boolean; v_es_oficina boolean; v_ok boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into c from sgc.cartillas where id = p_id;
  if c.id is null then raise exception 'Cartilla no encontrada'; end if;

  v_es_autor := (c.ingeniero_id = v_uid) or sgc.is_admin();
  v_es_oficina := sgc.is_admin() or sgc.tiene_modulo('bitacora') or sgc.es_responsable_de_proyecto(c.proyecto_id, v_uid);

  -- Transiciones permitidas (nadie salta estados).
  if p_estado = 'revisada' and c.estado in ('enviada','observada') and v_es_oficina then v_ok := true;
  elsif p_estado = 'observada' and c.estado in ('enviada','revisada') and v_es_oficina then v_ok := true;
  elsif p_estado = 'enviada' and c.estado = 'observada' and v_es_autor then v_ok := true; -- reenviar corregida
  elsif p_estado = 'ejecutada' and c.estado = 'revisada' and v_es_autor then v_ok := true;
  end if;
  if not v_ok then
    raise exception 'Transición no permitida (% → %) para tu rol', c.estado, p_estado using errcode = 'DR451';
  end if;
  if p_estado = 'observada' and nullif(btrim(coalesce(p_nota,'')),'') is null then
    raise exception 'La observación es obligatoria' using errcode = '22023';
  end if;

  update sgc.cartillas
     set estado = p_estado,
         observacion = case when p_estado = 'observada' then btrim(p_nota) else observacion end
   where id = p_id;

  insert into sgc.cartilla_eventos (cartilla_id, estado_desde, estado_hasta, usuario_id, nota)
  values (p_id, c.estado, p_estado, v_uid, nullif(btrim(p_nota),''));

  -- Aviso al autor cuando la oficina revisa/observa.
  if p_estado in ('revisada','observada') and c.ingeniero_id <> v_uid then
    perform sgc.notificar_usuarios(array[c.ingeniero_id], 'cartilla_nueva',
      case when p_estado = 'observada' then 'Cartilla observada' else 'Cartilla revisada' end,
      format('%s: %s%s', coalesce(c.folio,'Cartilla'),
        case when p_estado = 'observada' then 'requiere corrección. ' else 'aprobada para ejecutar. ' end,
        coalesce(btrim(p_nota),'')),
      '/bitacora/cartillas/' || p_id::text, p_id, 'cartilla');
  end if;
end $function$;
grant execute on function sgc.cartilla_cambiar_estado(uuid, text, text) to authenticated;

-- 3) cartilla_detalle — jsonb con atados/piezas/fotos/eventos (guard de visibilidad).
create or replace function sgc.cartilla_detalle(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
declare c sgc.cartillas%rowtype; v jsonb;
begin
  select * into c from sgc.cartillas where id = p_id;
  if c.id is null then raise exception 'Cartilla no encontrada'; end if;
  if not sgc.puede_ver_cartilla(c.proyecto_id, c.ingeniero_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', c.id, 'folio', c.folio, 'proyecto_id', c.proyecto_id,
    'proyecto', (select nombre from sgc.proyectos where id = c.proyecto_id),
    'ingeniero_id', c.ingeniero_id,
    'ingeniero', (select nombre from sgc.usuarios where id = c.ingeniero_id),
    'fecha', c.fecha, 'estado', c.estado, 'observacion', c.observacion, 'notas', c.notas,
    'plano_path', c.plano_path, 'es_prueba', c.es_prueba, 'created_at', c.created_at,
    'peso_total_kg', (select coalesce(sum(pz.peso_kg),0) from sgc.cartilla_piezas pz
                       join sgc.cartilla_atados a on a.id = pz.atado_id where a.cartilla_id = c.id),
    'atados', (select coalesce(jsonb_agg(ata order by ata.orden), '[]'::jsonb) from (
        select a.id, a.identificador, a.elemento, a.cantidad_piezas, a.orden,
          (select coalesce(jsonb_agg(jsonb_build_object(
             'id', pz.id, 'marca', pz.marca, 'diametro_codigo', pz.diametro_codigo,
             'figura_codigo', pz.figura_codigo, 'tramos_cm', pz.tramos_cm,
             'longitud_total_cm', pz.longitud_total_cm, 'cantidad', pz.cantidad, 'peso_kg', pz.peso_kg
           ) order by pz.orden), '[]'::jsonb) from sgc.cartilla_piezas pz where pz.atado_id = a.id) as piezas
        from sgc.cartilla_atados a where a.cartilla_id = c.id order by a.orden) ata),
    'fotos', (select coalesce(jsonb_agg(f.path order by f.orden), '[]'::jsonb) from sgc.cartilla_fotos f where f.cartilla_id = c.id),
    'eventos', (select coalesce(jsonb_agg(jsonb_build_object(
        'estado_desde', e.estado_desde, 'estado_hasta', e.estado_hasta,
        'usuario', (select nombre from sgc.usuarios where id = e.usuario_id),
        'nota', e.nota, 'created_at', e.created_at) order by e.created_at), '[]'::jsonb)
      from sgc.cartilla_eventos e where e.cartilla_id = c.id)
  ) into v;
  return v;
end $function$;
grant execute on function sgc.cartilla_detalle(uuid) to authenticated;

-- 4) cartillas_listado — filtros + kg total por cartilla (guard de visibilidad).
create or replace function sgc.cartillas_listado(
  p_proyecto_id uuid DEFAULT NULL, p_ingeniero_id uuid DEFAULT NULL,
  p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL, p_estado text DEFAULT NULL)
returns table(id uuid, folio text, proyecto_id uuid, proyecto text, ingeniero text,
  fecha date, estado text, es_prueba boolean, peso_total_kg numeric, created_at timestamptz)
language sql stable security definer set search_path to 'sgc','pg_temp' as $function$
  select c.id, c.folio, c.proyecto_id, p.nombre, u.nombre, c.fecha, c.estado, c.es_prueba,
    coalesce((select sum(pz.peso_kg) from sgc.cartilla_piezas pz join sgc.cartilla_atados a on a.id = pz.atado_id where a.cartilla_id = c.id), 0),
    c.created_at
  from sgc.cartillas c
  left join sgc.proyectos p on p.id = c.proyecto_id
  left join sgc.usuarios u on u.id = c.ingeniero_id
  where sgc.puede_ver_cartilla(c.proyecto_id, c.ingeniero_id)
    and (not coalesce(c.es_prueba,false) or sgc.is_admin())
    and (p_proyecto_id is null or c.proyecto_id = p_proyecto_id)
    and (p_ingeniero_id is null or c.ingeniero_id = p_ingeniero_id)
    and (p_desde is null or c.fecha >= p_desde)
    and (p_hasta is null or c.fecha <= p_hasta)
    and (p_estado is null or c.estado = p_estado)
  order by c.fecha desc, c.created_at desc;
$function$;
grant execute on function sgc.cartillas_listado(uuid, uuid, date, date, text) to authenticated;

-- 5) cartillas_resumen_acero — kg por diámetro (reporte "Acero por obra").
create or replace function sgc.cartillas_resumen_acero(
  p_proyecto_id uuid DEFAULT NULL, p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL)
returns table(diametro_codigo text, piezas bigint, peso_kg numeric)
language sql stable security definer set search_path to 'sgc','pg_temp' as $function$
  select pz.diametro_codigo, count(*)::bigint, round(sum(pz.peso_kg), 2)
  from sgc.cartilla_piezas pz
  join sgc.cartilla_atados a on a.id = pz.atado_id
  join sgc.cartillas c on c.id = a.cartilla_id
  where sgc.puede_ver_cartilla(c.proyecto_id, c.ingeniero_id)
    and (not coalesce(c.es_prueba,false) or sgc.is_admin())
    and (p_proyecto_id is null or c.proyecto_id = p_proyecto_id)
    and (p_desde is null or c.fecha >= p_desde)
    and (p_hasta is null or c.fecha <= p_hasta)
  group by pz.diametro_codigo
  order by pz.diametro_codigo;
$function$;
grant execute on function sgc.cartillas_resumen_acero(uuid, date, date) to authenticated;

commit;

-- 6) Bucket sgc-cartillas (INSERT + UPDATE, regla 5). Fuera de la tx (storage).
insert into storage.buckets (id, name, public, file_size_limit)
values ('sgc-cartillas', 'sgc-cartillas', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "sgc-cartillas: authenticated read" on storage.objects;
create policy "sgc-cartillas: authenticated read" on storage.objects for select to authenticated
  using (bucket_id = 'sgc-cartillas');
drop policy if exists "sgc-cartillas: authenticated upload" on storage.objects;
create policy "sgc-cartillas: authenticated upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-cartillas');
drop policy if exists "sgc-cartillas: authenticated update" on storage.objects;
create policy "sgc-cartillas: authenticated update" on storage.objects for update to authenticated
  using (bucket_id = 'sgc-cartillas');
