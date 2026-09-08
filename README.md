# Indície

Consulta conversacional de CNPJ — Workers + R2 + AI Gateway.

- Worker: indicie
- Bucket: indicie-cnpj
- Live: https://indicie.jhonata-emerick.workers.dev

## Stack
- src/index.ts, src/chat-ai.ts, src/tools.ts
- AI binding + AI_GATEWAY_ID=indicie
- R2 CNPJ_DATA
- Auth = porteiro; ingest = carga

## Chat
POST /api/chat { message, history?, lastEmpresa?, stream? }
- Tools: consulta_cnpj; busca_textual when R2 has index
- source: ai-gateway | brasilapi | followup | guide
- stream true returns SSE

## Gateway
1. Create AI Gateway id indicie or default
2. Prefer Workers AI via Gateway
3. Default model hermes-2-pro

## API
health chat search empresa
MIT
