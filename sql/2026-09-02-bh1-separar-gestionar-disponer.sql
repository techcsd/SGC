-- ════════════════════════════════════════════════════════════════════════════
-- BH1 — Separar "gestionar" de "disponer de lo mío" en las requisiciones.
--
-- Problema (capturas 1-2, REQ-000026 de Eduardo NG, Gerencia + autor):
--   sgc.puede_gestionar_requisicion INCLUÍA al autor (sm.solicitante_id = uid),
--   así que:
--     · requisicion_cerrar dejaba al AUTOR marcar su propia requisición como
--       'completada' sin que nadie despachara nada (hueco BH1-d);
--     · la UI ofrecía "Rechazar" al autor y el servidor lo negaba con
--       "No puedes rechazar tu propia solicitud" (rechazar_solicitud_material ya
--       excluía al autor por su cuenta — la incoherencia era el gate compartido).
--
-- Cirugía (aditiva, retrocompatible):
--   (1) puede_gestionar_requisicion  → aprobar / rechazar / CERRAR = un TERCERO
--       (admin, rol de gestión, o responsable de obra). SE QUITA la rama del autor.
--   (2) puede_disponer_de_mi_requisicion  → editar / CANCELAR = el AUTOR o admin.
--   (3) requisicion_cancelar → autoriza a "disponer" O a "gestionar" (un gestor
--       también puede cancelar, regla BA6). requisicion_cerrar se queda solo en
--       "gestionar" → el autor deja de poder cerrar la suya.
--
-- ⚠️ CAMBIO DE PERMISOS. Verificado que Raykler (coord_compras) sigue gestionando:
--   su rol está en la lista, no dependía de la rama del autor.
--
-- La 4ª regla del checklist de migraciones (BH1): ninguna acción se pinta si el
-- guard la va a negar — el front espeja EXACTAMENTE estas dos funciones.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- (1) "Gestionar" = aprobar / rechazar / cerrar. SIN la rama del autor. ────────
create or replace function sgc.puede_gestionar_requisicion(p_solicitud_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = auth.uid()
                   and r.codigo in ('logistica','coord_compras','jefe_ingenieros','tecnologia'))
      or exists (select 1 from sgc.solicitudes_material sm
                 where sm.id = p_solicitud_id and sgc.es_responsable_de_proyecto(sm.proyecto_id));
$$;
grant execute on function sgc.puede_gestionar_requisicion(uuid) to authenticated;

comment on function sgc.puede_gestionar_requisicion(uuid) is
  'BH1 — aprobar/rechazar/cerrar una requisición: un tercero (admin, rol de gestión '
  'o responsable de obra). NO incluye al autor (para eso: puede_disponer_de_mi_requisicion).';

-- (2) "Disponer de lo mío" = editar / cancelar. El autor o un admin. ──────────
create or replace function sgc.puede_disponer_de_mi_requisicion(p_solicitud_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
      or exists (select 1 from sgc.solicitudes_material sm
                 where sm.id = p_solicitud_id and sm.solicitante_id = auth.uid());
$$;
grant execute on function sgc.puede_disponer_de_mi_requisicion(uuid) to authenticated;

comment on function sgc.puede_disponer_de_mi_requisicion(uuid) is
  'BH1 — editar/cancelar la requisición propia: el autor o un admin.';

-- (3a) Cancelar: el autor (disponer) O un gestor. Motivo obligatorio (BA6). ────
create or replace function sgc.requisicion_cancelar(p_solicitud_id uuid, p_motivo text)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.puede_disponer_de_mi_requisicion(p_solicitud_id)
          or sgc.puede_gestionar_requisicion(p_solicitud_id)) then
    raise exception 'No tienes permiso para cancelar esta requisición.';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;
  update sgc.solicitudes_material
     set estado = 'cancelada', cancelada_motivo = btrim(p_motivo),
         cerrada_por = auth.uid(), cerrada_en = now(), updated_at = now()
   where id = p_solicitud_id;
end;
$$;
grant execute on function sgc.requisicion_cancelar(uuid,text) to authenticated;

-- (3b) Cerrar (marcar completada sin despachar todo): SOLO gestionar. ─────────
-- Con puede_gestionar sin la rama del autor, el autor deja de poder cerrar la suya.
create or replace function sgc.requisicion_cerrar(p_solicitud_id uuid)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.puede_gestionar_requisicion(p_solicitud_id) then
    raise exception 'No tienes permiso para cerrar esta requisición.';
  end if;
  update sgc.solicitudes_material
     set estado = 'completada', cerrada_por = auth.uid(), cerrada_en = now(), updated_at = now()
   where id = p_solicitud_id and estado not in ('cancelada');
end;
$$;
grant execute on function sgc.requisicion_cerrar(uuid) to authenticated;

commit;

-- ── Smoke (correr por separado, no en la migración) ──────────────────────────
-- 1) Como el AUTOR: requisicion_cerrar(su_req) debe FALLAR ("No tienes permiso").
-- 2) Como el AUTOR: requisicion_cancelar(su_req,'Test') debe PASAR → 'cancelada'.
-- 3) Como Raykler (coord_compras, NO autor): cerrar/rechazar debe PASAR.
