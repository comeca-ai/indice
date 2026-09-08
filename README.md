# Indície

Consulta conversacional de CNPJ — Workers + R2 + AI Gateway + D1 (auth).

- Worker: indicie
- Bucket: indicie-cnpj
- D1: indicie-auth (binding `DB`)
- Live: https://indicie.jhonata-emerick.workers.dev

## Stack
- src/index.ts, src/chat-ai.ts, src/tools.ts, src/auth.ts
- AI binding + AI_GATEWAY_ID=indicie
- R2 CNPJ_DATA
- Auth = porteiro; ingest = carga
- run_worker_first: /api/*, /auth/*, /download/*

## Chat
POST /api/chat { message, history?, lastEmpresa?, stream? }
- Tools: consulta_cnpj; busca_textual when R2 has index
- source: ai-gateway | brasilapi | followup | guide
- stream true returns SSE

## Auth (D1)

Rotas: POST /auth/signup login logout; GET /auth/me; GET /download/setor/:setor (401 sem sessão).
Cookie `indicie_session`: HttpOnly Secure SameSite=Lax Path=/ ~7d. Token opaco; hash no D1. PBKDF2 Web Crypto.
Setup local: instalar deps, criar banco D1, migrar, rodar wrangler dev.
Produção: `wrangler secret put SESSION_SECRET`; aplicar migrations remotas. Placeholder no wrangler não é valor real.
Teste: curl com cookie jar em signup, me, download/setor e logout.

## Gateway
1. Create AI Gateway id indicie or default
2. Prefer Workers AI via Gateway
3. Default model hermes-2-pro

## API
health chat search empresa auth download
MIT

## Docs

- [Filtros concorrentes](docs/competitor-filters.md)
- [Gap analysis do form Indície](docs/indicie-form-gap-analysis.md)
