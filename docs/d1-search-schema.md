# D1 search schema (proposto — draft, não live)

Proposta de espelho/índice auxiliar em Cloudflare D1 para busca textual leve. **Não há binding D1 no `wrangler.jsonc` atual**; isto é só documentação.

## Motivação

- Parquet em R2 = fonte canônica / varredura / join pesado.
- D1 = lookup por prefixo / FTS aproximado / metadados de snapshot sem baixar Parquet inteiro.

## Tabelas propostas

### `snapshots`

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | TEXT PK | ex. `2026-08` |
| `source` | TEXT | |
| `generated_at` | TEXT | ISO-8601 |
| `sample` | INTEGER | 0/1 |
| `search_key` | TEXT NULL | chave R2 de `estab_empresa` |
| `manifest_json` | TEXT | cópia do manifest |

### `estab_empresa` (espelho parcial)

| Coluna | Tipo |
|--------|------|
| `snapshot_id` | TEXT |
| `cnpj` | TEXT PK (composto com snapshot) |
| `cnpj_basico` | TEXT |
| `razao_social` | TEXT |
| `nome_fantasia` | TEXT |
| `situacao_cadastral` | TEXT |
| `cnae_fiscal_principal` | TEXT |
| `uf` | TEXT |
| `municipio` | TEXT |
| `cep` | TEXT |
| `porte` | TEXT |
| `natureza_juridica` | TEXT |
| `matriz_filial` | TEXT |
| `search_norm` | TEXT |

Índices sugeridos: `(snapshot_id, uf)`, `(snapshot_id, cnae_fiscal_principal)`, FTS virtual em `search_norm` / razão social (avaliar `fts5`).

### `cnaes`

| Coluna | Tipo |
|--------|------|
| `codigo` | TEXT PK |
| `descricao` | TEXT |
| `snapshot_id` | TEXT |

## SQL ilustrativo (não aplicado)

```sql
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0,
  search_key TEXT,
  manifest_json TEXT
);

CREATE TABLE IF NOT EXISTS estab_empresa (
  snapshot_id TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  cnpj_basico TEXT,
  razao_social TEXT,
  nome_fantasia TEXT,
  situacao_cadastral TEXT,
  cnae_fiscal_principal TEXT,
  uf TEXT,
  municipio TEXT,
  cep TEXT,
  porte TEXT,
  natureza_juridica TEXT,
  matriz_filial TEXT,
  search_norm TEXT,
  PRIMARY KEY (snapshot_id, cnpj)
);

CREATE INDEX IF NOT EXISTS idx_estab_uf ON estab_empresa (snapshot_id, uf);
CREATE INDEX IF NOT EXISTS idx_estab_cnae ON estab_empresa (snapshot_id, cnae_fiscal_principal);
```

## Status

- Draft only — sem migration, sem binding, sem população.
- Fonte da verdade do contrato de colunas/prefixos: `docs/r2-search-contract.md`.
