import {
  buildTools,
  extractCnpj,
  fetchEmpresa,
  formatCnpj,
  money,
  onlyDigits,
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

const SYSTEM = `Você é o assistente da Indície (PT-BR). Ajuda a consultar CNPJs públicos da Receita Federal.
Regras:
- Nunca invente dados de empresa. Use a tool consulta_cnpj para fatos.
- Se não houver CNPJ e a busca textual não estiver disponível, peça um CNPJ (ex.: 00.000.000/0001-91).
- Respostas curtas, claras, com markdown leve (**negrito**, \`código\`).
- Follow-ups (sócios, CNAE, endereço, capital) usam o contexto da última empresa ou nova consulta.
- Dados são públicos; não peça CPF/senha.`;

type ToolCall = { name: string; arguments: Record<string, unknown> };

function gatewayOpts(env: AiEnv) {
  return {
    gateway: {
      id: env.AI_GATEWAY_ID || "indicie",
      skipCache: true,
    },
  };
}

function modelId(env: AiEnv): string {
  return env.AI_MODEL || "@hf/nousresearch/hermes-2-pro-mistral-7b";
}

function extractText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (typeof o.response === "string") return o.response;
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
  }
  return "";
}

function extractToolCalls(result: unknown): ToolCall[] {
  if (!result || typeof result !== "object") return [];
  const o = result as Record<string, unknown>;
  const raw = o.tool_calls;
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const name = String(t.name || "");
    let args: Record<string, unknown> = {};
    const a = t.arguments;
    if (typeof a === "string") {
      try {
        args = JSON.parse(a) as Record<string, unknown>;
      } catch {
        args = {};
      }
    } else if (a && typeof a === "object") {
      args = a as Record<string, unknown>;
    }
    if (name) out.push({ name, arguments: args });
  }
  return out;
}

/** Fallback determinístico (live atual) se AI falhar. */
export async function handleChatRules(
  message: string,
  env: AiEnv,
  lastEmpresa: Empresa | null,
): Promise<{ reply: string; empresa?: Empresa; source: string }> {
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
      };
    }
    const d = result.data;
    return {
      reply: [
        `Aqui está **${String(d.razao_social || "a empresa")}** (\`${formatCnpj(cnpj)}\`).`,
        `Situação **${String(d.descricao_situacao_cadastral || "—")}** · ${String(d.municipio || "")}/${String(d.uf || "")}.`,
        `Pode perguntar: sócios, CNAE, endereço, capital…`,
      ].join("\n"),
      empresa: d,
      source: "brasilapi",
    };
  }

  if (lastEmpresa) {
    const m = message.toLowerCase();
    if (/s[oó]cio|qsa|quadro/.test(m)) {
      const socios = Array.isArray(lastEmpresa.qsa) ? (lastEmpresa.qsa as Empresa[]) : [];
      if (!socios.length) return { reply: "Não há QSA público para essa empresa.", empresa: lastEmpresa, source: "followup" };
      return {
        reply: ["Sócios / QSA:", ...socios.slice(0, 12).map((s) => `• ${s.nome_socio} — ${s.qualificacao_socio}`)].join("\n"),
        empresa: lastEmpresa,
        source: "followup",
      };
    }
    if (/endere[cç]o|onde fica|localiza/.test(m)) {
      return {
        reply: `Endereço: ${[lastEmpresa.logradouro, lastEmpresa.numero, lastEmpresa.bairro, lastEmpresa.municipio, lastEmpresa.uf, lastEmpresa.cep].filter(Boolean).join(", ") || "—"}`,
        empresa: lastEmpresa,
        source: "followup",
      };
    }
    if (/cnae|atividade|ramo/.test(m)) {
      return {
        reply: `CNAE principal: ${lastEmpresa.cnae_fiscal ?? "—"} ${lastEmpresa.cnae_fiscal_descricao || ""}`.trim(),
        empresa: lastEmpresa,
        source: "followup",
      };
    }
    if (/capital/.test(m)) {
      return { reply: `Capital social: ${money(lastEmpresa.capital_social as number)}`, empresa: lastEmpresa, source: "followup" };
    }
    if (/fantasia|nome/.test(m)) {
      return {
        reply: `Razão: **${lastEmpresa.razao_social}**\nFantasia: ${lastEmpresa.nome_fantasia || "—"}`,
        empresa: lastEmpresa,
        source: "followup",
      };
    }
    if (/situa[cç][aã]o|ativa|baixada/.test(m)) {
      return {
        reply: `Situação cadastral: **${lastEmpresa.descricao_situacao_cadastral || "—"}**`,
        empresa: lastEmpresa,
        source: "followup",
      };
    }
  }

  const hasIndex = await r2HasIndex(env.CNPJ_DATA);
  if (!hasIndex) {
    return {
      reply: [
        "Ainda não tenho índice nacional no R2 pra busca por nome/cidade/CNAE (tipo “restaurantes em Florianópolis”).",
        "",
        "Por enquanto: me manda um **CNPJ** e a gente conversa em cima dele — sócios, endereço, CNAE, capital.",
        "",
        "Exemplos: `00.000.000/0001-91` · `33.000.167/0001-01`",
      ].join("\n"),
      source: "guide",
    };
  }

  return {
    reply: "Índice R2 detectado, mas a busca textual ainda não está ligada. Manda um CNPJ por enquanto.",
    source: "r2-pending",
  };
}

export async function handleChatAi(
  message: string,
  history: ChatTurn[],
  env: AiEnv,
  lastEmpresa: Empresa | null,
): Promise<{ reply: string; empresa?: Empresa; source: string }> {
  const hasIndex = await r2HasIndex(env.CNPJ_DATA);
  const tools = buildTools(hasIndex);

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM },
  ];

  if (lastEmpresa) {
    messages.push({
      role: "system",
      content: `Contexto da última empresa consultada (JSON):\n${JSON.stringify(lastEmpresa).slice(0, 6000)}`,
    });
  }

  for (const turn of history.slice(-8)) {
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: "user", content: message });

  let empresa: Empresa | undefined = lastEmpresa ?? undefined;
  const maxHops = 3;

  try {
    for (let hop = 0; hop < maxHops; hop++) {
      const result = await env.AI.run(
        modelId(env) as keyof AiModels,
        {
          messages,
          tools,
        } as any,
        gatewayOpts(env),
      );

      const calls = extractToolCalls(result);
      if (calls.length) {
        const call = calls[0];
        messages.push({
          role: "assistant",
          content: JSON.stringify(call),
        });
        const toolOut = await runTool(call.name, call.arguments, env);
        if (toolOut.empresa) empresa = toolOut.empresa;
        messages.push({
          role: "tool",
          name: call.name,
          content: toolOut.content,
        });
        continue;
      }

      const text = extractText(result).trim();
      if (text) {
        return { reply: text, empresa, source: "ai-gateway" };
      }
      break;
    }
  } catch (err) {
    console.error("ai_gateway_error", err);
  }

  // Fallback: regras locais (sem inventar)
  const fallback = await handleChatRules(message, env, lastEmpresa);
  return { ...fallback, source: `${fallback.source}+ai_fallback` };
}

/** SSE stream: tokens via Workers AI stream + gateway; tools resolvidos antes se CNPJ óbvio. */
export async function handleChatStream(
  message: string,
  history: ChatTurn[],
  env: AiEnv,
  lastEmpresa: Empresa | null,
): Promise<Response> {
  // Atalho: CNPJ explícito → lookup + stream curto do resumo via AI (ou texto fixo)
  const cnpj = extractCnpj(message);
  let empresa = lastEmpresa;
  let seed = message;

  if (cnpj) {
    const result = await fetchEmpresa(cnpj);
    if (result.ok) {
      empresa = result.data;
      seed = `Resuma em PT-BR curto a empresa ${formatCnpj(cnpj)} (${String(result.data.razao_social)}), situação ${String(result.data.descricao_situacao_cadastral)}, ${String(result.data.municipio)}/${String(result.data.uf)}. Convide follow-ups (sócios, CNAE, endereço, capital).`;
    }
  }

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM },
    ...history.filter((t) => t.role === "user" || t.role === "assistant").slice(-6),
    { role: "user", content: seed },
  ];

  const stream = await env.AI.run(
    modelId(env) as keyof AiModels,
    {
      messages,
      stream: true,
    } as any,
    gatewayOpts(env),
  );

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const meta = {
    ok: true,
    source: "ai-gateway-stream",
    empresa: empresa ?? null,
  };

  (async () => {
    try {
      await writer.write(encoder.encode(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`));
      // Workers AI stream is typically a ReadableStream of bytes/events
      const body = stream as ReadableStream;
      if (body && typeof body.getReader === "function") {
        const reader = body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await writer.write(value);
        }
      } else {
        const text = extractText(stream);
        await writer.write(encoder.encode(`data: ${JSON.stringify({ response: text })}\n\n`));
      }
      await writer.write(encoder.encode(`event: done\ndata: {}\n\n`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "stream_error";
      await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-indicie-stream": "1",
    },
  });
}
