-- ============================================================================
-- PROMPT-48 (BP) FASE 4 — BP4: "¿Se dañó algo hoy?" en el parte diario.
-- Ronda 14/09/2026.  Aditivo, idempotente.  RLS desde el nacimiento (BC7).
--
-- HOY la bitácora solo registra daño de equipo ALQUILADO (bitacora_equipos_alquilados).
-- Esto añade daño de MATERIAL (molde, viga…) y EQUIPO PROPIO (CSD) al parte, y —si es
-- material— lo conecta con el flujo de Retiros (BG4) para que se VEA (AT11).
--
-- DECISIONES DE DISEÑO (desvían del prompt por la realidad de prod — hard rule 7):
--   1) `sgc.equipo_obra` (AZ9) NO existe en prod → "equipo propio" se captura por texto
--      libre (no hay catálogo que enlazar; no hay `operativo` que apagar).
--   2) En vez de meter `p_extra` en los DOS RPCs gigantes de bitácora (crear_entrada_bitacora
--      143 líneas / crear_bitacora_app con 2 overloads en uso PRODUCTIVO — riesgo de
--      ambigüedad de overload, gotcha AY6), se usa UN escritor hijo dedicado
--      `guardar_bitacora_extra(p_bitacora_id, p_extra jsonb)` que web y app llaman como
--      paso 2. Mismo contrato p_extra {danos, moldes} que eligió Xaviel (§F-3), cero
--      riesgo para el envío de bitácoras en prod, y paridad web↔app trivial.
--      `moldes` (BO9) se procesará aquí también, en su propia migración.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp4-bitacora-danos.sql
-- ============================================================================
begin;

create table if not exists sgc.bitacora_danos (
  id               uuid primary key default gen_random_uuid(),
  bitacora_id      uuid not null references sgc.bitacoras(id) on delete cascade,
  tipo             text not null check (tipo in ('material','equipo_propio')),
  articulo_id      uuid references sgc.articulos(id),
  nombre_libre     text,                          -- material no catalogado o equipo propio
  cantidad         numeric,                        -- en unidad BASE (disciplina BM5)
  unidad           text,
  unidad_capturada text,                           -- lo que tecleó el usuario (atado/unidad)
  factor_aplicado  numeric,
  detalle          text not null,
  fotos_paths      text[] not null default '{}',
  solicita_retiro  boolean not null default false, -- solo material
  retiro_id        uuid references sgc.retiros_material(id),
  es_prueba        boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint bitacora_danos_ident_ck check (
    (tipo = 'material'      and (articulo_id is not null or nombre_libre is not null))
    or (tipo = 'equipo_propio' and nombre_libre is not null)
  )
);

create index if not exists ix_bitacora_danos_bitacora on sgc.bitacora_danos (bitacora_id);
create index if not exists ix_bitacora_danos_retiro   on sgc.bitacora_danos (retiro_id) where retiro_id is not null;

-- es_prueba heredado del parte por trigger (patrón ar1): ningún dano queda "real"
-- si su bitácora es de prueba, pase lo que pase por el RPC.
create or replace function sgc.tg_bitacora_danos_hereda_prueba()
 returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
begin
  select es_prueba into new.es_prueba from sgc.bitacoras where id = new.bitacora_id;
  new.es_prueba := coalesce(new.es_prueba, false);
  return new;
end;
$fn$;
drop trigger if exists trg_bitacora_danos_hereda_prueba on sgc.bitacora_danos;
create trigger trg_bitacora_danos_hereda_prueba
  before insert on sgc.bitacora_danos
  for each row execute function sgc.tg_bitacora_danos_hereda_prueba();

-- RLS (BC7). SELECT = espejo de la bitácora (reutiliza puede_ver_bitacora) + oculta prueba.
-- Escritura SOLO por el RPC SECURITY DEFINER: sin grants de tabla sueltos.
alter table sgc.bitacora_danos enable row level security;
drop policy if exists "bitacora_danos: select" on sgc.bitacora_danos;
create policy "bitacora_danos: select" on sgc.bitacora_danos for select to authenticated
  using (sgc.puede_ver_bitacora(bitacora_id) and (not es_prueba or sgc.is_admin()));
grant select on sgc.bitacora_danos to authenticated;

-- ── Escritor hijo: procesa p_extra->'danos'. Idempotente por bitacora_id. ──────
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
  v_d        jsonb;
  v_idx      int := 0;
  v_tipo text; v_articulo uuid; v_nombre text; v_cant numeric; v_unidad text;
  v_ucap text; v_factor numeric; v_detalle text; v_solicita boolean;
  v_fotos    text[];
  v_retiro   uuid; v_client uuid;
  v_creados  int := 0; v_retiros int := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select proyecto_id, es_prueba into v_proyecto, v_prueba
    from sgc.bitacoras where id = p_bitacora_id;
  if v_proyecto is null then
    raise exception using errcode='22023', message='Bitácora no encontrada.',
      detail='{"campo":"bitacora_id","motivo":"no_existe"}';
  end if;

  -- Gate: autor de la bitácora, admin, o módulo bitácora.
  if not (sgc.is_admin() or sgc.tiene_modulo('bitacora')
          or exists (select 1 from sgc.bitacoras b where b.id = p_bitacora_id and b.usuario_id = v_uid)) then
    raise exception 'No autorizado para editar esta bitácora';
  end if;

  -- Idempotente: re-emite el set completo. Los retiros se recrean con el mismo
  -- client_id determinista → crear_retiro_material los devuelve sin duplicar (BG4).
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
    if v_tipo = 'equipo_propio' then v_solicita := false; end if;  -- retiro solo aplica a material

    v_retiro := null; v_client := null;
    if v_tipo = 'material' and v_solicita then
      if array_length(v_fotos,1) is null then
        raise exception using errcode='22023',
          message='Para solicitar el retiro del material dañado, agrega al menos una foto.',
          detail='{"campo":"fotos","motivo":"requerido_para_retiro"}';
      end if;
      v_client := md5(p_bitacora_id::text || ':' || v_idx)::uuid;   -- idempotencia (bitacora:idx)
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

  return jsonb_build_object('danos', v_creados, 'retiros', v_retiros);
end;
$function$;

grant execute on function sgc.guardar_bitacora_extra(uuid, jsonb) to authenticated;

commit;
