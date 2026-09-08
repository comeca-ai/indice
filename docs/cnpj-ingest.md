# CNPJ ingest — fontes e pipeline

Draft operacional do Indície. Sem secrets; carga nacional ainda não está no R2 (só sample Cnaes).

## Fontes oficiais

| Fonte | URL / id | Notas |
|-------|----------|--------|
| WebDAV Receita (share público) | `https://arquivos.receitafederal.gov.br/public.php/webdav/` — share `YggdBLfdninEJX9` | Download dos ZIPs mensais (`YYYY-MM/Nome.zip`). Auth básica: usuário = id do share, senha vazia. |
| Portal dados.gov.br | [Dados Abertos CNPJ](https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj) | Catálogo / metadados. |
| Metadados PDF | PDF de metadados no mesmo pacote / portal | Layout das tabelas, códigos e campos. |
| NT COCAD 47/2024 | Nota técnica mensal COCAD | Mudanças de layout / calendário de publicação. |

### Pacote mensal (layout atual)

- **Encoding:** Latin-1 (ISO-8859-1)
- **Separador:** `;`
- **Header:** ausente (sem linha de cabeçalho)
- **Arquivos:** ~37 ZIPs por competência (empresas, estabelecimentos, sócios, simples, CNAEs, motivos, municípios, naturezas, países, qualificações, etc.)
- **Snapshot de referência neste draft:** `2026-08` (último pacote usado no sample)

Exemplo de download (Cnaes):

```bash
curl -u 'YggdBLfdninEJX9:' -OJ \
  https://arquivos.receitafederal.gov.br/public.php/webdav/2026-08/Cnaes.zip
```

## Pipeline alvo: CSV → Parquet → R2

1. Baixar ZIPs do WebDAV (competência `YYYY-MM`).
2. Extrair CSVs Latin-1 `;` sem header; tipar colunas conforme metadados.
3. Converter para **Parquet** (compressão **ZSTD**), particionado por tabela sob o prefixo contratado (ver `docs/r2-search-contract.md`).
4. Upload para o bucket R2 `indicie-cnpj` (binding Worker: `CNPJ_DATA`).
5. Publicar / atualizar `manifests/latest.json`.
6. Validar `GET /api/health` (sampleKeys / presença de objetos).

Sample local: `pipelines/cnpj/` (`sample_cnaes_to_parquet.py`).

## Imagem GHCR — NEED_LICENSE_REVIEW

A imagem [`ghcr.io/caiopizzol/cnpj-data-pipeline`](https://ghcr.io/caiopizzol/cnpj-data-pipeline) pode acelerar o job de ingestão em runner **externo**.

- **NEED_LICENSE_REVIEW** — não vendorar o código-fonte no repositório Indície.
- Uso permitido apenas como **runner externo** (pull da imagem + execução), sem copiar/vendorar o source de caiopizzol neste tree.
- Antes de uso em produção/CI: revisar licença, termos do GHCR e atribuição.

Workflow stub: `.github/workflows/pipeline-stub.yml` (somente `workflow_dispatch`; não executa ingestão ainda).

## Fora de escopo deste draft

- Carga nacional completa de estabelecimentos / `estab_empresa.parquet`
- Implementação de `busca_textual` no Worker (contrato documentado; código ainda stub)
