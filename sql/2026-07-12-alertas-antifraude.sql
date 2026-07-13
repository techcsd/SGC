-- ============================================================================
-- A4 — Motor de alertas antifraude (SILENCIOSAS) — reunión 07/07/2026
-- ----------------------------------------------------------------------------
-- Compara consumo real vs estimado por fase del cuadre y genera alertas hacia
-- Dirección/Gerencia/Admin. NUNCA se muestran al ingeniero ni bloquean la obra.
-- Umbrales configurables (Administración). Default: 80% advertencia, 100% alerta.
-- ============================================================================
set search_path = sgc, public;

-- 1) Parámetros de configuración (clave/valor) ------------------------------
create table if not exists sgc.parametros (
  clave       text primary key,
  valor       text not null,
  descripcion text,
  updated_at  timestamptz not null default now()
);

insert into sgc.parametros (clave, valor, descripcion) values
  ('alerta_cuadre_umbral_alerta', '100', 'A4: % de consumo vs estimado de la fase que dispara ALERTA.'),
  ('alerta_cuadre_umbral_advertencia', '80', 'A4: % que dispara ADVERTENCIA temprana.')
on conflict (clave) do nothing;

alter table sgc.parametros enable row level security;
drop policy if exists parametros_sel on sgc.parametros;
create policy parametros_sel on sgc.parametros for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('direccion'));
drop policy if exists parametros_write on sgc.parametros;
create policy parametros_write on sgc.parametros for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());
grant select, insert, update on sgc.parametros to authenticated;
grant all on sgc.parametros to service_role;

-- 2) Alertas de control de materiales ---------------------------------------
create table if not exists sgc.alertas_cuadre (
  id            uuid primary key default gen_random_uuid(),
  proyecto_id   uuid not null references sgc.proyectos(id) on delete cascade,
  articulo_id   uuid references sgc.articulos(id),
  fase          int,
  tipo          text not null,   -- 'requisicion_excede' | 'acumulado_excede' | 'chequeo_diferencia'
  severidad     text not null default 'advertencia', -- 'advertencia' | 'alerta'
  estimado      numeric,
  consumido     numeric,
  desviacion_pct numeric,
  requisicion_id uuid,
  mensaje       text,
  estado        text not null default 'nueva',  -- 'nueva' | 'en_revision' | 'resuelta'
  nota          text,
  atendido_por  uuid references sgc.usuarios(id),
  atendido_en   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint alertas_cuadre_sev_chk check (severidad in ('advertencia','alerta')),
  constraint alertas_cuadre_estado_chk check (estado in ('nueva','en_revision','resuelta'))
);
create index if not exists idx_alertas_cuadre_open on sgc.alertas_cuadre(estado) where estado <> 'resuelta';
create index if not exists idx_alertas_cuadre_key on sgc.alertas_cuadre(proyecto_id, articulo_id, fase);

alter table sgc.alertas_cuadre enable row level security;
-- Visibles SOLO para Dirección/Gerencia (vía módulo direccion) y Admin.
drop policy if exists alertas_cuadre_sel on sgc.alertas_cuadre;
create policy alertas_cuadre_sel on sgc.alertas_cuadre for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('direccion'));
drop policy if exists alertas_cuadre_upd on sgc.alertas_cuadre;
create policy alertas_cuadre_upd on sgc.alertas_cuadre for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('direccion'))
  with check (sgc.is_admin() or sgc.tiene_modulo('direccion'));
grant select, update on sgc.alertas_cuadre to authenticated;
grant all on sgc.alertas_cuadre to service_role;

-- 3) Evaluación de alerta (llamada desde aprobar_requisicion) ----------------
create or replace function sgc.evaluar_alerta_cuadre(
  p_proyecto_id uuid,
  p_articulo_id uuid,
  p_fase int,
  p_cantidad numeric,
  p_requisicion_id uuid
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_estimado   numeric;
  v_consumido  numeric;
  v_pct        numeric;
  v_umbral_a   numeric;
  v_umbral_w   numeric;
  v_sev        text;
  v_tipo       text;
  v_msg        text;
  v_nombre     text;
  v_open_id    uuid;
begin
  -- Estimado acumulado hasta la fase activa (por artículo).
  select coalesce(sum(
           case p_fase when 1 then est_f1
                       when 2 then est_f1 + est_f2
                       when 3 then est_f1 + est_f2 + est_f3
                       else est_f1 + est_f2 + est_f3 + est_f4 end), 0)
    into v_estimado
    from sgc.cuadre_items
   where proyecto_id = p_proyecto_id and articulo_id = p_articulo_id;

  -- Consumido acumulado hasta la fase activa (incluye el recién insertado).
  select coalesce(sum(cantidad), 0) into v_consumido
    from sgc.cuadre_consumo
   where proyecto_id = p_proyecto_id and articulo_id = p_articulo_id and fase <= p_fase;

  select coalesce(max(valor)::numeric, 100) into v_umbral_a from sgc.parametros where clave = 'alerta_cuadre_umbral_alerta';
  select coalesce(max(valor)::numeric, 80)  into v_umbral_w from sgc.parametros where clave = 'alerta_cuadre_umbral_advertencia';

  if v_estimado <= 0 then
    -- Material no presupuestado para esta fase → alerta directa.
    if v_consumido <= 0 then return; end if;
    v_sev := 'alerta'; v_pct := null; v_tipo := 'acumulado_excede';
  else
    v_pct := round(v_consumido / v_estimado * 100, 1);
    if v_pct >= v_umbral_a then v_sev := 'alerta';
    elsif v_pct >= v_umbral_w then v_sev := 'advertencia';
    else return;  -- dentro de lo estimado: sin alerta
    end if;
    v_tipo := 'acumulado_excede';
  end if;

  select nombre into v_nombre from sgc.articulos where id = p_articulo_id;
  v_msg := format('%s: consumo acumulado %s vs estimado %s en fase %s%s.',
                  coalesce(v_nombre, 'Artículo'), v_consumido, v_estimado, p_fase,
                  case when v_pct is not null then ' (' || v_pct || '%)' else ' (no presupuestado)' end);

  -- Una alerta viva por (proyecto, artículo, fase): si existe abierta, actualiza; si no, inserta.
  select id into v_open_id
    from sgc.alertas_cuadre
   where proyecto_id = p_proyecto_id and articulo_id = p_articulo_id and fase = p_fase and estado <> 'resuelta'
   limit 1;

  if v_open_id is not null then
    update sgc.alertas_cuadre
       set severidad = v_sev, estimado = v_estimado, consumido = v_consumido,
           desviacion_pct = v_pct, requisicion_id = p_requisicion_id, tipo = v_tipo,
           mensaje = v_msg, updated_at = now()
     where id = v_open_id;
  else
    insert into sgc.alertas_cuadre
      (proyecto_id, articulo_id, fase, tipo, severidad, estimado, consumido, desviacion_pct, requisicion_id, mensaje)
    values
      (p_proyecto_id, p_articulo_id, p_fase, v_tipo, v_sev, v_estimado, v_consumido, v_pct, p_requisicion_id, v_msg);
  end if;
end;
$$;
grant execute on function sgc.evaluar_alerta_cuadre(uuid, uuid, int, numeric, uuid) to authenticated, service_role;

-- 4) Atender una alerta (Dirección/Gerencia/Admin) ---------------------------
create or replace function sgc.atender_alerta_cuadre(p_id uuid, p_estado text, p_nota text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('direccion')) then
    raise exception 'No autorizado';
  end if;
  if p_estado not in ('nueva','en_revision','resuelta') then
    raise exception 'Estado inválido';
  end if;
  update sgc.alertas_cuadre
     set estado = p_estado, nota = coalesce(p_nota, nota),
         atendido_por = auth.uid(), atendido_en = now(), updated_at = now()
   where id = p_id;
end;
$$;
grant execute on function sgc.atender_alerta_cuadre(uuid, text, text) to authenticated, service_role;

-- 5) Realtime + audiencia -----------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table sgc.alertas_cuadre;
exception when duplicate_object then null; end $$;

-- Gerencia también recibe las alertas (decisión: Dirección + Gerencia + Admin).
update sgc.roles
   set modulos = array_append(modulos, 'direccion')
 where nombre = 'Gerencia' and not ('direccion' = any(modulos));
