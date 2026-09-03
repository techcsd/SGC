-- ════════════════════════════════════════════════════════════════════════════
-- PROMPT-32 (BI6) — (1) Backfill de usuarios.cedula desde el email sintético (lo
-- que BH4 dejó fuera a propósito), y (2) el fabricador de cédulas sintéticas de
-- ak20 deja de PRODUCIR casi-duplicados: falla y avisa.
-- Ronda 03/09/2026. Aditivo, idempotente.
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local search_path = sgc, public;

-- ── (1) Backfill de cédula ───────────────────────────────────────────────────
-- Rellena SÓLO donde: cedula is null, el email es sintético cap-/c-<cedula>@…, la
-- cédula derivada no está vacía, y NO chocaría con el índice único (otra fila ya
-- la tiene) — ese choque es justo el duplicado que persigue AU18 y se deja para la
-- herramienta de fusión, no se fuerza aquí.
update sgc.usuarios u
   set cedula = d.ced
  from (
    select id, regexp_replace(split_part(email,'@',1),'^(cap-|c-)','') as ced
    from sgc.usuarios
    where cedula is null
      and (email like 'cap-%@personal.constructorasd.local'
        or email like 'c-%@conductores.constructorasd.local')
  ) d
 where u.id = d.id
   and d.ced <> ''
   and not exists (select 1 from sgc.usuarios x where x.cedula = d.ced and x.id <> u.id);

-- ── (2) Fabricador de cédulas: falla en vez de fabricar un casi-duplicado ─────
create or replace function sgc.asegurar_conductor_de_usuario(p_usuario_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_cid uuid; v_nombre text; v_email text; v_cedula text;
begin
  if p_usuario_id is null then return null; end if;

  select id into v_cid from sgc.conductores
    where usuario_id = p_usuario_id
    order by activo desc, created_at asc limit 1;
  if v_cid is not null then return v_cid; end if;

  if not exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = p_usuario_id and r.codigo = 'chofer_transportista')
     and not exists (select 1 from sgc.vehiculo_usos vu where vu.usuario_id = p_usuario_id)
  then
    return null;
  end if;

  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;
  select email  into v_email  from auth.users where id = p_usuario_id;
  if v_email ~ '^c-[0-9]+@conductores\.constructorasd\.local$' then
    v_cedula := split_part(substring(v_email from 3), '@', 1);
  end if;

  -- Ficha existente sin usuario con esa cédula → enlazar (camino feliz).
  if v_cedula is not null then
    select id into v_cid from sgc.conductores where cedula = v_cedula and usuario_id is null limit 1;
    if v_cid is not null then
      update sgc.conductores set usuario_id = p_usuario_id, updated_at = now() where id = v_cid;
      return v_cid;
    end if;
    -- BI6 — la cédula ya pertenece a OTRO usuario → NO fabricar un duplicado.
    -- Fallar y avisar: es una posible persona duplicada (usar la fusión de AU18).
    if exists (select 1 from sgc.conductores
               where cedula = v_cedula and usuario_id is not null and usuario_id <> p_usuario_id) then
      raise exception 'La cédula % ya pertenece a otro conductor. Posible persona duplicada: usa la fusión de usuarios (Administración) en vez de crear otra ficha.', v_cedula
        using errcode = '23505';
    end if;
  end if;

  -- Sin cédula conocida (no es duplicado, es cédula ausente): placeholder único.
  if v_cedula is null then
    v_cedula := 'SIN-CED-' || left(replace(p_usuario_id::text, '-', ''), 8);
  end if;

  insert into sgc.conductores (cedula, nombre, licencia_tipo, tipo_vehiculo_autorizado, activo, usuario_id)
  values (v_cedula, coalesce(nullif(v_nombre,''),'Conductor'), '01', 'Liviano', true, p_usuario_id)
  returning id into v_cid;
  return v_cid;
end;
$$;

commit;
