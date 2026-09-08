import {
  filtersReady,
  formatResultsList,
  isGreeting,
  mergeFilters,
  nextFilterPrompt,
  parseFiltersFromMessage,
  type SearchFilters,
} from "./filters";
import {
  extractCnpj,
  fetchEmpresa,
  formatCnpj,
  money,
  r2HasIndex,
  runTool,
  type Empresa,
} from "./tools";

export type ChatTurn = { role: "user" | "assistant" | "system" | "tool"; content: string };

export interface AiEnv {
  AI: Ai;
  CNPJ_DATA: R2Bucket;
  AI_GATEWAY_ID?: string;
  AI_MODEL?: string;
}

export type ChatOut = {
  reply: string;
  empresa?: Empresa;
  source: string;
  filters?: SearchFilters;
  phase?: "collect_filters" | "results" | "detail" | "free";
  results?: unknown[];
};

const SYSTEM_FREE = `Você é o assistente da Indície (PT-BR) DEPOIS de uma lista de resultados ou de um CNPJ aberto.
Regras:
- Nunca invente dados. Use só fatos do contexto.
- Respostas curtas, markdown leve.
- Follow-ups: sócios, CNAE, endereço, capital, situação.
- Sem enrolação.`;

function gatewayOpts(env: AiEnv) {
  return { gateway: { id: env.AI_GATEWAY_ID || "indicie", skipCache: true } };
}

function modelId(env: AiEnv): string {
  return env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";
}

function extractText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (typeof o.response === "string") return o.response;
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
    const msg = o.message;
    if (msg && typeof msg === "object") {
      const c = (msg as Record<string, unknown>).content;
      if (typeof c === "string") return c;
    }
  }
  return "";
}

async function runLlm(env: AiEnv, messages: Array<Record<string, unknown>>): Promise<unknown> {
  return env.AI.run(modelId(env) as keyof AiModels, { messages } as any, gatewayOpts(env));
}

function wantsSearchNow(message: string): boolean {
  return /\b(buscar|busca|pesquisar|listar|pronto|fechar|ok|vamos)\b/i.test(message.trim());
}

function pickFromList(message: string, results: Array<Record<string, unknown>> | undefined): string | null {
  if (!results?.length) return null;
  const m = message.trim().match(/^(?:n[uú]mero\s*)?(\d{1,2})$/i);
  if (!m) return null;
  const idx = Number(m[1]) - 1;
  if (idx < 0 || idx >= results.length) return null;
  const cnpj = String(results[idx].cnpj || "");
  return cnpj.length === 14 ? cnpj : null;
}

export async function handleChatRules(
  message: string,
  env: AiEnv,
  lastEmpresa: Empresa | null,
): Promise<ChatOut> {
  const cnpj = extractCnpj(message);
  if (cnpj) {
    const result = await fetchEmpresa(cnpj);
    if (!result.ok) {
      return {
        reply:
          result.status === 404
            ? `Não achei o CNPJ \`${formatCnpj(cnpj)}\`. Confere os dígitos?`
            : result.error,
        source: "brasilapi",
        phase: "detail",
      };
    }
    const d = result.data;
    return {
      reply: [
        `**${String(d.razao_social || "Empresa")}** (\`${formatCnpj(cnpj)}\`)`,
        `${String(d.municipio || "")}/${String(d.uf || "")} · **${String(d.descricao_situacao_cadastral || "—")}** · aberta em ${String(d.data_inicio_atividade || "—")}`,
        `Atividade: ${String(d.cnae_fiscal ?? "")} ${String(d.cnae_fiscal_descricao || "")}`.trim(),
        "",
        "Pode pedir: sócios, endereço, CNAE, capital.",
      ].join("\n"),
      empresa: d,
      source: "brasilapi",
      phase: "detail",
    };
  }

  if (lastEmpresa) {
    const m = message.toLowerCase();
    if (/s[oó]cio|qsa|quadro/.test(m)) {
      const socios = Array.isArray(lastEmpresa.qsa) ? (lastEmpresa.qsa as Empresa[]) : [];
      if (!socios.length) {
        return { reply: "Não há QSA público.", empresa: lastEmpresa, source: "followup", phase: "free" };
      }
      return {
        reply: ["Sócios / QSA:", ...socios.slice(0, 12).map((s) => `• ${s.nome_socio} — ${s.qualificacao_socio}`)].join("\n"),
        empresa: lastEmpresa,
        source: "followup",
        phase: "free",
      };
    }
    if (/endere[cç]o|onde fica|localiza/.test(m)) {
      return {
        reply: `Endereço: ${[lastEmpresa.logradouro, lastEmpresa.numero, lastEmpresa.bairro, lastEmpresa.municipio, lastEmpresa.uf, lastEmpresa.cep].filter(Boolean).join(", ") || "—"}`,
        empresa: lastEmpresa,
        source: "followup",
        phase: "free",
      };
    }
    if (/cnae|atividade|ramo/.test(m)) {
      return {
        reply: `CNAE: ${lastEmpresa.cnae_fiscal ?? "—"} ${lastEmpresa.cnae_fiscal_descricao || ""}`.trim(),
        empresa: lastEmpresa,
        source: "followup",
        phase: "free",
      };
    }
    if (/capital/.test(m)) {
      return {
        reply: `Capital social: ${money(lastEmpresa.capital_social as number)}`,
        empresa: lastEmpresa,
        source: "followup",
        phase: "free",
      };
    }
  }

  return {
    reply: nextFilterPrompt({}),
    source: "form",
    phase: "collect_filters",
    filters: {},
  };
}

async function runSearch(env: AiEnv, filters: SearchFilters): Promise<ChatOut> {
  const hasIndex = await r2HasIndex(env.CNPJ_DATA);
  if (!hasIndex) {
    return {
      reply: [
        nextFilterPrompt(filters).split("\n").slice(0, 6).join("\n"),
        "",
        "Filtros ok, mas o **índice de estabelecimentos** ainda não está no R2 (`search_key` vazio).",
        "Manda um **CNPJ** pra consultar agora, ou aguarde a carga.",
      ].join("\n"),
      source: "form-pending-index",
      phase: "collect_filters",
      filters,
    };
  }

  const toolOut = await runTool(
    "busca_textual",
    {
      uf: filters.uf,
      municipio: filters.municipio,
      cnae: filters.cnae || filters.q,
      q: filters.q,
      situacao: filters.situacao,
      matriz_filial: filters.matriz_filial,
    },
    env,
  );
  let parsed: { ok?: boolean; results?: Array<Record<string, unknown>>; message?: string; error?: string } = {};
  try {
    parsed = JSON.parse(toolOut.content) as typeof parsed;
  } catch {
    parsed = { ok: false, message: toolOut.content };
  }
  if (!parsed.ok) {
    return {
      reply: parsed.message || parsed.error || "Busca falhou.",
      source: "busca",
      phase: "collect_filters",
      filters,
    };
  }
  const results = parsed.results || [];
  return {
    reply: formatResultsList(filters, results),
    source: "busca",
    phase: "results",
    filters,
    results,
  };
}

export async function handleChatAi(
  message: string,
  history: ChatTurn[],
  env: AiEnv,
  lastEmpresa: Empresa | null,
  priorFilters: SearchFilters | null = null,
  priorResults: Array<Record<string, unknown>> | null = null,
): Promise<ChatOut> {
  const trimmed = message.trim();

  const cnpjDirect = extractCnpj(trimmed);
  if (cnpjDirect) {
    return handleChatRules(trimmed, env, lastEmpresa);
  }

  const fromList = pickFromList(trimmed, priorResults || undefined);
  if (fromList) {
    return handleChatAi(fromList, history, env, lastEmpresa, priorFilters, priorResults);
  }

  if (lastEmpresa && history.length > 0) {
    try {
      const result = await runLlm(env, [
        { role: "system", content: SYSTEM_FREE },
        { role: "system", content: `Empresa em contexto:\n${JSON.stringify(lastEmpresa).slice(0, 6000)}` },
        ...history.filter((t) => t.role === "user" || t.role === "assistant").slice(-6),
        { role: "user", content: trimmed },
      ]);
      const text = extractText(result).trim();
      if (text) {
        return {
          reply: text,
          empresa: lastEmpresa,
          source: "ai-gateway",
          phase: "free",
          filters: priorFilters || undefined,
        };
      }
    } catch (err) {
      console.error("ai_gateway_error", err);
    }
    return handleChatRules(trimmed, env, lastEmpresa);
  }

  const hadResults = Boolean(priorResults?.length);
  if (hadResults && !parseFiltersFromMessage(trimmed).uf && !wantsSearchNow(trimmed)) {
    const patch = parseFiltersFromMessage(trimmed);
    if (Object.keys(patch).length) {
      const filters = mergeFilters(priorFilters, patch);
      if (filtersReady(filters)) {
        return runSearch(env, filters);
      }
      return { reply: nextFilterPrompt(filters), source: "form", phase: "collect_filters", filters };
    }
  }

  if (isGreeting(trimmed) && !priorFilters?.uf) {
    return {
      reply: ["Busca de empresas (Receita).", "", nextFilterPrompt({})].join("\n"),
      source: "form",
      phase: "collect_filters",
      filters: {},
    };
  }

  let patch = parseFiltersFromMessage(trimmed);

  // Slot-fill na ordem UF → município → CNAE (resposta curta preenche o próximo vazio)
  if (priorFilters?.uf && !priorFilters.municipio && !patch.municipio && !patch.uf && !patch.cnae && !patch.q) {
    patch.municipio = /^qualquer|todos|todas$/i.test(trimmed) ? "qualquer" : trimmed;
  } else if (
    priorFilters?.uf &&
    (priorFilters.municipio || patch.municipio) &&
    !priorFilters.cnae &&
    !priorFilters.q &&
    !patch.cnae &&
    !patch.q &&
    !patch.municipio
  ) {
    patch.cnae = trimmed;
  }

  const filters = mergeFilters(priorFilters, patch);

  // Nunca buscar sem formulário completo (mesmo com "buscar")
  if (!filtersReady(filters)) {
    return { reply: nextFilterPrompt(filters), source: "form", phase: "collect_filters", filters };
  }

  if (wantsSearchNow(trimmed) || filtersReady(filters)) {
    return runSearch(env, filters);
  }

  return { reply: nextFilterPrompt(filters), source: "form", phase: "collect_filters", filters };
}

export async function handleChatStream(
  message: string,
  history: ChatTurn[],
  env: AiEnv,
  lastEmpresa: Empresa | null,
): Promise<Response> {
  const out = await handleChatAi(message, history, env, lastEmpresa);
  if (out.phase === "collect_filters" || out.phase === "results") {
    return new Response(JSON.stringify({ ok: true, ...out }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response(JSON.stringify({ ok: true, ...out }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
