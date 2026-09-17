-- BS3 — módulo "Configuración" (web, general para todos). Preferencias de usuario
-- que siguen a la persona (tema, densidad, tamaño de letra, módulo de inicio,
-- primer-ingreso de idioma). Aditivo y retrocompatible.
--
-- ⚠️ La tabla `sgc.usuario_preferencias` YA EXISTE en prod (BE6, persistencia de
-- tema: columnas usuario_id PK→auth.users, tema check(claro|oscuro), actualizado_en;
-- RLS own-user up_select/insert/update; RPCs mi_tema/set_tema los usa ThemeService).
-- Por eso esta migración es ADITIVA sobre la tabla existente — NO la recrea.
--
-- DECISIÓN (DEFAULT, ver HANDOFF §BS3): el idioma CANÓNICO vive en `usuarios.idioma`
-- (BR7, ya en prod, la app lo usa vía `mi_idioma_set`). Esta tabla NO duplica la
-- verdad del idioma: `mis_preferencias()` lo lee de `usuarios.idioma`, y
-- `set_mi_preferencia('idioma',…)` escribe usuarios.idioma + sella el primer ingreso
-- aquí. Una sola fuente de idioma, cero divergencia web↔app (regla 1).

-- Columnas nuevas (aditivas).
alter table sgc.usuario_preferencias add column if not exists idioma text
  check (idioma is null or idioma in ('es','en','ht'));
alter table sgc.usuario_preferencias add column if not exists densidad text default 'normal'
  check (densidad is null or densidad in ('compacta','normal','comoda'));
alter table sgc.usuario_preferencias add column if not exists tamano_letra text default 'normal'
  check (tamano_letra is null or tamano_letra in ('pequena','normal','grande'));
alter table sgc.usuario_preferencias add column if not exists modulo_inicio text;
alter table sgc.usuario_preferencias add column if not exists idioma_elegido_at timestamptz;

-- Ampliar el CHECK de tema para admitir 'sistema' (sigue el tema del dispositivo).
alter table sgc.usuario_preferencias drop constraint if exists usuario_preferencias_tema_check;
alter table sgc.usuario_preferencias add constraint usuario_preferencias_tema_check
  check (tema is null or tema in ('claro','oscuro','sistema'));

grant select, insert, update on sgc.usuario_preferencias to authenticated;

-- ── mis_preferencias(): preferencias del usuario actual ──────────────────────
-- Idioma coalesced con usuarios.idioma (fuente canónica). (usuario_id = auth.uid()
-- = usuarios.id.)
create or replace function sgc.mis_preferencias()
returns jsonb
language sql
security definer
set search_path = sgc, public
stable
as $$
  select jsonb_build_object(
    'idioma',            coalesce(up.idioma, u.idioma, 'es'),
    'tema',              coalesce(up.tema, 'sistema'),
    'densidad',          coalesce(up.densidad, 'normal'),
    'tamano_letra',      coalesce(up.tamano_letra, 'normal'),
    'modulo_inicio',     up.modulo_inicio,
    'idioma_elegido_at', up.idioma_elegido_at
  )
  from sgc.usuarios u
  left join sgc.usuario_preferencias up on up.usuario_id = u.id
  where u.id = auth.uid();
$$;

grant execute on function sgc.mis_preferencias() to authenticated;

-- ── set_mi_preferencia(clave, valor): whitelist estricta ─────────────────────
-- Claves: idioma | tema | densidad | tamano_letra | modulo_inicio.
-- Para 'idioma' escribe TAMBIÉN usuarios.idioma (canónico) + sella idioma_elegido_at
-- la primera vez (cierra el diálogo de primer ingreso para siempre, cross-device).
create or replace function sgc.set_mi_preferencia(p_clave text, p_valor text)
returns jsonb
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  insert into sgc.usuario_preferencias(usuario_id) values (v_uid)
    on conflict (usuario_id) do nothing;

  if p_clave = 'idioma' then
    if coalesce(p_valor,'') not in ('es','en','ht') then
      raise exception 'Idioma no soportado' using errcode = '22023';
    end if;
    update sgc.usuarios set idioma = p_valor, updated_at = now() where id = v_uid;
    update sgc.usuario_preferencias
      set idioma = p_valor,
          idioma_elegido_at = coalesce(idioma_elegido_at, now()),
          actualizado_en = now()
      where usuario_id = v_uid;

  elsif p_clave = 'tema' then
    if coalesce(p_valor,'') not in ('claro','oscuro','sistema') then
      raise exception 'Tema no válido' using errcode = '22023';
    end if;
    update sgc.usuario_preferencias set tema = p_valor, actualizado_en = now() where usuario_id = v_uid;

  elsif p_clave = 'densidad' then
    if coalesce(p_valor,'') not in ('compacta','normal','comoda') then
      raise exception 'Densidad no válida' using errcode = '22023';
    end if;
    update sgc.usuario_preferencias set densidad = p_valor, actualizado_en = now() where usuario_id = v_uid;

  elsif p_clave = 'tamano_letra' then
    if coalesce(p_valor,'') not in ('pequena','normal','grande') then
      raise exception 'Tamaño de letra no válido' using errcode = '22023';
    end if;
    update sgc.usuario_preferencias set tamano_letra = p_valor, actualizado_en = now() where usuario_id = v_uid;

  elsif p_clave = 'modulo_inicio' then
    update sgc.usuario_preferencias
      set modulo_inicio = nullif(btrim(coalesce(p_valor,'')), ''), actualizado_en = now()
      where usuario_id = v_uid;

  else
    raise exception 'Preferencia no reconocida: %', p_clave using errcode = '22023';
  end if;

  return sgc.mis_preferencias();
end;
$$;

grant execute on function sgc.set_mi_preferencia(text, text) to authenticated;
