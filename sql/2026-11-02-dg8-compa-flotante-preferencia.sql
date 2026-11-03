-- DG8 — Compa flotante: burbuja abajo-a-la-derecha → ventana arrastrable/redimensionable
-- disponible desde cualquier módulo. Dos preferencias NUEVAS por persona, aditivas sobre
-- `sgc.usuario_preferencias` (BS3, ya existe). Sigue EXACTO el mismo patrón que
-- sql/2026-09-17-bs3-usuario-preferencias.sql (mis_preferencias()/set_mi_preferencia()):
-- no se inventa una tabla nueva ni un mecanismo nuevo.
--
-- compa_flotante               — si está apagado, el componente no se renderiza en el shell.
-- compa_flotante_recordar_posicion — si está encendido (default), la posición/tamaño de la
--   ventana se guardan en localStorage del dispositivo; si está apagado, siempre abre
--   centrada/posición por defecto (el dato en sí vive SOLO en el cliente — esta preferencia
--   solo decide si se usa o no).
begin;
set local search_path = sgc, public;

alter table sgc.usuario_preferencias
  add column if not exists compa_flotante boolean default true,
  add column if not exists compa_flotante_recordar_posicion boolean default true;

create or replace function sgc.mis_preferencias()
returns jsonb
language sql
security definer
set search_path = sgc, public
stable
as $$
  select jsonb_build_object(
    'idioma',                           coalesce(up.idioma, u.idioma, 'es'),
    'tema',                             coalesce(up.tema, 'sistema'),
    'densidad',                         coalesce(up.densidad, 'normal'),
    'tamano_letra',                     coalesce(up.tamano_letra, 'normal'),
    'modulo_inicio',                    up.modulo_inicio,
    'idioma_elegido_at',                up.idioma_elegido_at,
    'compa_flotante',                   coalesce(up.compa_flotante, true),
    'compa_flotante_recordar_posicion', coalesce(up.compa_flotante_recordar_posicion, true)
  )
  from sgc.usuarios u
  left join sgc.usuario_preferencias up on up.usuario_id = u.id
  where u.id = auth.uid();
$$;

grant execute on function sgc.mis_preferencias() to authenticated;

-- set_mi_preferencia(): se amplía la whitelist con las dos claves nuevas (booleanas,
-- aceptan 'true'/'false' como el resto de las claves de esta función acepta texto).
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

  elsif p_clave = 'compa_flotante' then
    if coalesce(p_valor,'') not in ('true','false') then
      raise exception 'Valor no válido' using errcode = '22023';
    end if;
    update sgc.usuario_preferencias set compa_flotante = (p_valor = 'true'), actualizado_en = now() where usuario_id = v_uid;

  elsif p_clave = 'compa_flotante_recordar_posicion' then
    if coalesce(p_valor,'') not in ('true','false') then
      raise exception 'Valor no válido' using errcode = '22023';
    end if;
    update sgc.usuario_preferencias set compa_flotante_recordar_posicion = (p_valor = 'true'), actualizado_en = now() where usuario_id = v_uid;

  else
    raise exception 'Preferencia no reconocida: %', p_clave using errcode = '22023';
  end if;

  return sgc.mis_preferencias();
end;
$$;

grant execute on function sgc.set_mi_preferencia(text, text) to authenticated;

commit;
