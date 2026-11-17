// W3 -- autorizacion del worker odoo-sync (server-to-server). FALLA CERRADO: sin secreto ni service_role no entra nadie.
// Acepta (a) x-sync-secret igual a ODOO_SYNC_SECRET o a INFRA_SYNC_SECRET (el que ya usa el cron via vault), o (b) Authorization: Bearer <service_role>.
export interface EntradaAuthWorker {
  secretHeader: string | null;
  authHeader: string | null;
  syncSecret?: string | null;
  infraSecret?: string | null;
  serviceKey?: string | null;
}

export function autorizadoWorker(e: EntradaAuthWorker): boolean {
  const h = e.secretHeader;
  if (h && ((e.syncSecret && h === e.syncSecret) || (e.infraSecret && h === e.infraSecret))) return true;
  const bearer = e.authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  return !!(bearer && e.serviceKey && bearer === e.serviceKey);
}
