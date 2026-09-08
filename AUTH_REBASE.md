# Auth rebase — unificação cérebro + porteiro

## O que foi feito

- Branch `feat/auth-d1` rebased onto `f7f24a3` (`feat/ai-gateway-chat`).
- Novo tip: `5ead160` — `feat(auth): D1 users/sessions + rotas signup/login/logout/me`
- Conflitos resolvidos em `src/index.ts` e `README.md`; `wrangler.jsonc` consolidado (vars duplicadas unificadas).

## Decisão de merge

O commit auth original (`b22c650`) substituía `src/index.ts` por stubs (search/empresa vazios, sem chat). **Não usamos essa versão.**

Mantido:
- **Cérebro (HEAD / AI Gateway):** `chat-ai`, `tools`, POST `/api/chat`, search/empresa via BrasilAPI, health com campos `chat`/`ai`/`ai_gateway`.
- **Porteiro (auth D1):** `handleAuth` primeiro no fetch; GET `/download/setor/:setor` com `getSessionUser` (401 se null); `Env extends AuthEnv`; health também com `auth: true`.

## Worktrees

| Path | Branch | Notas |
|------|--------|-------|
| `/workspace/indice-auth` | `feat/auth-d1` | Worktree deste rebase (não é clone paralelo eterno). Clean após rebase. |
| `/workspace/indice` | `feat/ai-gateway-chat` | Continua no cérebro; dirty local (`pipelines/`, `docs/`, tools, workflows). **Auth NÃO misturado lá ainda.** |

## wrangler (unificado)

Um único bloco `vars`: `AI_GATEWAY_ID`, `AI_MODEL`, `SESSION_SECRET` (placeholder).
`run_worker_first`: `/api/*`, `/auth/*`, `/download/*`.
Bindings: AI, R2 `CNPJ_DATA`, D1 `DB` → `indicie-auth` (database_id placeholder).

## Push / deploy

- **Push bloqueado** até PAT estar disponível.
- Sem push, sem deploy, sem merge neste passo.
