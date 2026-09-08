/** Tools CNPJ — lookup live; busca textual via contrato R2 da carga. */

import { parquetReadObjects } from "hyparquet";

export type Empresa = Record<string, unknown>;

export type SearchManifest = {
  snapshot: string;
  source?: string;
  generated_at?: string;
  search_key: string;
  tables?: Record<string, string>;
};

export type SearchHit = {
  cnpj: string;
  cnpj_basico?: string;
  razao_social?: string;
  nome_fantasia?: string;
  situacao_cadastral?: string;
  cnae_fiscal_principal?: string;
  uf?: string;
  municipio?: string;
  cep?: string;
  porte?: string;
  natureza_juridica?: string;
  matriz_filial?: string;
  data_inicio_atividade?: string;
};

export type BuscaFiltros = {
  q?: string;
  uf?: string;
  municipio?: string;
  cnae?: string;
  situacao?: string;
  matriz_filial?: string;
  limit?: number;
};

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

export function extractCnpj(text: string): string | null {
  const digits = onlyDigits(text);
  if (digits.length === 14) return digits;
  const m = text.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
  if (!m) return null;
  const d = onlyDigits(m[0]);
  return d.length === 14 ? d : null;
}

export function formatCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function money(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export async function fetchEmpresa(
  cnpj: string,
): Promise<{ ok: true; data: Empresa } | { ok: false; status: number; error: string }> {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: { accept: "application/json" },
  });
  if (res.status === 404) return { ok: false, status: 404, error: "CNPJ não encontrado." };
  if (!res.ok) return { ok: false, status: res.status, error: `Falha na consulta (${res.status}).` };
  return { ok: true, data: (await res.json()) as Empresa };
}

/** Índice de busca ativo = manifests/latest.json com search_key preenchido. */
export async function readSearchManifest(bucket: R2Bucket): Promise<SearchManifest | null> {
  const obj = await bucket.get("manifests/latest.json");
  if (!obj) return null;
  try {
    const data = (await obj.json()) as SearchManifest;
    if (!data?.snapshot || !data?.search_key) return null;
    return data;
  } catch {
    return null;
  }
}

export async function r2HasIndex(bucket: R2Bucket): Promise<boolean> {
  return (await readSearchManifest(bucket)) != null;
}

export async function buscaTextualR2(
  bucket: R2Bucket,
  filtros: BuscaFiltros,
): Promise<
  | { ok: true; snapshot: string; search_key: string; results: SearchHit[] }
  | { ok: false; error: string; message: string }
> {
  const limit = filtros.limit ?? 20;
  const manifest = await readSearchManifest(bucket);
  if (!manifest) {
    return {
      ok: false,
      error: "indice_indisponivel",
      message:
        "Índice de estabelecimentos ainda não disponível (search_key vazio). Manda um CNPJ ou aguarde a carga.",
    };
  }

  const fileObj = await bucket.get(manifest.search_key);
  if (!fileObj) {
    return {
      ok: false,
      error: "search_key_ausente",
      message: `Manifest aponta ${manifest.search_key}, mas o objeto não está no R2.`,
    };
  }

  const buf = await fileObj.arrayBuffer();
  const ufNorm = filtros.uf ? filtros.uf.trim().toUpperCase() : "";
  const munNorm = filtros.municipio ? normalizeSearch(filtros.municipio) : "";
  const cnaeRaw = filtros.cnae || "";
  const cnaeDigits = onlyDigits(cnaeRaw);
  const cnaeText = cnaeDigits.length >= 4 ? "" : normalizeSearch(cnaeRaw);
  const sitNorm = filtros.situacao ? normalizeSearch(filtros.situacao) : "";
  const matriz = filtros.matriz_filial ? String(filtros.matriz_filial) : "";
  const qNorm = filtros.q ? normalizeSearch(filtros.q) : "";

  const rows = (await parquetReadObjects({ file: buf })) as Record<string, unknown>[];
  const results: SearchHit[] = [];

  for (const row of rows) {
    if (ufNorm && String(row.uf ?? "").toUpperCase() !== ufNorm) continue;
    if (munNorm && !normalizeSearch(String(row.municipio ?? "")).includes(munNorm)) continue;
    if (cnaeDigits.length >= 4) {
      const rowCnae = onlyDigits(String(row.cnae_fiscal_principal ?? ""));
      if (!rowCnae.startsWith(cnaeDigits)) continue;
    } else if (cnaeText) {
      const blob = normalizeSearch(
        `${row.cnae_fiscal_principal ?? ""} ${row.search_norm ?? ""} ${row.razao_social ?? ""}`,
      );
      if (!blob.includes(cnaeText)) continue;
    }
    if (sitNorm && !normalizeSearch(String(row.situacao_cadastral ?? "")).includes(sitNorm)) continue;
    if (matriz && String(row.matriz_filial ?? "") !== matriz) continue;
    if (qNorm) {
      const hay = normalizeSearch(
        String(row.search_norm ?? `${row.razao_social ?? ""} ${row.nome_fantasia ?? ""}`),
      );
      if (!hay.includes(qNorm)) continue;
    }

    results.push({
      cnpj: onlyDigits(String(row.cnpj ?? "")),
      cnpj_basico: row.cnpj_basico != null ? String(row.cnpj_basico) : undefined,
      razao_social: row.razao_social != null ? String(row.razao_social) : undefined,
      nome_fantasia: row.nome_fantasia != null ? String(row.nome_fantasia) : undefined,
      situacao_cadastral: row.situacao_cadastral != null ? String(row.situacao_cadastral) : undefined,
      cnae_fiscal_principal: row.cnae_fiscal_principal != null ? String(row.cnae_fiscal_principal) : undefined,
      uf: row.uf != null ? String(row.uf) : undefined,
      municipio: row.municipio != null ? String(row.municipio) : undefined,
      cep: row.cep != null ? String(row.cep) : undefined,
      porte: row.porte != null ? String(row.porte) : undefined,
      natureza_juridica: row.natureza_juridica != null ? String(row.natureza_juridica) : undefined,
      matriz_filial: row.matriz_filial != null ? String(row.matriz_filial) : undefined,
      data_inicio_atividade:
        row.data_inicio_atividade != null ? String(row.data_inicio_atividade) : undefined,
    });
    if (results.length >= limit) break;
  }

  return {
    ok: true,
    snapshot: manifest.snapshot,
    search_key: manifest.search_key,
    results,
  };
}

export function buildTools(hasIndex: boolean) {
  const tools: Array<{
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  }> = [
    {
      name: "consulta_cnpj",
      description: "Consulta CNPJ público (BrasilAPI). Use quando houver CNPJ de 14 dígitos.",
      parameters: {
        type: "object",
        properties: {
          cnpj: { type: "string", description: "CNPJ 14 dígitos." },
        },
        required: ["cnpj"],
      },
    },
  ];
  if (hasIndex) {
    tools.push({
      name: "busca_textual",
      description:
        "Lista empresas no R2 com filtros UF + município/CNAE (situação e matriz/filial opcionais). Sem bate-papo.",
      parameters: {
        type: "object",
        properties: {
          uf: { type: "string", description: "UF 2 letras." },
          municipio: { type: "string", description: "Município." },
          cnae: { type: "string", description: "CNAE ou atividade." },
          q: { type: "string", description: "Texto livre opcional." },
          situacao: { type: "string", description: "ATIVA/BAIXADA/…" },
          matriz_filial: { type: "string", description: "1=matriz 2=filial" },
        },
        required: ["uf"],
      },
    });
  }
  return tools;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  env: { CNPJ_DATA: R2Bucket },
): Promise<{ content: string; empresa?: Empresa }> {
  if (name === "consulta_cnpj") {
    const cnpj = onlyDigits(String(args.cnpj ?? ""));
    if (cnpj.length !== 14) {
      return { content: JSON.stringify({ error: "cnpj_invalido", cnpj }) };
    }
    const result = await fetchEmpresa(cnpj);
    if (!result.ok) {
      return { content: JSON.stringify({ error: result.error, status: result.status, cnpj }) };
    }
    return { content: JSON.stringify(result.data), empresa: result.data };
  }

  if (name === "busca_textual") {
    const uf = args.uf != null ? String(args.uf).trim() : "";
    if (!uf) return { content: JSON.stringify({ error: "uf_obrigatorio" }) };
    try {
      const out = await buscaTextualR2(env.CNPJ_DATA, {
        uf,
        q: args.q != null ? String(args.q) : undefined,
        municipio: args.municipio != null ? String(args.municipio) : undefined,
        cnae: args.cnae != null ? String(args.cnae) : undefined,
        situacao: args.situacao != null ? String(args.situacao) : undefined,
        matriz_filial: args.matriz_filial != null ? String(args.matriz_filial) : undefined,
      });
      return { content: JSON.stringify(out) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "busca_falhou";
      return { content: JSON.stringify({ ok: false, error: "parquet_erro", message }) };
    }
  }

  return { content: JSON.stringify({ error: "tool_desconhecida", name }) };
}
