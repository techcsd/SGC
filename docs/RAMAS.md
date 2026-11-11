# Ramas y worktrees — convención (DN-20, ronda DN, 11-nov-2026)

Documento vivo. Nace de la higiene de la ronda DN (DN-04/DN-05): antes no había una convención escrita de cuándo se borra una rama/worktree y cuándo no.

## Cuándo se borra una rama local

- **Se borra sin pedir permiso**: una rama local cuyo HEAD está contenido en `origin/main` (`git branch --merged origin/main`) **y** no tiene un worktree activo sobre ella. Se registra primero `rama | SHA` en `C:\developer\backups\higiene-11112026.txt` (o el archivo de la ronda que corresponda) — recuperable con `git branch <nombre> <SHA>`.
- **No se borra nunca sin avisar**: una rama con commits que origin/main no tiene (`git cherry origin/main <rama>` devuelve algo con `+`), aunque sea vieja. Se reporta con el diff y una recomendación (merge o descarte), y Xaviel decide.
- **Nunca se borra una rama remota** (`origin/*`) en estas rondas de higiene — eso lo decide Xaviel explícitamente.
- **csd-app (hijo) no se toca en una ronda de SGC** salvo que la ronda lo pida expresamente — queda solo como informe/recomendación.

## Worktrees

- **Un worktree = una sesión/ronda.** Nunca dos sesiones activas sobre el mismo directorio de trabajo (ver CQ6 en `.claude/CLAUDE.md`).
- Se retira (`git worktree remove`) un worktree **limpio** (sin `git status --short`) cuya rama ya esté mergeada a `origin/main`. Un worktree con cambios sin commitear **nunca se toca** sin revisar qué es ese trabajo primero — puede ser una sesión en curso.
- `SGC-graph` es la excepción: worktree dedicado a mantener el grafo de `origin/dev` al día (detached), no es una rama de trabajo — se conserva siempre.
- Los hooks `post-merge`/`post-checkout` de graphify viven en el `.git` **común** del repo, así que **todo worktree nuevo los hereda automáticamente** — no hace falta instalarlos aparte.

## Árbol de worktrees (estado al cierre de la ronda DN, 11-nov-2026)

```
C:/Users/xavie/Desktop/X Dev/dev/
├── SGC                  main                              — limpio
├── SGC-cz               dev                                — SUCIO (archivos generados: i18n coverage, version.ts; + 1 doc nuevo)
├── SGC-da               feature/da-ronda                   — SUCIO (HANDOFF.md modificado)
├── SGC-dj               feature/dj-odoo-issues-triage       — SUCIO (27 archivos, trabajo real de Odoo/OC — NO TOCAR)
├── SGC-dl               feature/dl-compa-whatsapp-modulo    — SUCIO (graphify-out/ sin versionar)
├── SGC-dl-merge         dl-merge-resolve                    — SUCIO (archivos generados: i18n coverage, package-lock, version.ts)
├── SGC-dm               tmp-dev-check                        — limpio (snapshot de origin/dev para inspección)
├── SGC-dn               feature/dn-cierre-dm-higiene         — esta ronda
└── SGC-graph            (detached, origin/dev)               — grafo siempre al día, no se retira
```

Retirados esta ronda (limpios + ya mergeados a `origin/main`): `SGC-db`, `SGC-db2`, `SGC-dc`, `SGC-dg`, `SGC-dh`.

## Stashes

- `wip-not-mine-temp` (SGC, sobre `feature/cp-ronda`): trabajo real (admin/app-versiones, asistente, `assistant/index.ts`) — **no tocar**, no es de esta ronda.
- csd-app: `pre-existing uncommitted artifacts...` y un WIP de Sept-2026 sobre `dev` (`fb08bd77`) — ambos lucen vacíos/triviales al diff, reportados, no borrados (csd-app fuera de alcance de esta ronda).

## Script "siempre al día"

`C:\developer\tools\sync-todo.ps1` (copia versionada `scripts/sync-todo.ps1`) es el paso 0 de toda ronda — ver regla en `CLAUDE.md`. Hace fetch, fast-forward solo-ff donde el árbol esté limpio, `graphify update .`, y una tabla de divergencia. Nunca toca un árbol sucio.
