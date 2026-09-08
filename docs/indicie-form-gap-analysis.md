# Indície — gap analysis do formulário de busca

Atualizado: 2026-09-08  
Live: https://indicie.jhonata-emerick.workers.dev  
Repo: https://github.com/comeca-ai/indice

## Form atual (live)

Ordem obrigatória antes da resposta:

1. **UF**
2. **Município** (`qualquer` permitido)
3. **CNAE / atividade**
4. **Situação** (`ATIVA` / `BAIXADA` / `qualquer`)
5. **Matriz / filial / ambas**

Depois: tenta lista via R2 (`search_key`). Hoje o índice ainda pode estar vazio → pede CNPJ ou aguarda **carga**.  
CNPJ 14 dígitos: atalho para detalhe (BrasilAPI), pula o formulário.

## Gap vs evidência cnpj.chat + clássicos

| Capacidade | Indície agora | Concorrente / clássico | Prioridade |
| --- | --- | --- | --- |
| UF + município + CNAE | ✅ | ✅ | — |
| Situação | ✅ | ✅ | — |
| Matriz/filial | ✅ | ✅ | — |
| Prefixo razão social | ❌ | ✅ (param + recipe) | **P0** |
| Prefixo nome fantasia | ❌ | ✅ (param) | **P0** |
| Faixa de datas (`data_inicio`) | ❌ | ✅ (`dates` / APIs) | **P1** |
| Paginação | ❌ (lista curta) | ✅ `page` | **P1** |
| Porte | ❌ | clássico APIs | **P1** |
| Capital social min/max | ❌ | clássico APIs | **P2** |
| CNAE secundário | ❌ | clássico | **P2** |
| Natureza jurídica | ❌ | avançado | **P2** |
| MEI / Simples flags | ❌ | lead-gen clássico | **P2** |
| CEP / bairro | ❌ | avançado | **P3** |
| Sócio (nome) | ❌ | avançado | **P3** |
| Result columns: empresa, local, situação, aberta em, atividade | parcial (quando índice) | tabela clássica | **P0** (quando R2 ok) |

## Por que o form “parece fraco”

1. Coleta 5 campos de geo/atividade/status, mas **não pergunta o nome** (razão/fantasia) — o caso mais comum do dataset.
2. Sem **datas** / **porte** / **capital**, a lista (quando existir) vira dump genérico.
3. Dependência de índice R2 ainda vazio: formulário completo ainda desemboca em “manda CNPJ”.
4. Chat-form é linear (bom), mas falta **resumo editável** dos filtros (chips removíveis) como tela clássica.

## Backlog proposto (Indície)

### P0 — vencer o mínimo do `/buscar`

- Campo **razão social (prefixo)** e **nome fantasia (prefixo)** no formulário (após CNAE ou antes, A/B).
- Garantir shard R2 `estab_empresa` + `search_key` (**carga**) com colunas: cnpj, razão, fantasia, uf, município, situação, matriz, cnae, data_inicio.
- Tabela de resultados estável: empresa/CNPJ, local, situação, aberta em, atividade.

### P1 — tela “séria” sem virar lixão

- Date range abertura.
- Porte.
- Paginação / “carregar mais”.
- UI de chips: cada filtro coletado vira chip editável (não só markdown).

### P2 — power filters (atrás de “Mais filtros”)

- Capital min/max, CNAE secundário, natureza jurídica, MEI/Simples.

### P3 — depois do core

- CEP/bairro, sócio.

## Ownership

| Área | Bot |
| --- | --- |
| Inventário UX / docs / proposta de form | **lente** |
| Chat + ordem das perguntas | **cérebro** |
| Colunas R2 / ingest | **carga** |
| Auth / download setor | **porteiro** |

## Referências

- [competitor-filters.md](./competitor-filters.md)
- https://cnpj.chat/
- https://github.com/caiopizzol/cnpj-data-pipeline
