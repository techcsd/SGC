#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_root="$(mktemp -d /private/tmp/sgc-odoo-schema.XXXXXX)"
pg_bin="$(pg_config --bindir)"
cleanup() {
  "$pg_bin/pg_ctl" -D "$test_root/data" -m fast -w stop >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT
mkdir "$test_root/socket"
"$pg_bin/initdb" -D "$test_root/data" -A trust -U sgc_schema_test --no-locale >/dev/null
"$pg_bin/pg_ctl" -D "$test_root/data" -l "$test_root/postgres.log" -o "-k $test_root/socket -c listen_addresses='' -p 55439" -w start >/dev/null
export PGHOST="$test_root/socket" PGPORT=55439 PGUSER=sgc_schema_test PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/qa/odoo-schema/fixture.sql"
psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/docs/odoo-schema/00_preflight.sql" >"$test_root/preflight.log" 2>&1 || { cat "$test_root/preflight.log"; exit 1; }
if psql -X -v ON_ERROR_STOP=1 -q -c 'select id from sgc.odoo_instancias' >"$test_root/red.log" 2>&1; then
  echo 'ERROR: la prueba inicial debía fallar sin el esquema.' >&2
  exit 1
fi
echo 'RED confirmado: los objetos nuevos no existen antes de migrar.'
# Probar también la fase mínima aislada y la ampliación posterior.
createdb sgc_identity_test
PGDATABASE=sgc_identity_test psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/qa/odoo-schema/fixture.sql" >"$test_root/identity-fixture.log" 2>&1 || { cat "$test_root/identity-fixture.log"; exit 1; }
for pass in 1 2; do
  PGDATABASE=sgc_identity_test psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/sql/20261016112524_odoo_identity_fields.sql" >"$test_root/identity-$pass.log" 2>&1 || { cat "$test_root/identity-$pass.log"; exit 1; }
done
PGDATABASE=sgc_identity_test psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sgc' and c.relkind='r' and c.relname like 'odoo_%')<>2 then raise exception 'Fase 1 debe crear solo dos tablas de contexto'; end if;
  if to_regclass('sgc.odoo_eventos') is not null then raise exception 'Fase 1 no debe crear cola'; end if;
  if (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='sgc' and col_description(c.oid,a.attnum)='SGC Odoo foundation v1' and not a.attisdropped and not a.attnotnull and not a.atthasdef)<>61 then raise exception 'Faltan campos opcionales'; end if;
  if not has_table_privilege('service_role','sgc.odoo_instancias','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','sgc.odoo_instancias','INSERT') then raise exception 'Permisos incorrectos fase 1'; end if;
end; $$;
SQL
PGDATABASE=sgc_identity_test psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/docs/odoo-schema/01_verify_identity.sql" >"$test_root/identity-verify.log" 2>&1 || { cat "$test_root/identity-verify.log"; exit 1; }
PGDATABASE=sgc_identity_test psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/sql/20261016112525_odoo_sync_foundation.sql" >"$test_root/upgrade.log" 2>&1 || { cat "$test_root/upgrade.log"; exit 1; }
PGDATABASE=sgc_identity_test psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/qa/odoo-schema/assertions.sql" >"$test_root/upgrade-assertions.log" 2>&1 || { cat "$test_root/upgrade-assertions.log"; exit 1; }
echo 'PASS: fase 1 aislada, reaplicación y ampliación al esquema completo.'
psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/sql/20261016112525_odoo_sync_foundation.sql" >"$test_root/apply.log" 2>&1 || { cat "$test_root/apply.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/sql/20261016112525_odoo_sync_foundation.sql" >"$test_root/reapply.log" 2>&1 || { cat "$test_root/reapply.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/qa/odoo-schema/assertions.sql"
psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/docs/odoo-schema/03_validate_constraints.sql" >"$test_root/validate.log" 2>&1 || { cat "$test_root/validate.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if exists(select 1 from pg_constraint where connamespace='sgc'::regnamespace and conname like 'odoo_v1_%' and not convalidated) then
    raise exception 'Quedaron restricciones nuevas sin validar';
  end if;
end; $$;
SQL
psql -X -v ON_ERROR_STOP=1 -q -f "$repo_root/docs/odoo-schema/02_verify.sql" >"$test_root/verify.log" 2>&1 || { cat "$test_root/verify.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 -q -c "set role service_role; insert into sgc.odoo_eventos(instancia_id,direccion,clave_idempotencia,agregado,revision,accion) values ('20000000-0000-0000-0000-000000000001','sgc_a_odoo','parallel-1','parallel-1',1,'crear'),('20000000-0000-0000-0000-000000000001','sgc_a_odoo','parallel-2','parallel-2',1,'crear');"
psql -X -v ON_ERROR_STOP=1 -qAt -c "begin;set local role service_role;select id from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','parallel-1',1);select pg_sleep(1);commit;" >"$test_root/worker-1" &
worker_one=$!
psql -X -v ON_ERROR_STOP=1 -qAt -c "begin;set local role service_role;select id from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','parallel-2',1);select pg_sleep(1);commit;" >"$test_root/worker-2" &
worker_two=$!
wait "$worker_one"
wait "$worker_two"
python3 - "$test_root" <<'PY'
import re,sys
from pathlib import Path
root=Path(sys.argv[1]); ids=[]
for name in ['worker-1','worker-2']:
    found=re.findall(r'^[0-9a-f-]{36}$',(root/name).read_text(),re.M)
    assert len(found)==1,(name,found)
    ids.extend(found)
assert len(set(ids))==2,ids
print('PASS: dos consumidores concurrentes reclamaron eventos distintos.')
PY
echo 'PASS: instalación, reaplicación, preflight, validación, compatibilidad, integridad, permisos y cola.'
