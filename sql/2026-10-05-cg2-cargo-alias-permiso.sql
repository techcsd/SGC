-- CG2 — Importar personal con el cargo aplicado SIEMPRE + permiso de trabajo con vencimiento.
-- Nota (literal): "lets update the template … because when we actually upload it the cargo
-- doesn't apply automatically." (archivo LISTADO DE PERSONAL ALPHA 25-9-2026.xlsx)
-- -------------------------------------------------------------------------------------
-- Hallazgo: con el catálogo y el código actuales el emparejamiento SÍ resuelve 30/30 (el
-- diccionario vivía solo en el cliente y dependía de códigos fijos). Para que no vuelva a
-- fallar en silencio: el emparejamiento deja de depender de códigos fijos y usa una tabla
-- `cargo_alias` (código + nombre + alias normalizados), editable y que APRENDE lo que el
-- usuario elige a mano. Además: OBSERVACIÓN → permiso_vencimiento + aviso a Legal 30 días antes.

-- ── 1. Columna de vencimiento del permiso de trabajo (aditivo) ──────────────────────
alter table sgc.personal_obra add column if not exists permiso_vencimiento date;
comment on column sgc.personal_obra.permiso_vencimiento is
  'CG2 — vencimiento del permiso de trabajo (extranjeros). De la columna OBSERVACION del listado. Aviso a Legal 30 días antes.';

-- ── 2. Normalizador de texto de cargo (equivalente al norm() del cliente) ───────────
create or replace function sgc.normalizar_cargo_texto(p text)
returns text
language sql immutable
as $function$
  select nullif(
    upper(trim(regexp_replace(
      translate(coalesce(p,''),
                'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
      '\s+', ' ', 'g'))),
  '');
$function$;

-- ── 3. Tabla de alias de cargo ──────────────────────────────────────────────────────
create table if not exists sgc.cargo_alias (
  id                uuid primary key default gen_random_uuid(),
  alias_normalizado text not null unique,
  cargo_id          uuid not null references sgc.cargos(id) on delete cascade,
  creado_por        uuid references sgc.usuarios(id),
  created_at        timestamptz not null default now()
);
create index if not exists cargo_alias_cargo_idx on sgc.cargo_alias (cargo_id);
comment on table sgc.cargo_alias is
  'CG2 — alias de texto (de listados) → cargo del catálogo. Editable en Proyectos › Cargos; el importador aprende lo que el usuario elige a mano.';

-- ── 4. Resolver cargo: alias → código → nombre (todo normalizado) ───────────────────
create or replace function sgc.resolver_cargo(p_texto text)
returns uuid
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  with n as (select sgc.normalizar_cargo_texto(p_texto) as t)
  select cargo_id from sgc.cargo_alias, n where alias_normalizado = n.t
  union all
  select c.id from sgc.cargos c, n where sgc.normalizar_cargo_texto(c.codigo) = n.t and n.t is not null
  union all
  select c.id from sgc.cargos c, n where sgc.normalizar_cargo_texto(c.nombre) = n.t and n.t is not null
  limit 1;
$function$;

-- ── 5. Aprender/editar alias (gestión de personal o admin) ──────────────────────────
create or replace function sgc.registrar_cargo_alias(p_alias text, p_cargo_id uuid)
returns sgc.cargo_alias
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_norm text; v_row sgc.cargo_alias;
begin
  if not (sgc.is_admin() or sgc.puede_gestionar_proyectos() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_norm := sgc.normalizar_cargo_texto(p_alias);
  if v_norm is null then raise exception 'Alias vacío' using errcode = '22023'; end if;
  insert into sgc.cargo_alias (alias_normalizado, cargo_id, creado_por)
  values (v_norm, p_cargo_id, auth.uid())
  on conflict (alias_normalizado) do update set cargo_id = excluded.cargo_id, creado_por = auth.uid()
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function sgc.eliminar_cargo_alias(p_id uuid)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.puede_gestionar_proyectos() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  delete from sgc.cargo_alias where id = p_id;
end;
$function$;

create or replace function sgc.listar_cargo_alias()
returns table (id uuid, alias_normalizado text, cargo_id uuid, cargo_codigo text, cargo_nombre text, created_at timestamptz)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select a.id, a.alias_normalizado, a.cargo_id, c.codigo::text, c.nombre::text, a.created_at
    from sgc.cargo_alias a join sgc.cargos c on c.id = a.cargo_id
   order by c.orden, a.alias_normalizado;
$function$;

-- ── RLS para cargo_alias (lectura autenticada; escritura por RPC definer) ────────────
alter table sgc.cargo_alias enable row level security;
drop policy if exists cargo_alias_select on sgc.cargo_alias;
create policy cargo_alias_select on sgc.cargo_alias for select to authenticated using (true);
grant select on sgc.cargo_alias to authenticated;

-- ── 6. Seed de alias desde el Excel real + el diccionario histórico (AR1) ───────────
insert into sgc.cargo_alias (alias_normalizado, cargo_id)
select sgc.normalizar_cargo_texto(x.alias), c.id
from (values
  ('INGENIERO','ING'), ('MAESTRO','MAE'), ('CAPATAZ','CAP'), ('CAPATAZ CSD','CAP'),
  ('VARILLERO','VAR'), ('FERRALLERO','FERR'), ('CARPINTERO','CARP'), ('ALBANIL','ALB'),
  ('ALBAÑIL','ALB'), ('AYUDANTE','AYU'), ('AYUDANTE CSD','AYU'), ('AYUDANTE DE CARPINTERO','AYU'),
  ('OBRERO','AYU'), ('PLOMERO','PLOM'), ('ELECTRICISTA','ELEC'), ('PINTOR','PINT'),
  ('SOLDADOR','SOLD'), ('VIGILANTE','VIG'), ('OPERADOR','OPER'), ('OPERADOR DE EQUIPO','OPER'),
  ('PERSONAL DE LA CASA','CASA'), ('CASA','CASA')
) as x(alias, codigo)
join sgc.cargos c on c.codigo = x.codigo
on conflict (alias_normalizado) do nothing;

grant execute on function sgc.normalizar_cargo_texto(text) to authenticated;
grant execute on function sgc.resolver_cargo(text) to authenticated;
grant execute on function sgc.registrar_cargo_alias(text, uuid) to authenticated;
grant execute on function sgc.eliminar_cargo_alias(uuid) to authenticated;
grant execute on function sgc.listar_cargo_alias() to authenticated;

-- ── 7. Import RPC: resuelve cargo por alias si falta cargo_id + guarda permiso_vencimiento ──
create or replace function sgc.importar_listado_personal_obra(
  p_proyecto_id uuid, p_rows jsonb, p_lote uuid,
  p_fecha_listado date default null, p_enc_obra text default null,
  p_archivo text default null, p_bajas uuid[] default null
) returns jsonb
language plpgsql security definer set search_path to 'sgc', 'public'
as $function$
declare
  v_row jsonb; v_i int := 0;
  v_creados int := 0; v_actualizados int := 0; v_bajas int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_doc text; v_nombre text; v_existe uuid; v_es_prueba boolean;
  v_cargo uuid; v_permiso date;
begin
  if not sgc.puede_gestionar_personal_obra(p_proyecto_id) then
    raise exception 'No autorizado para gestionar el personal de esta obra' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows debe ser un arreglo' using errcode = 'AT400';
  end if;

  select coalesce(es_prueba, false) into v_es_prueba from sgc.proyectos where id = p_proyecto_id;

  insert into sgc.personal_obra_listados (id, proyecto_id, fecha_listado, enc_obra, archivo_nombre, es_prueba, importado_por)
  values (coalesce(p_lote, gen_random_uuid()), p_proyecto_id, p_fecha_listado, nullif(trim(p_enc_obra),''), nullif(trim(p_archivo),''), coalesce(v_es_prueba,false), auth.uid())
  on conflict (id) do update set fecha_listado = excluded.fecha_listado, enc_obra = excluded.enc_obra, archivo_nombre = excluded.archivo_nombre;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_nombre := nullif(trim(v_row->>'nombre'), '');
    v_doc := nullif(trim(v_row->>'documento_numero'), '');
    begin
      if v_nombre is null then
        v_errores := v_errores || jsonb_build_object('fila', v_i, 'documento', v_doc, 'msg', 'Falta el nombre');
        continue;
      end if;

      -- CG2 — cargo: usa el cargo_id del cliente; si falta, lo resuelve por alias/código/nombre.
      v_cargo := nullif(v_row->>'cargo_id','')::uuid;
      if v_cargo is null then
        v_cargo := sgc.resolver_cargo(coalesce(v_row->>'cargo_texto', v_row->>'cuadrilla'));
      end if;
      v_permiso := nullif(v_row->>'permiso_vencimiento','')::date;

      v_existe := null;
      if v_doc is not null then
        select id into v_existe from sgc.personal_obra
         where proyecto_id = p_proyecto_id and documento_numero = v_doc limit 1;
      end if;

      if v_existe is not null then
        update sgc.personal_obra set
          nombre = v_nombre,
          apellido = coalesce(nullif(trim(v_row->>'apellido'), ''), apellido),
          nacionalidad = coalesce(nullif(trim(v_row->>'nacionalidad'), ''), nacionalidad),
          tipo_documento = coalesce(nullif(trim(v_row->>'tipo_documento'), ''), tipo_documento),
          cargo_id = coalesce(v_cargo, cargo_id),
          cuadrilla = coalesce(nullif(trim(v_row->>'cuadrilla'), ''), cuadrilla),
          notas = coalesce(nullif(trim(v_row->>'notas'), ''), notas),
          permiso_vencimiento = coalesce(v_permiso, permiso_vencimiento),
          activo_en_obra = true,
          estado = coalesce(nullif(estado,''), 'activo'),
          lote_import = coalesce(p_lote, lote_import),
          updated_at = now()
        where id = v_existe;
        v_actualizados := v_actualizados + 1;
      else
        insert into sgc.personal_obra
          (proyecto_id, nombre, apellido, nacionalidad, tipo_documento, documento_numero,
           cargo_id, cuadrilla, notas, permiso_vencimiento, activo_en_obra, estado, registrado_por, lote_import)
        values (
          p_proyecto_id, v_nombre, nullif(trim(v_row->>'apellido'), ''),
          coalesce(nullif(trim(v_row->>'nacionalidad'), ''), 'dominicano'),
          coalesce(nullif(trim(v_row->>'tipo_documento'), ''), 'cedula'),
          v_doc, v_cargo, nullif(trim(v_row->>'cuadrilla'), ''),
          nullif(trim(v_row->>'notas'), ''), v_permiso, true, 'activo', auth.uid(), p_lote);
        v_creados := v_creados + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object('fila', v_i, 'documento', v_doc, 'msg', SQLERRM);
    end;
  end loop;

  if p_bajas is not null and array_length(p_bajas, 1) is not null then
    update sgc.personal_obra
       set activo_en_obra = false, estado = 'inactivo', updated_at = now()
     where proyecto_id = p_proyecto_id and id = any(p_bajas);
    get diagnostics v_bajas = row_count;
  end if;

  update sgc.personal_obra_listados
     set total_altas = v_creados, total_actualizados = v_actualizados, total_bajas = v_bajas
   where id = p_lote;

  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados,
                            'bajas', v_bajas, 'errores', v_errores);
end;
$function$;

grant execute on function sgc.importar_listado_personal_obra(uuid, jsonb, uuid, date, text, text, uuid[]) to authenticated;

-- ── 8. Aviso a Legal: permisos por vencer (≤30 días) o vencidos. Cron diario. ───────
create or replace function sgc.avisar_permisos_por_vencer()
returns integer
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare r record; v_n int := 0;
begin
  for r in
    select p.id, p.nombre, p.permiso_vencimiento, pr.nombre as obra
      from sgc.personal_obra p
      left join sgc.proyectos pr on pr.id = p.proyecto_id
     where p.permiso_vencimiento is not null
       and p.activo_en_obra
       and coalesce(p.es_prueba,false) = false
       and p.permiso_vencimiento <= current_date + interval '30 days'
  loop
    perform sgc.notificar_modulo(
      'legal', 'permiso_por_vencer',
      case when r.permiso_vencimiento < current_date then 'Permiso de trabajo VENCIDO'
           else 'Permiso de trabajo por vencer' end,
      format('%s (%s) — permiso %s el %s',
             r.nombre, coalesce(r.obra,'sin obra'),
             case when r.permiso_vencimiento < current_date then 'venció' else 'vence' end,
             to_char(r.permiso_vencimiento, 'DD/MM/YYYY')),
      '/proyectos/personal');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- Cron diario 7:30 AM (hora servidor). Idempotente.
select cron.unschedule('sgc-avisar-permisos-por-vencer') where exists (select 1 from cron.job where jobname = 'sgc-avisar-permisos-por-vencer');
select cron.schedule('sgc-avisar-permisos-por-vencer', '30 7 * * *', $cron$select sgc.avisar_permisos_por_vencer();$cron$);
