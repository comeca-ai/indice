# R2 search contract — `indicie-cnpj`

Binding Worker: `CNPJ_DATA` → bucket `indicie-cnpj`.

## Prefixos exatos

```
parquet/{snapshot}/empresas/
parquet/{snapshot}/estabelecimentos/
parquet/{snapshot}/socios/
parquet/{snapshot}/simples/
parquet/{snapshot}/cnaes/
parquet/{snapshot}/motivos/
parquet/{snapshot}/municipios/
parquet/{snapshot}/naturezas/
parquet/{snapshot}/paises/
parquet/{snapshot}/qualificacoes/
search/{snapshot}/estab_empresa.parquet
manifests/latest.json
```

`{snapshot}` = competência `YYYY-MM` (ex.: `2026-08`).

## `search/{snapshot}/estab_empresa.parquet`

Colunas (ordem lógica; tipos a refinar na carga):

| Coluna | Descrição |
|--------|-----------|
| `cnpj` | 14 dígitos |
| `cnpj_basico` | 8 dígitos |
| `razao_social` | Razão social |
| `nome_fantasia` | Nome fantasia |
| `situacao_cadastral` | Código / situação |
| `cnae_fiscal_principal` | CNAE principal |
| `uf` | UF |
| `municipio` | Município |
| `cep` | CEP |
| `porte` | Porte |
| `natureza_juridica` | Natureza jurídica |
| `matriz_filial` | Matriz / filial |
| `search_norm` | Texto normalizado para busca |

Ainda **não** carregado no sample (só Cnaes).

## `manifests/latest.json`

Exemplo (sample):

```json
{
  "snapshot": "2026-08",
  "source": "arquivos.receitafederal.gov.br",
  "generated_at": "<ISO-8601>",
  "sample": true,
  "note": "sample Cnaes only — national estab_empresa not loaded yet",
  "search_key": null,
  "tables": {
    "cnaes": "parquet/2026-08/cnaes/"
  }
}
```

Quando a carga nacional existir: `sample: false`, `search_key` apontando para `search/{snapshot}/estab_empresa.parquet`, e `tables` com os demais prefixos.

## Uso no Worker

- `/api/health` lista objetos / sampleKeys do bucket.
- `busca_textual` deve ler este contrato (ver stub em `src/tools.ts`) — **não implementada** além da detecção de índice.
