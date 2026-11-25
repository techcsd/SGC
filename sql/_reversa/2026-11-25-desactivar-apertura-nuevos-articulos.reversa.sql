-- Reversa: reactiva la apertura automática de 1000 unidades (valor anterior).
begin;
update sgc.parametros set valor = '1000', updated_at = now() where clave = 'apertura_nuevos_articulos';
commit;
