-- DK (issue #71) -- politicas PERMISIVAS identicas o subsumidas (verificado contra prod, solo lectura;
-- dev y prod tienen exactamente el mismo conjunto). Quitarlas NO cambia permisos: las permisivas se
-- combinan con OR, y estas son iguales (o implicadas) por otra que se conserva.
--  * articulos SELECT: 3 politicas "true" -> conserva articulos_select
--  * categorias_inventario SELECT: 2 "true" -> conserva categorias_select
--  * roles SELECT: 2 "true" -> conserva roles_select
--  * usuarios SELECT: 2 identicas (id = auth.uid()) -> conserva usuarios_select_own
--  * stock_por_bodega SELECT: "referencia autenticados" (uid not null) ya cubre a todo authenticated;
--    stock_select y "stock_por_bodega: select" quedan implicadas -> se quitan.
-- Cada DROP esta guardado: solo si la politica existe Y su expresion es la esperada.
-- Lo NO fusionado (salidas_inventario/detalle_salidas 6 SELECT, usuarios 5): predicados y roles
-- (public vs authenticated) distintos; fusionarlos cambia el plan y exige prueba por rol -> decision aparte.
-- Reversa: sql/2026-11-17-dk-politicas-duplicadas_reversa.sql
begin;
do $$
declare
  r record;
begin
  for r in select * from (values
    ('articulos','articulos: read','true'),
    ('articulos','articulos: select','true'),
    ('categorias_inventario','categorias_inventario: read','true'),
    ('roles','roles: read all','true'),
    ('usuarios','usuarios: read own','(id = ( SELECT auth.uid() AS uid))')
  ) v(t,p,q)
  loop
    if exists (select 1 from pg_policies where schemaname='sgc' and tablename=r.t and policyname=r.p
               and permissive='PERMISSIVE' and cmd='SELECT' and qual=r.q)
       and exists (select 1 from pg_policies where schemaname='sgc' and tablename=r.t and policyname<>r.p
               and permissive='PERMISSIVE' and cmd='SELECT' and qual=r.q) then
      execute format('drop policy %I on sgc.%I', r.p, r.t);
    end if;
  end loop;

  -- stock_por_bodega: solo si sigue existiendo la politica abierta a authenticated
  if exists (select 1 from pg_policies where schemaname='sgc' and tablename='stock_por_bodega'
             and policyname='stock_por_bodega: referencia autenticados' and permissive='PERMISSIVE'
             and cmd='SELECT' and roles='{authenticated}') then
    drop policy if exists "stock_select" on sgc.stock_por_bodega;
    drop policy if exists "stock_por_bodega: select" on sgc.stock_por_bodega;
  end if;
end $$;
commit;
