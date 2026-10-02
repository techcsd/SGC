-- CF4 — Lectura automática del recibo de combustible (visión) + registro de uso de IA
-- -------------------------------------------------------------------------------------
-- La edge `leer-recibo` usa la misma ANTHROPIC_API_KEY (como `assistant`) con un modelo
-- de visión para leer la foto del recibo/tablero/bomba y devolver los campos.  Aquí:
--   · uso_ia: registro de cada lectura (función, modelo, tokens, costo) — Tecnología lo ve.
--   · parámetros de límite diario global y por usuario (config editable).
-- -------------------------------------------------------------------------------------

create table if not exists sgc.uso_ia (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid references sgc.usuarios(id),
  funcion        text not null,                 -- 'leer_recibo'
  modelo         text,
  tokens_in      int,
  tokens_out     int,
  costo_estimado numeric(12,6),
  meta           jsonb,
  created_at     timestamptz not null default now()
);
comment on table sgc.uso_ia is 'CF4 — registro de uso de IA (lecturas de recibo, etc.) con costo estimado, visible a Tecnología.';
create index if not exists idx_uso_ia_funcion_fecha on sgc.uso_ia(funcion, created_at);
create index if not exists idx_uso_ia_usuario on sgc.uso_ia(usuario_id, created_at);

alter table sgc.uso_ia enable row level security;
-- Solo Tecnología/admin leen el registro de uso.
drop policy if exists "uso_ia: ver" on sgc.uso_ia;
create policy "uso_ia: ver" on sgc.uso_ia for select to authenticated
  using (sgc.is_admin() or sgc.es_tecnologia());
grant select on sgc.uso_ia to authenticated;
grant select, insert on sgc.uso_ia to service_role;

-- Parámetros de límite (editables en Config; la edge los lee).
insert into sgc.parametros (clave, valor, descripcion) values
  ('leer_recibo_limite_diario_global', '400', 'CF4 — máximo de lecturas de recibo por día en todo el sistema.'),
  ('leer_recibo_limite_usuario_hora',  '30',  'CF4 — máximo de lecturas de recibo por usuario por hora.')
on conflict (clave) do nothing;

-- Resumen mensual de uso para el panel de Tecnología.
create or replace function sgc.uso_ia_resumen(p_desde date default null, p_hasta date default null)
returns jsonb
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(x order by x->>'mes' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'mes', to_char(date_trunc('month', created_at), 'YYYY-MM'),
      'funcion', funcion,
      'lecturas', count(*),
      'tokens_in', coalesce(sum(tokens_in),0),
      'tokens_out', coalesce(sum(tokens_out),0),
      'costo_estimado', round(coalesce(sum(costo_estimado),0), 4)
    ) as x
    from sgc.uso_ia
    where (sgc.is_admin() or sgc.es_tecnologia())
      and (p_desde is null or created_at::date >= p_desde)
      and (p_hasta is null or created_at::date <= p_hasta)
    group by date_trunc('month', created_at), funcion
  ) s;
$function$;
grant execute on function sgc.uso_ia_resumen(date, date) to authenticated;
