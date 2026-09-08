# pipelines/cnpj — sample Cnaes → Parquet

Converte `Cnaes.zip` (Receita WebDAV, Latin-1 `;` sem header) em Parquet ZSTD.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run

```bash
.venv/bin/python sample_cnaes_to_parquet.py --snapshot 2026-08
# ou, se o zip já estiver em data/:
.venv/bin/python sample_cnaes_to_parquet.py --snapshot 2026-08 --skip-download
```

Saída: `out/parquet/2026-08/cnaes/cnaes.parquet`

Upload R2 (fora deste script): chave `parquet/2026-08/cnaes/cnaes.parquet` no bucket `indicie-cnpj`. Ver `docs/cnpj-ingest.md` e `docs/r2-search-contract.md`.

**NEED_LICENSE_REVIEW:** não vendorar `ghcr.io/caiopizzol/cnpj-data-pipeline` — runner externo apenas.
