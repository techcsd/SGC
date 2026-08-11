-- =============================================================================
-- PROMPT-7 FASE 6 (AN7) — Ronda 11/08/2026 tarde. SGC padre.
--
-- BUG: al compartir una nota, la lista de compartidos muestra al usuario como
--   "Usuario" genérico. Causa: `nota_compartidos` sólo guarda `usuario_id`, y el
--   embed `usuario:usuarios(nombre)` devuelve null porque la RLS de `usuarios`
--   sólo deja leer la fila propia (o admin). El dueño no puede leer la fila del
--   usuario compartido → nombre nulo → cae al literal "Usuario".
--
-- FIX (aditivo):
--   1) nota_compartidos_detalle(p_nota_id) — SECURITY DEFINER: resuelve nombre +
--      correo + rol server-side (sólo el dueño/admin puede leer los compartidos).
--   2) compartir_nota(p_nota_id, p_usuario_id, p_permiso) — SECURITY DEFINER:
--      valida que el llamador es el dueño, hace el upsert del permiso y NOTIFICA
--      al compartido (in-app + push) con deep-link a la nota. Idempotente.
-- =============================================================================

begin;

-- 1) Lista enriquecida de compartidos (nombre/correo/rol) — sólo dueño o admin.
create or replace function sgc.nota_compartidos_detalle(p_nota_id uuid)
returns table (
  id uuid, nota_id uuid, usuario_id uuid, permiso text, created_at timestamptz,
  nombre text, email text, rol text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select nc.id, nc.nota_id, nc.usuario_id, nc.permiso, nc.created_at,
         u.nombre::text, u.email::text,
         (select r.nombre from sgc.usuarios_roles ur
            join sgc.roles r on r.id = ur.rol_id
           where ur.usuario_id = u.id
           order by r.id limit 1) as rol
  from sgc.nota_compartidos nc
  join sgc.usuarios u on u.id = nc.usuario_id
  where nc.nota_id = p_nota_id
    and exists (
      select 1 from sgc.notas n
      where n.id = p_nota_id and (n.owner_id = auth.uid() or sgc.is_admin())
    )
  order by nc.created_at asc;
$$;
grant execute on function sgc.nota_compartidos_detalle(uuid) to authenticated;
comment on function sgc.nota_compartidos_detalle(uuid) is
  'AN7 — compartidos de una nota con nombre/correo/rol resueltos server-side (sólo dueño/admin). Reemplaza el embed usuarios(nombre) que fallaba por RLS.';

-- 2) Compartir + notificar (deep-link a la nota).
create or replace function sgc.compartir_nota(
  p_nota_id uuid, p_usuario_id uuid, p_permiso text)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_titulo text;
  v_owner  text;
  v_nuevo  boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_permiso not in ('ver','editar') then
    raise exception 'Permiso inválido (usa ver o editar).';
  end if;

  -- Sólo el dueño de la nota comparte.
  select n.titulo into v_titulo from sgc.notas n
   where n.id = p_nota_id and n.owner_id = v_uid;
  if not found then
    raise exception 'Sólo el dueño de la nota puede compartirla.' using errcode = 'P0001';
  end if;
  if p_usuario_id = v_uid then
    raise exception 'No puedes compartir la nota contigo mismo.';
  end if;

  -- ¿es un compartido nuevo? (para notificar sólo la primera vez)
  v_nuevo := not exists (
    select 1 from sgc.nota_compartidos
     where nota_id = p_nota_id and usuario_id = p_usuario_id);

  insert into sgc.nota_compartidos (nota_id, usuario_id, permiso)
  values (p_nota_id, p_usuario_id, p_permiso)
  on conflict (nota_id, usuario_id) do update set permiso = excluded.permiso;

  if v_nuevo then
    select u.nombre into v_owner from sgc.usuarios u where u.id = v_uid;
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    values (
      p_usuario_id, 'nota_compartida',
      'Te compartieron una nota',
      coalesce(v_owner,'Alguien') || ' compartió contigo la nota "' ||
        coalesce(nullif(v_titulo,''),'(sin título)') || '"' ||
        case when p_permiso = 'editar' then ' (puedes editar).' else ' (solo lectura).' end,
      '/notas/' || p_nota_id::text
    );
    -- Push best-effort (no romper si falla).
    begin
      perform sgc.send_push(
        array[p_usuario_id],
        'Te compartieron una nota',
        coalesce(v_owner,'Alguien') || ': ' || coalesce(nullif(v_titulo,''),'(sin título)'),
        jsonb_build_object('ruta', '/notas/' || p_nota_id::text, 'tipo','nota_compartida')
      );
    exception when others then null;
    end;
  end if;
end;
$$;
grant execute on function sgc.compartir_nota(uuid, uuid, text) to authenticated;
comment on function sgc.compartir_nota(uuid, uuid, text) is
  'AN7 — comparte una nota (upsert permiso) y notifica al compartido (in-app + push, deep-link /notas/:id) la primera vez. Sólo el dueño.';

commit;
