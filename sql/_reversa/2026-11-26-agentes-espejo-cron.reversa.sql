begin;
select cron.unschedule('agente-ingeniero-espejo') where exists (select 1 from cron.job where jobname = 'agente-ingeniero-espejo');
commit;
