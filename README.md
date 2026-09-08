# Indície

Consulta de CNPJ na edge — Cloudflare Workers + Assets (SPA) + R2.

- Produto: Indície
- Domínio: indicie.ia.br
- Worker: indicie
- Bucket R2: indicie-cnpj

## Stack

- Worker TypeScript (src/index.ts)
- Assets estaticos em public/ (UI PT-BR)
- Binding R2 CNPJ_DATA -> bucket indicie-cnpj
- run_worker_first /api/* antes dos assets

## API (stubs)

- GET /api/health — health + amostra R2
- GET /api/search?q= — busca (empty: true)
- GET /api/empresa/:cnpj — lookup (empty: true)

## Comandos locais

- install / dev / build / deploy / types via package.json

## Deploy com Workers Builds

1. Cloudflare dashboard → Workers and Pages → Connect to Git → comeca-ai/indice.
2. Workers Builds no branch main (deploy: npx wrangler deploy).
3. Criar bucket R2 indicie-cnpj (binding CNPJ_DATA ja no wrangler.jsonc).
4. Custom Domain: indicie.ia.br no Worker indicie.
5. Validar https://indicie.ia.br/api/health apos o deploy.

## Pipeline de dados (Parquet para R2)

Dados da Receita Federal devem ir para Parquet e depois ao bucket indicie-cnpj.
Workflow stub: .github/workflows/pipeline-stub.yml (workflow_dispatch).

Opcao operacional: job de ingestao via imagem no GHCR (GitHub Container Registry) quando o pipeline estiver pronto — util para Actions ou runners self-hosted.

## Licenca

MIT
