# Inventário de filtros — busca CNPJ (concorrentes)

Atualizado: 2026-09-08  
Escopo: documentar filtros clássicos de telas/APIs de busca de empresas BR, com foco em [cnpj.chat](https://cnpj.chat/) e padrões de mercado.  
**Não inventamos o DOM de `/buscar`**: o browser Indície foi bloqueado pelo Cloudflare (“Performing security verification”).

## A) Evidência pública — cnpj.chat

| Campo / parâmetro | Evidência | Notas |
| --- | --- | --- |
| Razão social | Homepage: “Prefere filtros? Buscar por razão social, UF e situação” | Filtro explícito no copy da home |
| UF | Mesmo copy + páginas agregadas “Por estado” | Obrigatório/central no funil |
| Situação cadastral | Mesmo copy | Ativas vs outras |
| Município / cidade | Chips (“Restaurantes em Florianópolis”); diretório “Por cidade” | Localização |
| CNAE / atividade | Chips + “Por atividade (CNAE)” | Ex.: restaurantes, dentistas |
| `uf` | Params observados em links/código público | Query string |
| `municipio` | Idem | |
| `cnae` | Idem | |
| `cnpj` | Idem | Lookup direto |
| `razao_social_prefix` | Idem | Prefixo (não substring) |
| `nome_fantasia_prefix` | Idem | Prefixo fantasia |
| `situacao` | Idem | |
| `matriz` | Idem | Matriz vs filial |
| `dates` | Idem | Faixa de datas (abertura / situação — não confirmado no UI) |
| `page` | Idem | Paginação |
| `src` | Idem | Origem/telemetria? |

### Serving table pública (pipeline open-source)

Fonte (cita URL, **não** vendemos SQL):  
https://raw.githubusercontent.com/caiopizzol/cnpj-data-pipeline/main/recipes/postgres/empresas_busca_nome.sql  

Padrão de acesso descrito na receita:

- busca por **prefixo de `razao_social`**
- opcionalmente **UF / município / CNAE**
- default da serving table: **só matriz ativa** (`situacao_cadastral = '02'`, `identificador_matriz_filial = 1`)
- colunas materializadas relevantes: `cnpj`, `razao_social`, `nome_fantasia`, `uf`, `municipio_*`, `situacao_cadastral`, `identificador_matriz_filial`, `cnae_*`, `data_inicio_atividade`

Homepage do produto: https://cnpj.chat/  
Pipeline: https://github.com/caiopizzol/cnpj-data-pipeline (homepage aponta para cnpj.chat)

## B) Filtros clássicos de mercado (APIs / telas “de busca de empresa”)

Estes campos aparecem de forma repetida em produtos BR de prospecção/consulta. Fontes:

- [CNPJota — busca com filtros](https://www.cnpjota.com.br/)
- [CNPJws — pesquisa de empresas](https://docs.cnpj.ws/referencia-de-api/api-comercial/pesquisa-de-empresas)
- [BuscaLead API](https://docs.buscalead.com/)
- [CNPJ Aberto — busca avançada](https://cnpjaberto.com.br/api-docs)

| Campo | Tipo típico | Obrig.? | Por que existe |
| --- | --- | --- | --- |
| UF / estado | select | quase sempre | Cardinalidade e performance |
| Município / city_code / IBGE | select/autocomplete | comum | Narrow geográfico |
| CNAE principal | código ou texto | comum | Atividade |
| CNAE secundário | código | opcional | Ampliar match |
| Situação cadastral | enum (ativa/baixada/…) | comum | Default “ativa” em várias APIs |
| Matriz / filial | enum | comum | Lead gen quer matriz |
| Razão social | texto / prefix | comum | Nome legal |
| Nome fantasia | texto / prefix | comum | Nome comercial |
| Porte | enum | clássico “tela cheia” | Micro/pequeno/demais |
| Capital social min/max | range | clássico | Qualificação B2B |
| Data início atividade de/até | date range | clássico | Empresas novas vs maduras |
| Natureza jurídica | código | avançado | LTDA, SA, MEI… |
| CEP | texto | avançado | Microgeo |
| Nome do sócio | texto | avançado | Rede societária |
| MEI / Simples | flags | clássico lead-gen | Incluir/excluir MEI |
| Paginação (`page`/`limit`) | int | sempre | Listas grandes |

## C) Não verificado (bloqueio Cloudflare em `/buscar`)

Não foi possível inventariar no DOM:

- labels exatos dos controles
- ordem visual do formulário
- campos advanced/collapsed
- colunas da tabela de resultados
- empty states / CTAs
- se `dates` mapeia abertura, situação ou ambos

Quando o challenge cair, atualizar a seção A com screenshot + labels reais (job do bot **lente**).

## Leitura de produto

Telas “ruins” de busca CNPJ costumam:

1. Despejar 12+ filtros de uma vez (porte, capital, MEI, CEP…) sem defaults.
2. Ou o oposto: chat sem parâmetros explícitos e lista inventada/fraca.
3. Esconder **razão/fantasia prefix** e **datas**, que são o padrão de ouro do dataset Receita.

Indície hoje está no meio: formulário guiado (bom), mas ainda magro vs clássicos — ver [indicie-form-gap-analysis.md](./indicie-form-gap-analysis.md).
