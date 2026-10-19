import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  Nota,
  NotaCompartido,
  NotaPermiso,
  NotaChecklistItem,
  NotaChecklistRefTipo,
  TareaVinculable,
  NotaGrupo,
} from '../models/nota.model';

export interface DirectorioUsuario {
  id: string;
  nombre: string;
}

/** Payload que la UI envía a `guardar_nota` (crea si el id no existe, actualiza si sí). */
export interface GuardarNotaInput {
  id: string;
  titulo: string;
  contenido: string;
  color: string | null;
  pinned: boolean;
  archivada: boolean;
  ambito?: 'general' | 'dev'; // BP5
  formato?: 'html' | 'markdown';
  tags?: string[];
}

export interface GuardarNotaResult {
  conflict: boolean;
  nota: Nota;
}

// CS2 — imágenes pegadas/arrastradas en notas (bucket privado `notas-imagenes`).
export const NOTA_IMAGEN_MAX_BYTES = 5 * 1024 * 1024;
export const NOTA_IMAGEN_MAX_POR_NOTA = 20;
const NOTA_IMAGEN_PREFIJO = 'nota-img:';

@Injectable({ providedIn: 'root' })
export class NotasService {
  private supabase = inject(SupabaseService);

  /** Lista mínima de usuarios activos (SECURITY DEFINER) para el selector de compartir. */
  async getDirectorio(): Promise<DirectorioUsuario[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios');
    if (error) throw new Error(error.message);
    return (data ?? []) as DirectorioUsuario[];
  }

  /** BR — solo desarrolladores/programadores (Tecnología), para compartir DEV notes.
   *  Las dev notes no deben salirle a nadie más (la RLS y compartir_nota también lo blindan). */
  async getDirectorioDesarrolladores(): Promise<DirectorioUsuario[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_desarrolladores');
    if (error) throw new Error(error.message);
    return (data ?? []) as DirectorioUsuario[];
  }

  /** AH18 — Trae UNA nota por id directamente (RLS decide el acceso: dueño o
   *  compartida). Robusto ante timing del perfil y no depende de traer "todas mis
   *  notas" para filtrar. Devuelve null si no existe o no tengo acceso; enriquece
   *  `mi_permiso` cuando la nota es compartida (no soy el dueño). */
  async getNota(id: string, miId?: string | null): Promise<Nota | null> {
    const { data, error } = await this.supabase.client
      .from('notas')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const nota = data as Nota;
    // Compartida conmigo → resolver mi permiso (para el modo solo-lectura).
    if (miId && nota.owner_id !== miId) {
      const { data: comp } = await this.supabase.client
        .from('nota_compartidos')
        .select('permiso')
        .eq('nota_id', id)
        .eq('usuario_id', miId)
        .maybeSingle();
      nota.mi_permiso = (comp?.permiso as NotaPermiso) ?? 'ver';
    }
    return nota;
  }

  /** Mis notas (owner_id = yo). La RLS también devuelve compartidas; por eso
   *  filtramos explícitamente por dueño aquí. */
  async getMisNotas(ownerId: string, includeArchivadas = false, ambito: 'general' | 'dev' = 'general'): Promise<Nota[]> {
    let query = this.supabase.client
      .from('notas')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('ambito', ambito) // BP5 — /notas ve 'general', Dev notes ve 'dev'
      .order('updated_at', { ascending: false });

    if (!includeArchivadas) query = query.eq('archivada', false);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as Nota[];
  }

  /** Notas compartidas conmigo: filas de `nota_compartidos` con usuario_id = yo,
   *  trayendo la nota embebida (FK única nota_id → notas). */
  async getCompartidasConmigo(usuarioId: string, ambito: 'general' | 'dev' = 'general'): Promise<Nota[]> {
    const { data, error } = await this.supabase.client
      .from('nota_compartidos')
      .select('permiso, nota:notas(*)')
      .eq('usuario_id', usuarioId);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as { permiso: NotaPermiso; nota: Nota | null }[];
    return rows
      .filter((r) => r.nota && (r.nota.ambito ?? 'general') === ambito) // BP5
      .map((r) => ({ ...(r.nota as Nota), mi_permiso: r.permiso }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  /** Crea (id nuevo) o actualiza (id existente) vía RPC; devuelve { conflict, nota }.
   *  `conflict=true` si el servidor tenía una edición posterior a `expectedUpdatedAt`
   *  (última edición gana, pero se avisa). */
  async guardarNota(input: GuardarNotaInput, expectedUpdatedAt?: string | null): Promise<GuardarNotaResult> {
    const { data, error } = await this.supabase.client.rpc('guardar_nota', {
      p_id: input.id,
      p_titulo: input.titulo,
      p_contenido: input.contenido,
      p_color: input.color,
      p_pinned: input.pinned,
      p_archivada: input.archivada,
      p_expected_updated_at: expectedUpdatedAt ?? null,
      p_ambito: input.ambito ?? null,
      p_formato: input.formato ?? null,
      p_tags: input.tags ?? null,
    });

    if (error) throw new Error(error.message);
    const res = data as { conflict: boolean; nota: Nota };
    return { conflict: !!res?.conflict, nota: res.nota };
  }

  /** Eliminar (solo dueño; la RLS lo garantiza server-side). */
  async eliminarNota(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('notas').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── CS2 — grupos (carpetas anidadas) ─────────────────────────────────────────

  /** Todos MIS grupos (la RLS ya filtra por usuario_id = auth.uid()). */
  async getGrupos(): Promise<NotaGrupo[]> {
    const { data, error } = await this.supabase.client.from('nota_grupos').select('*').order('orden').order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as NotaGrupo[];
  }

  async crearGrupo(nombre: string, parentId: string | null, usuarioId: string): Promise<NotaGrupo> {
    const { data, error } = await this.supabase.client
      .from('nota_grupos')
      .insert({ usuario_id: usuarioId, nombre: nombre.trim(), parent_id: parentId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as NotaGrupo;
  }

  async renombrarGrupo(id: string, nombre: string): Promise<void> {
    const { error } = await this.supabase.client.from('nota_grupos').update({ nombre: nombre.trim() }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Mueve un grupo bajo otro padre (o a nivel raíz si `parentId` es null). El
   *  trigger de BD rechaza ciclos y más de 4 niveles de profundidad. */
  async moverGrupo(id: string, parentId: string | null): Promise<void> {
    const { error } = await this.supabase.client.from('nota_grupos').update({ parent_id: parentId }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Borra el grupo; sus subgrupos y notas suben al nivel de arriba (trigger de BD). */
  async eliminarGrupo(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('nota_grupos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Mueve una nota a un grupo (o a «Sin grupo» si `grupoId` es null). */
  async moverNotaAGrupo(notaId: string, grupoId: string | null): Promise<void> {
    const { error } = await this.supabase.client.from('notas').update({ grupo_id: grupoId }).eq('id', notaId);
    if (error) throw new Error(error.message);
  }

  // ── CS2 — imágenes pegadas/arrastradas en notas ─────────────────────────────

  /** Cuántas imágenes ya tiene la nota (para el aviso de "máximo 20 por nota"). */
  private async contarImagenesNota(notaId: string, ownerId: string): Promise<number> {
    const { data, error } = await this.supabase.client.storage.from('notas-imagenes').list(`${ownerId}/${notaId}`);
    if (error) return 0; // best-effort: un fallo de listado no debe bloquear pegar
    return data?.length ?? 0;
  }

  /** Sube el archivo y devuelve `nota-img:<ruta>` (lo que se guarda en el Markdown). */
  async subirImagenNota(notaId: string, ownerId: string, file: File): Promise<string> {
    if (file.size > NOTA_IMAGEN_MAX_BYTES) {
      throw new Error(`La imagen pesa más de ${Math.round(NOTA_IMAGEN_MAX_BYTES / 1024 / 1024)} MB. Comprímela o recórtala e inténtalo de nuevo.`);
    }
    const yaHay = await this.contarImagenesNota(notaId, ownerId);
    if (yaHay >= NOTA_IMAGEN_MAX_POR_NOTA) {
      throw new Error(`Esta nota ya tiene ${NOTA_IMAGEN_MAX_POR_NOTA} imágenes (el máximo). Borra alguna antes de agregar otra.`);
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${ownerId}/${notaId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage
      .from('notas-imagenes')
      .upload(path, file, { contentType: file.type || 'image/png' });
    if (error) throw new Error(error.message);
    return `${NOTA_IMAGEN_PREFIJO}${path}`;
  }

  /** Resuelve `nota-img:<ruta>` a una URL firmada (1 h) para mostrarla. Si ya es
   *  una URL normal (imagen externa pegada como link), la devuelve tal cual. */
  async resolverImagenNota(src: string): Promise<string> {
    if (!src.startsWith(NOTA_IMAGEN_PREFIJO)) return src;
    const path = src.slice(NOTA_IMAGEN_PREFIJO.length);
    const { data, error } = await this.supabase.client.storage.from('notas-imagenes').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo generar el enlace de la imagen.');
    return data.signedUrl;
  }

  /** Borra el archivo de Storage cuando se quita la imagen de la nota (best-effort). */
  async borrarImagenNota(src: string): Promise<void> {
    if (!src.startsWith(NOTA_IMAGEN_PREFIJO)) return;
    const path = src.slice(NOTA_IMAGEN_PREFIJO.length);
    await this.supabase.client.storage.from('notas-imagenes').remove([path]).catch(() => { /* best-effort */ });
  }

  /**
   * AN7 — compartidos de una nota con nombre/correo/rol resueltos server-side.
   * Usa la RPC `nota_compartidos_detalle` (SECURITY DEFINER); ya no depende del
   * embed `usuarios(nombre)` que fallaba por la RLS de usuarios.
   */
  async getCompartidos(notaId: string): Promise<NotaCompartido[]> {
    const { data, error } = await this.supabase.client.rpc('nota_compartidos_detalle', {
      p_nota_id: notaId,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as NotaCompartido[];
  }

  /**
   * AN7 — compartir con un usuario (upsert del permiso) + notificar al compartido
   * (in-app + push, deep-link a la nota) la primera vez. Solo dueño (validado
   * server-side por la RPC `compartir_nota`).
   */
  async compartir(notaId: string, usuarioId: string, permiso: NotaPermiso): Promise<void> {
    const { error } = await this.supabase.client.rpc('compartir_nota', {
      p_nota_id: notaId,
      p_usuario_id: usuarioId,
      p_permiso: permiso,
    });
    if (error) throw new Error(error.message);
  }

  /** Cambiar el permiso de un compartido existente. Solo dueño. */
  async cambiarPermiso(notaId: string, usuarioId: string, permiso: NotaPermiso): Promise<void> {
    const { error } = await this.supabase.client
      .from('nota_compartidos')
      .update({ permiso })
      .eq('nota_id', notaId)
      .eq('usuario_id', usuarioId);
    if (error) throw new Error(error.message);
  }

  /** Quitar un compartido. Solo dueño. */
  async quitarCompartido(notaId: string, usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('nota_compartidos')
      .delete()
      .eq('nota_id', notaId)
      .eq('usuario_id', usuarioId);
    if (error) throw new Error(error.message);
  }

  // ── AD9 — checklist estructurado + vínculo a tareas ───────────────────────
  /** Ítems del checklist de una nota (con el título de la tarea vinculada). */
  async getChecklist(notaId: string): Promise<NotaChecklistItem[]> {
    // Reconciliar primero: alinea los ítems vinculados con el estado real de su tarea.
    await this.supabase.client.rpc('sync_checklist_nota', { p_nota_id: notaId });
    // AG2: NO usar embed `tarea:tareas(...)` — `ref_id` es polimórfico (sin FK real),
    // así que PostgREST no puede resolver la relación y devuelve PGRST200 (el error del
    // toast "No se pudo cargar el checklist"). Resolvemos el título de la tarea aparte.
    const { data, error } = await this.supabase.client
      .from('nota_checklist_items')
      .select('*')
      .eq('nota_id', notaId)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as NotaChecklistItem[];
    const tareaIds = [...new Set(rows.filter((r) => r.ref_tipo === 'tarea' && r.ref_id).map((r) => r.ref_id!))];
    const titulos = new Map<string, string>();
    if (tareaIds.length) {
      const { data: tareas } = await this.supabase.client
        .from('tareas')
        .select('id, titulo')
        .in('id', tareaIds);
      for (const t of (tareas ?? []) as { id: string; titulo: string }[]) titulos.set(t.id, t.titulo);
    }
    return rows.map((r) => ({ ...r, ref_label: r.ref_tipo === 'tarea' && r.ref_id ? titulos.get(r.ref_id) ?? null : null }));
  }

  async addChecklistItem(notaId: string, texto: string, orden: number): Promise<NotaChecklistItem> {
    const { data, error } = await this.supabase.client
      .from('nota_checklist_items')
      .insert({ nota_id: notaId, texto, orden })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as NotaChecklistItem;
  }

  async updateChecklistItem(id: string, patch: Partial<Pick<NotaChecklistItem, 'texto' | 'done' | 'orden'>>): Promise<void> {
    const body: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
    // Un toggle manual deja de ser "automático" (para que reabrir la tarea no lo pise).
    if (patch.done !== undefined) {
      body['done_auto'] = false;
      body['done_at'] = patch.done ? new Date().toISOString() : null;
    }
    const { error } = await this.supabase.client
      .from('nota_checklist_items')
      .update(body)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async removeChecklistItem(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('nota_checklist_items').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Vincula (o desvincula con ref=null) un ítem a una tarea. */
  async linkChecklistItem(id: string, refTipo: NotaChecklistRefTipo | null, refId: string | null): Promise<void> {
    const { error } = await this.supabase.client
      .from('nota_checklist_items')
      .update({ ref_tipo: refTipo, ref_id: refId, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Persiste el nuevo orden (drag/reorder) de todos los ítems. */
  async reordenarChecklist(items: { id: string; orden: number }[]): Promise<void> {
    await Promise.all(items.map((it) => this.updateChecklistItem(it.id, { orden: it.orden })));
  }

  /** CQ2 — marca la nota como "enviada a ronda" (copiada al portapapeles en texto
   *  plano). Solo informativo; no toca `contenido`. */
  async marcarEnviadaARonda(notaId: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('nota_marcar_enviada_ronda', {
      p_id: notaId,
    });
    if (error) throw new Error(error.message);
    return (data as { enviada_a_ronda_at: string })?.enviada_a_ronda_at;
  }

  /** Tareas que el usuario puede ver (RLS), para el selector "Vincular a tarea…". */
  async getTareasVinculables(): Promise<TareaVinculable[]> {
    const { data, error } = await this.supabase.client
      .from('tareas')
      .select('id, titulo, estado')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as TareaVinculable[];
  }
}
