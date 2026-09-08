/** Tools CNPJ — lookup live; busca textual só com índice R2 (carga). */

export type Empresa = Record<string, unknown>;

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

export async function r2HasIndex(bucket: R2Bucket): Promise<boolean> {
  const listed = await bucket.list({ limit: 1 });
  return listed.objects.length > 0;
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
        "Busca empresas no índice nacional R2 por nome, município, UF ou CNAE. Use quando NÃO houver CNPJ e o usuário pedir lista/filtro.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Texto de busca (razão social, cidade, CNAE…)." },
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
    const has = await r2HasIndex(env.CNPJ_DATA);
    if (!has) {
      return {
        content: JSON.stringify({
          error: "indice_indisponivel",
          message: "Índice R2 ainda vazio. Peça um CNPJ ou aguarde a carga nacional.",
        }),
      };
    }
    // Contrato do índice: a definir com carga (prefixo/schema). Stub honesto.
    return {
      content: JSON.stringify({
        error: "busca_nao_implementada",
        message: "Índice R2 detectado, mas o contrato de busca ainda não foi ligado (aguardando carga).",
        q: args.q ?? null,
        uf: args.uf ?? null,
      }),
    };
  }

  return { content: JSON.stringify({ error: "tool_desconhecida", name }) };
}
