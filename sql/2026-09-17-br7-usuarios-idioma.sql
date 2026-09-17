-- BR7 — idioma del usuario para que siga entre dispositivos.
-- La app persiste el idioma en Preferences (local) para respuesta inmediata; esta
-- columna + RPC lo sincroniza en el servidor (self-service, por auth.uid()). Aditivo
-- y retrocompatible: default 'es'; whitelist es|en|ht.
--
-- ⚠️ Vive en el repo de la APP por conveniencia de la sesión; su HOGAR es SGC/sql.

alter table sgc.usuarios add column if not exists idioma text not null default 'es';

-- Solo valores soportados (aditivo: no rompe filas existentes que ya son 'es').
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'usuarios_idioma_chk'
  ) then
    alter table sgc.usuarios
      add constraint usuarios_idioma_chk check (idioma in ('es','en','ht'));
  end if;
end $$;

-- Self-service: cada usuario fija SU idioma (nunca el de otro). No toca rol/permisos.
create or replace function sgc.mi_idioma_set(p_idioma text)
returns void
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
  if coalesce(p_idioma, '') not in ('es','en','ht') then
    raise exception 'Idioma no soportado' using errcode = '22023';
  end if;
  update sgc.usuarios set idioma = p_idioma, updated_at = now() where id = v_uid;
end;
$$;

grant execute on function sgc.mi_idioma_set(text) to authenticated;
