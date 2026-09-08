import { handleChatAi, handleChatRules, handleChatStream, type ChatTurn } from "./chat-ai";
import { extractCnpj, fetchEmpresa, onlyDigits, type Empresa } from "./tools";

export interface Env {
  ASSETS: Fetcher;
  CNPJ_DATA: R2Bucket;
  AI: Ai;
  AI_GATEWAY_ID?: string;
  AI_MODEL?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      const listed = await env.CNPJ_DATA.list({ limit: 5 });
      return json({
        ok: true,
        service: "indicie",
        chat: true,
        ai: Boolean(env.AI),
        ai_gateway: env.AI_GATEWAY_ID || "indicie",
        live_cnpj_lookup: "brasilapi",
        r2: {
          bucket: "indicie-cnpj",
          sampleKeys: listed.objects.map((o) => o.key),
          truncated: listed.truncated,
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      let body: {
        message?: string;
        history?: ChatTurn[];
        lastEmpresa?: Empresa | null;
        stream?: boolean;
        mode?: string;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      const message = (body.message || "").trim();
      if (!message) return json({ ok: false, error: "empty_message" }, 400);

      const wantStream =
        body.stream === true ||
        body.mode === "stream" ||
        url.searchParams.get("stream") === "1";

      if (wantStream) {
        try {
          return await handleChatStream(message, body.history || [], env, body.lastEmpresa ?? null);
        } catch (err) {
          console.error("stream_fallback", err);
          // cai no JSON abaixo
        }
      }

      try {
        const out = await handleChatAi(message, body.history || [], env, body.lastEmpresa ?? null);
        return json({ ok: true, ...out });
      } catch (err) {
        console.error("chat_ai_fatal", err);
        const out = await handleChatRules(message, env, body.lastEmpresa ?? null);
        return json({ ok: true, ...out });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      const cnpj = extractCnpj(q);
      if (cnpj) {
        const result = await fetchEmpresa(cnpj);
        if (!result.ok) return json({ empty: true, q, results: [], error: result.error });
        const d = result.data;
        return json({
          empty: false,
          q,
          source: "brasilapi",
          results: [
            {
              cnpj: onlyDigits(String(d.cnpj)),
              razao_social: d.razao_social,
              nome_fantasia: d.nome_fantasia,
              uf: d.uf,
              municipio: d.municipio,
              situacao: d.descricao_situacao_cadastral,
            },
          ],
        });
      }
      return json({
        empty: true,
        q,
        results: [],
        note: "Busca por nome/cidade exige índice R2 (carga). Use CNPJ de 14 dígitos.",
      });
    }

    const empresaMatch = url.pathname.match(/^\/api\/empresa\/([^/]+)$/);
    if (request.method === "GET" && empresaMatch) {
      const cnpj = onlyDigits(decodeURIComponent(empresaMatch[1]));
      if (cnpj.length !== 14) return json({ empty: true, error: "cnpj_invalido" }, 400);
      const result = await fetchEmpresa(cnpj);
      if (!result.ok) {
        return json(
          { empty: true, cnpj, empresa: null, error: result.error },
          result.status === 404 ? 404 : 502,
        );
      }
      return json({ empty: false, cnpj, source: "brasilapi", empresa: result.data });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
