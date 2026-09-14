-- ============================================================================
-- PROMPT-48 (BP) FASE 7 — BO9: medidas reales de moldes (estructurado + esquema).
-- Ronda 14/09/2026.  Aditivo, idempotente.  RLS desde el nacimiento (BC7).
--
-- El ingeniero captura tramos en cm; el sistema dibuja el esquema (componente SVG
-- molde-esquema). Si oficina cargó la medida de plano, se compara y se calcula la
-- desviación máxima; si supera `molde_tolerancia_cm`, se avisa a los responsables.
--
-- ⚠️ ORDEN: aplicar DESPUÉS de `2026-09-14-bp4-bitacora-danos.sql` (esta migración
-- RE-CREA guardar_bitacora_extra con danos + moldes — es la versión autoritativa).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bo9-bitacora-molde-medidas.sql
-- ============================================================================
begin;

create table if not exists sgc.bitacora_molde_medidas (
  id                uuid primary key default gen_random_uuid(),
  bitacora_id       uuid not null references sgc.bitacoras(id) on delete cascade,
  estructura        text,                    -- COLUMNA, VIGA, MURO… (catálogo bitácora)
  identificador     text,                    -- "C-12", "Muro eje 3"
  orden             smallint,
  forma             text not null default 'rectangular'
                      check (forma in ('rectangular','L','T','U','circular','libre')),
  tramos            jsonb not null default '[]'::jsonb,   -- [{lado,largo_cm,alto_cm,espesor_cm}]  (cm enteros)
  medida_plano      jsonb,                                -- misma forma o null
  desviacion_max_cm numeric,                              -- calculada en el RPC
  notas             text,
  fotos_paths       text[] not null default '{}',
  es_prueba         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists ix_bitacora_moldes_bitacora on sgc.bitacora_molde_medidas (bitacora_id);

-- es_prueba heredado del parte (reutiliza el trigger genérico de bitacora_danos).
drop trigger if exists trg_bitacora_moldes_hereda_prueba on sgc.bitacora_molde_medidas;
create trigger trg_bitacora_moldes_hereda_prueba
  before insert on sgc.bitacora_molde_medidas
  for each row execute function sgc.tg_bitacora_danos_hereda_prueba();

alter table sgc.bitacora_molde_medidas enable row level security;
drop policy if exists "bitacora_moldes: select" on sgc.bitacora_molde_medidas;
create policy "bitacora_moldes: select" on sgc.bitacora_molde_medidas for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id) and (not es_prueba or sgc.is_admin()));
grant select on sgc.bitacora_molde_medidas to authenticated;

-- Parámetro de tolerancia (default 2 cm).
insert into sgc.parametros (clave, valor)
  values ('molde_tolerancia_cm', '2')
  on conflict (clave) do nothing;

-- ── guardar_bitacora_extra: danos (BP4) + moldes (BO9). Versión autoritativa. ──
create or replace function sgc.guardar_bitacora_extra(p_bitacora_id uuid, p_extra jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_proyecto uuid;
  v_prueba   boolean;
  v_danos    jsonb := coalesce(p_extra->'danos', '[]'::jsonb);
  v_moldes   jsonb := coalesce(p_extra->'moldes', '[]'::jsonb);
  v_d        jsonb;
  v_idx      int := 0;
  v_tipo text; v_articulo uuid; v_nombre text; v_cant numeric; v_unidad text;
  v_ucap text; v_factor numeric; v_detalle text; v_solicita boolean;
  v_fotos    text[];
  v_retiro   uuid; v_client uuid;
  v_creados  int := 0; v_retiros int := 0; v_moldes_n int := 0;
  v_m jsonb; v_tramos jsonb; v_plano jsonb; v_desv numeric; v_tol numeric;
  v_obra text; v_avisados int := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select proyecto_id, es_prueba into v_proyecto, v_prueba
    from sgc.bitacoras where id = p_bitacora_id;
  if v_proyecto is null then
    raise exception using errcode='22023', message='Bitácora no encontrada.',
      detail='{"campo":"bitacora_id","motivo":"no_existe"}';
  end if;

  if not (sgc.is_admin() or sgc.tiene_modulo('bitacora')
          or exists (select 1 from sgc.bitacoras b where b.id = p_bitacora_id and b.usuario_id = v_uid)) then
    raise exception 'No autorizado para editar esta bitácora';
  end if;

  -- ── DAÑOS (BP4) ────────────────────────────────────────────────────────────
  delete from sgc.bitacora_danos where bitacora_id = p_bitacora_id;
  for v_d in select * from jsonb_array_elements(v_danos) loop
    v_tipo := v_d->>'tipo';
    if v_tipo not in ('material','equipo_propio') then continue; end if;
    v_articulo := nullif(v_d->>'articulo_id','')::uuid;
    v_nombre   := nullif(trim(v_d->>'nombre_libre'),'');
    v_cant     := nullif(v_d->>'cantidad','')::numeric;
    v_unidad   := nullif(trim(v_d->>'unidad'),'');
    v_ucap     := nullif(trim(v_d->>'unidad_capturada'),'');
    v_factor   := nullif(v_d->>'factor_aplicado','')::numeric;
    v_detalle  := nullif(trim(v_d->>'detalle'),'');
    v_solicita := coalesce((v_d->>'solicita_retiro')::boolean, false);
    select coalesce(array_agg(x), '{}') into v_fotos
      from jsonb_array_elements_text(coalesce(v_d->'fotos_paths','[]'::jsonb)) x;

    if v_detalle is null then
      raise exception using errcode='22023', message='Describe el daño.',
        detail='{"campo":"detalle","motivo":"requerido"}';
    end if;
    if v_tipo = 'material' and (v_articulo is null and v_nombre is null) then
      raise exception using errcode='22023', message='Indica qué material se dañó.',
        detail='{"campo":"material","motivo":"requerido"}';
    end if;
    if v_tipo = 'equipo_propio' and v_nombre is null then
      raise exception using errcode='22023', message='Indica qué equipo propio se dañó.',
        detail='{"campo":"equipo","motivo":"requerido"}';
    end if;
    if v_tipo = 'equipo_propio' then v_solicita := false; end if;

    v_retiro := null; v_client := null;
    if v_tipo = 'material' and v_solicita then
      if array_length(v_fotos,1) is null then
        raise exception using errcode='22023',
          message='Para solicitar el retiro del material dañado, agrega al menos una foto.',
          detail='{"campo":"fotos","motivo":"requerido_para_retiro"}';
      end if;
      v_client := md5(p_bitacora_id::text || ':' || v_idx)::uuid;
      v_retiro := sgc.crear_retiro_material(
        v_proyecto, null, 'danado_obra', null,
        'Reportado desde la bitácora del ' || to_char((current_date), 'YYYY-MM-DD'),
        jsonb_build_array(jsonb_build_object(
          'articulo_id', v_articulo,
          'descripcion', coalesce(v_nombre, (select nombre from sgc.articulos where id = v_articulo), 'Material'),
          'cantidad', coalesce(v_cant, 1),
          'unidad', v_unidad)),
        (select jsonb_agg(jsonb_build_object('path', p)) from unnest(v_fotos) p),
        coalesce(v_prueba,false), v_client);
      v_retiros := v_retiros + 1;
    end if;

    insert into sgc.bitacora_danos
      (bitacora_id, tipo, articulo_id, nombre_libre, cantidad, unidad, unidad_capturada,
       factor_aplicado, detalle, fotos_paths, solicita_retiro, retiro_id)
    values
      (p_bitacora_id, v_tipo, v_articulo, v_nombre, v_cant, v_unidad, v_ucap,
       v_factor, v_detalle, v_fotos, v_solicita, v_retiro);
    v_creados := v_creados + 1;

    if v_tipo = 'equipo_propio' then
      begin
        perform sgc.notificar_modulo('inventario', 'equipo_danado',
          'Equipo propio dañado en obra',
          coalesce(v_nombre,'Equipo') || ' — ' ||
            coalesce((select nombre from sgc.proyectos where id = v_proyecto), 'obra'),
          '/bitacora/historial?item=' || p_bitacora_id::text);
      exception when others then null; end;
    end if;
    v_idx := v_idx + 1;
  end loop;

  -- ── MOLDES (BO9) ───────────────────────────────────────────────────────────
  select coalesce(nullif(valor,'')::numeric, 2) into v_tol from sgc.parametros where clave = 'molde_tolerancia_cm';
  v_tol := coalesce(v_tol, 2);
  select nombre into v_obra from sgc.proyectos where id = v_proyecto;

  delete from sgc.bitacora_molde_medidas where bitacora_id = p_bitacora_id;
  v_idx := 0;
  for v_m in select * from jsonb_array_elements(v_moldes) loop
    v_tramos := coalesce(v_m->'tramos', '[]'::jsonb);
    v_plano  := v_m->'medida_plano';
    if jsonb_typeof(v_plano) is distinct from 'array' then v_plano := null; end if;

    -- Desviación máxima real↔plano por dimensión (tramos emparejados por posición).
    v_desv := null;
    if v_plano is not null then
      select max(greatest(
        abs(coalesce((t.val->>'largo_cm')::numeric,0)   - coalesce((p.val->>'largo_cm')::numeric,0)),
        abs(coalesce((t.val->>'alto_cm')::numeric,0)    - coalesce((p.val->>'alto_cm')::numeric,0)),
        abs(coalesce((t.val->>'espesor_cm')::numeric,0) - coalesce((p.val->>'espesor_cm')::numeric,0))
      ))
      into v_desv
      from jsonb_array_elements(v_tramos) with ordinality t(val, i)
      left join jsonb_array_elements(v_plano) with ordinality p(val, j) on t.i = p.j;
    end if;

    select coalesce(array_agg(x), '{}') into v_fotos
      from jsonb_array_elements_text(coalesce(v_m->'fotos_paths','[]'::jsonb)) x;

    insert into sgc.bitacora_molde_medidas
      (bitacora_id, estructura, identificador, orden, forma, tramos, medida_plano,
       desviacion_max_cm, notas, fotos_paths)
    values
      (p_bitacora_id, nullif(trim(v_m->>'estructura'),''), nullif(trim(v_m->>'identificador'),''),
       v_idx, coalesce(nullif(v_m->>'forma',''),'rectangular'), v_tramos, v_plano,
       v_desv, nullif(trim(v_m->>'notas'),''), v_fotos);
    v_moldes_n := v_moldes_n + 1;

    if v_desv is not null and v_desv > v_tol then
      begin
        perform sgc.notificar_modulo('bitacora', 'molde_desviacion',
          'Molde fuera de tolerancia',
          coalesce(nullif(trim(v_m->>'identificador'),''),'Molde') || ': desvío ' || v_desv ||
            ' cm (> ' || v_tol || ') — ' || coalesce(v_obra,'obra'),
          '/bitacora/historial?item=' || p_bitacora_id::text);
        v_avisados := v_avisados + 1;
      exception when others then null; end;
    end if;
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('danos', v_creados, 'retiros', v_retiros,
                            'moldes', v_moldes_n, 'moldes_fuera_tolerancia', v_avisados);
end;
$function$;

grant execute on function sgc.guardar_bitacora_extra(uuid, jsonb) to authenticated;

commit;
