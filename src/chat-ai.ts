import {
  buildTools,
  buscaTextualR2,
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
- Nunca invente dados de empresa. Use só os fatos fornecidos no contexto/tools.
- Se não houver CNPJ e a busca textual não estiver disponível, peça um CNPJ (ex.: 00.000.000/0001-91).
- Respostas curtas, claras, com markdown leve (**negrito**, \`código\`).
- Follow-ups (sócios, CNAE, endereço, capital) usam o contexto da última empresa.
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
    // some models return { message: { content } } or choices
    const msg = o.message;
    if (msg && typeof msg === "object") {
      const c = (msg as Record<string, unknown>).content;
      if (typeof c === "string") return c;
    }
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
    let name = String(t.name || "");
    let args: Record<string, unknown> = {};
    const fn = t.function;
    if (fn && typeof fn === "object") {
      const f = fn as Record<string, unknown>;
      name = String(f.name || name);
      const a = f.arguments;
      if (typeof a === "string") {
        try {
          args = JSON.parse(a) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (a && typeof a === "object") {
        args = a as Record<string, unknown>;
      }
    } else {
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
    }
    if (name) out.push({ name, arguments: args });
  }
  return out;
}

/** Fallback determinístico se AI falhar. */
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
    reply: "Índice R2 detectado. Descreva a busca (nome, cidade, UF) ou mande um CNPJ.",
    source: "r2-ready",
  };
}

async function runLlm(
  env: AiEnv,
  messages: Array<Record<string, unknown>>,
  tools?: ReturnType<typeof buildTools>,
): Promise<unknown> {
  const payload: Record<string, unknown> = { messages };
  if (tools?.length) {
    // OpenAI-style + flat (Workers AI models vary)
    payload.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
  return env.AI.run(modelId(env) as keyof AiModels, payload as any, gatewayOpts(env));
}

/** Orquestra fatos (BrasilAPI/R2) + NL via Gateway. */
export async function handleChatAi(
  message: string,
  history: ChatTurn[],
  env: AiEnv,
  lastEmpresa: Empresa | null,
): Promise<{ reply: string; empresa?: Empresa; source: string }> {
  const hasIndex = await r2HasIndex(env.CNPJ_DATA);
  let empresa: Empresa | undefined = lastEmpresa ?? undefined;
  const facts: string[] = [];

  // 1) Tools locais (determinísticas) — não dependem do modelo entender function-calling
  const cnpj = extractCnpj(message);
  if (cnpj) {
    const toolOut = await runTool("consulta_cnpj", { cnpj }, env);
    if (toolOut.empresa) empresa = toolOut.empresa;
    facts.push(`Resultado consulta_cnpj:\n${toolOut.content.slice(0, 8000)}`);
  } else if (hasIndex && !/(s[oó]cio|endere[cç]o|cnae|capital|fantasia|situa[cç])/i.test(message)) {
    // heurística leve: pedido de lista/filtro
    if (/busca|procur|lista|empresa|restaurante|em\s+[A-ZÁÉÍÓÚ]|UF\b/i.test(message) || message.split(/\s+/).length >= 2) {
      const ufMatch = message.match(/\b([A-Z]{2})\b/);
      const toolOut = await runTool(
        "busca_textual",
        { q: message, uf: ufMatch?.[1] },
        env,
      );
      facts.push(`Resultado busca_textual:\n${toolOut.content.slice(0, 8000)}`);
    }
  } else if (lastEmpresa) {
    facts.push(`Empresa em contexto:\n${JSON.stringify(lastEmpresa).slice(0, 6000)}`);
  }

  const messages: Array<Record<string, unknown>> = [{ role: "system", content: SYSTEM }];
  for (const turn of history.slice(-6)) {
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  if (facts.length) {
    messages.push({
      role: "system",
      content: `Fatos obtidos pelas tools (use só isso; não invente):\n\n${facts.join("\n\n")}`,
    });
  }
  messages.push({ role: "user", content: message });

  try {
    // NL polish via Gateway (sem tools no payload — mais compatível)
    const result = await runLlm(env, messages);
    const text = extractText(result).trim();
    if (text) {
      return { reply: text, empresa, source: "ai-gateway" };
    }

    // retry com function-calling nativo se NL vazio
    const tools = buildTools(hasIndex);
    const withTools = await runLlm(env, messages, tools);
    const calls = extractToolCalls(withTools);
    if (calls.length) {
      const call = calls[0];
      const toolOut = await runTool(call.name, call.arguments, env);
      if (toolOut.empresa) empresa = toolOut.empresa;
      const messages2 = [
        ...messages,
        { role: "assistant", content: JSON.stringify(call) },
        { role: "tool", content: toolOut.content },
        { role: "user", content: "Com base no resultado da tool, responda ao usuário em PT-BR." },
      ];
      const final = await runLlm(env, messages2);
      const finalText = extractText(final).trim();
      if (finalText) return { reply: finalText, empresa, source: "ai-gateway" };
    }
    const text2 = extractText(withTools).trim();
    if (text2) return { reply: text2, empresa, source: "ai-gateway" };
  } catch (err) {
    console.error("ai_gateway_error", err);
  }

  const fallback = await handleChatRules(message, env, lastEmpresa);
  return { ...fallback, source: `${fallback.source}+ai_fallback` };
}

export async function handleChatStream(
  message: string,
  history: ChatTurn[],
  env: AiEnv,
  lastEmpresa: Empresa | null,
): Promise<Response> {
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
    { messages, stream: true } as any,
    gatewayOpts(env),
  );

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const meta = { ok: true, source: "ai-gateway-stream", empresa: empresa ?? null };

  (async () => {
    try {
      await writer.write(encoder.encode(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`));
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
