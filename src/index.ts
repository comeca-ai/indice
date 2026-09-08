export interface Env {
  ASSETS: Fetcher;
  CNPJ_DATA: R2Bucket;
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

function onlyDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      const listed = await env.CNPJ_DATA.list({ limit: 5 });
      return json({
        ok: true,
        service: "indicie",
        r2: {
          bucket: "indicie-cnpj",
          sampleKeys: listed.objects.map((o) => o.key),
          truncated: listed.truncated,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      return json({
        empty: true,
        q,
        results: [],
        note: "Stub: indexação R2 ainda não ligada.",
      });
    }

    const empresaMatch = url.pathname.match(/^\/api\/empresa\/([^/]+)$/);
    if (request.method === "GET" && empresaMatch) {
      const cnpj = onlyDigits(decodeURIComponent(empresaMatch[1]));
      return json({
        empty: true,
        cnpj,
        empresa: null,
        note: "Stub: lookup por CNPJ ainda não ligado.",
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
