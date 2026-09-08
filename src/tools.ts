/** Tools CNPJ — lookup live; busca textual via contrato R2 (docs/r2-search-contract.md). */

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

/** Contrato carga: índice ativo = manifests/latest.json presente e legível. */
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
  q: string,
  uf?: string,
  limit = 20,
): Promise<
  | { ok: true; snapshot: string; search_key: string; results: SearchHit[] }
  | { ok: false; error: string; message: string }
> {
  const manifest = await readSearchManifest(bucket);
  if (!manifest) {
    return {
      ok: false,
      error: "indice_indisponivel",
      message: "Índice R2 ainda vazio (sem manifests/latest.json). Peça um CNPJ ou aguarde a carga.",
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
  const needle = normalizeSearch(q);
  const ufNorm = uf ? uf.trim().toUpperCase() : "";

  // Sample/nacional: lê objetos e filtra em memória (ok pra sample; D1 FTS vem da carga depois).
  const rows = (await parquetReadObjects({ file: buf })) as Record<string, unknown>[];
  const results: SearchHit[] = [];

  for (const row of rows) {
    if (ufNorm) {
      const rowUf = String(row.uf ?? "").toUpperCase();
      if (rowUf !== ufNorm) continue;
    }
    const hay = normalizeSearch(
      String(row.search_norm ?? `${row.razao_social ?? ""} ${row.nome_fantasia ?? ""}`),
    );
    if (!needle || hay.includes(needle)) {
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
      });
      if (results.length >= limit) break;
    }
  }

  return {
    ok: true,
    snapshot: manifest.snapshot,
    search_key: manifest.search_key,
    results,
  };
}

/** Schema OpenAI-style / Workers AI tools */
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
      description:
        "Consulta dados públicos de um CNPJ na Receita (via BrasilAPI). Use sempre que o usuário informar ou pedir dados de um CNPJ específico.",
      parameters: {
        type: "object",
        properties: {
          cnpj: {
            type: "string",
            description: "CNPJ com 14 dígitos (com ou sem máscara).",
          },
        },
        required: ["cnpj"],
      },
    },
  ];
  if (hasIndex) {
    tools.push({
      name: "busca_textual",
      description:
        "Busca empresas no índice nacional R2 (search_norm / razão / fantasia), com UF opcional. Use quando NÃO houver CNPJ e o usuário pedir lista/filtro.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Texto de busca (razão social, fantasia, cidade…)." },
          uf: { type: "string", description: "UF opcional (2 letras)." },
        },
        required: ["q"],
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
    return {
      content: JSON.stringify(result.data),
      empresa: result.data,
    };
  }

  if (name === "busca_textual") {
    const q = String(args.q ?? "").trim();
    const uf = args.uf != null ? String(args.uf) : undefined;
    if (!q) {
      return { content: JSON.stringify({ error: "q_obrigatorio" }) };
    }
    try {
      const out = await buscaTextualR2(env.CNPJ_DATA, q, uf);
      return { content: JSON.stringify(out) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "busca_falhou";
      return {
        content: JSON.stringify({
          ok: false,
          error: "parquet_erro",
          message,
        }),
      };
    }
  }

  return { content: JSON.stringify({ error: "tool_desconhecida", name }) };
}
