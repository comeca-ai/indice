/** Coleta de filtros estilo cnpj.chat/buscar — sem bate-papo. */

export type SearchFilters = {
  uf?: string;
  municipio?: string;
  cnae?: string;
  situacao?: string;
  matriz_filial?: string; // "1" matriz | "2" filial
  q?: string;
};

const UFS = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

const UF_NAMES: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA",
  paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

function strip(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function mergeFilters(base: SearchFilters | null | undefined, patch: SearchFilters): SearchFilters {
  return {
    ...(base || {}),
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null && String(v).trim() !== "")),
  };
}

/** Extrai filtros de uma mensagem livre em PT-BR. */
export function parseFiltersFromMessage(message: string): SearchFilters {
  const out: SearchFilters = {};
  let raw = message.trim();
  const low = strip(raw);

  // Ignore pure CNPJ here (chat trata CNPJ antes)
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(raw) || /^\d{14}$/.test(raw.replace(/\D/g, "")) && onlyDigitsLen(raw) === 14) {
    return out;
  }

  // UF no final: "… SC" / "…/SC"
  const ufEnd = raw.match(/[\s,/\-]+([A-Za-z]{2})\s*$/);
  if (ufEnd && UFS.has(ufEnd[1].toUpperCase())) {
    out.uf = ufEnd[1].toUpperCase();
    raw = raw.slice(0, ufEnd.index).trim();
  }

  // UF explícita
  if (!out.uf) {
    const ufTok = raw.match(/\buf\s*[:=]?\s*([A-Za-z]{2})\b/i);
    if (ufTok && UFS.has(ufTok[1].toUpperCase())) out.uf = ufTok[1].toUpperCase();
  }
  if (!out.uf) {
    const only = raw.match(/^\s*([A-Za-z]{2})\s*$/);
    if (only && UFS.has(only[1].toUpperCase())) out.uf = only[1].toUpperCase();
  }
  if (!out.uf) {
    for (const [name, code] of Object.entries(UF_NAMES)) {
      if (low.includes(name)) {
        out.uf = code;
        break;
      }
    }
  }
  // UF solta no meio
  if (!out.uf) {
    for (const tok of raw.toUpperCase().split(/[^A-Z]+/)) {
      if (UFS.has(tok)) {
        out.uf = tok;
        break;
      }
    }
  }

  // município
  const munExplicit = raw.match(/munic[ií]pio\s*[:=]?\s*([A-Za-zÀ-ÿ\s'-]{2,40})/i);
  if (munExplicit) out.municipio = cleanPlace(munExplicit[1]);
  if (!out.municipio) {
    const em = raw.match(/\bem\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'-]{1,40})/i);
    if (em) out.municipio = cleanPlace(em[1]);
  }

  // CNAE / atividade
  const cnaeCode = raw.match(/cnae\s*[:=]?\s*(\d{4,7})/i);
  if (cnaeCode) out.cnae = cnaeCode[1];
  if (!out.cnae) {
    const act = raw.match(
      /\b(restaurantes?|dentistas?|padarias?|farm[aá]cias?|advocacia|m[eé]dicos?|hoteis?|hot[eé]is|supermercados?|construtoras?|transportes?|tecnologia|software|com[eé]rcio|ind[uú]stria)[a-zà-ÿ]*/i,
    );
    if (act) out.cnae = act[0].toLowerCase();
  }

  if (/\b(ativa|ativo|ativas|ativos)\b/i.test(raw)) out.situacao = "ATIVA";
  else if (/\b(baixada|baixadas|inapta|suspensa)\b/i.test(raw)) {
    const m = raw.match(/\b(baixada|inapta|suspensa)\b/i);
    out.situacao = (m?.[1] || "BAIXADA").toUpperCase();
  } else if (/^(qualquer|todas|todos|indiferente)$/i.test(raw.trim())) {
    // bare "qualquer" while collecting situacao — handled in slot-fill too
  }

  if (/\bmatrizes?\b/i.test(raw)) out.matriz_filial = "1";
  else if (/\bfiliais?\b/i.test(raw)) out.matriz_filial = "2";
  else if (/\b(ambas|ambos)\b/i.test(raw)) out.matriz_filial = "0";

  return out;
}

function onlyDigitsLen(s: string): number {
  return s.replace(/\D+/g, "").length;
}

function cleanPlace(s: string): string {
  return s
    .trim()
    .replace(/[.,;]+$/g, "")
    .replace(/\s+(sc|sp|rj|mg|pr|rs|ba|pe|ce|go|df|es|pb|rn|al|se|to|pa|am|ma|pi|mt|ms|ro|ac|rr|ap)$/i, "")
    .trim();
}

export function filtersReady(f: SearchFilters): boolean {
  // Completo antes de responder ao cliente: UF + município + CNAE + situação + matriz/filial
  return Boolean(f.uf && f.municipio && (f.cnae || f.q) && f.situacao && f.matriz_filial);
}

export function nextFilterPrompt(f: SearchFilters): string {
  const lines: string[] = [];
  lines.push("Filtros da busca:");
  lines.push(`• **UF:** ${f.uf || "—"}`);
  lines.push(`• **Município:** ${f.municipio || "—"}`);
  lines.push(`• **CNAE / atividade:** ${f.cnae || f.q || "—"}`);
  lines.push(`• **Situação:** ${f.situacao || "—"}`);
  const tipo =
    f.matriz_filial === "1" ? "matriz" : f.matriz_filial === "2" ? "filial" : f.matriz_filial === "0" ? "ambas" : "—";
  lines.push(`• **Matriz/filial:** ${tipo}`);
  lines.push("");

  if (!f.uf) {
    lines.push("Qual a **UF**? (ex.: `SP`, `SC`, `RJ`)");
  } else if (!f.municipio) {
    lines.push("Qual o **município**? (ou diga `qualquer`)");
  } else if (!f.cnae && !f.q) {
    lines.push("Qual a **atividade ou CNAE**? (ex.: restaurantes, dentistas)");
  } else if (!f.situacao) {
    lines.push("Qual a **situação**? (`ATIVA`, `BAIXADA` ou `qualquer`)");
  } else if (!f.matriz_filial) {
    lines.push("**Matriz**, **filial** ou **ambas**?");
  } else {
    lines.push("Formulário completo — listando…");
  }
  return lines.join("\n");
}

export function formatResultsList(
  filters: SearchFilters,
  results: Array<Record<string, unknown>>,
): string {
  const head = [
    `Resultados · UF **${filters.uf || "—"}**` +
      (filters.municipio ? ` · ${filters.municipio}` : "") +
      (filters.cnae || filters.q ? ` · ${filters.cnae || filters.q}` : ""),
    "",
  ];
  if (!results.length) {
    return head.concat(["Nenhuma empresa nesse filtro.", "Ajuste município/CNAE ou mande um **CNPJ**."]).join("\n");
  }
  const rows = results.slice(0, 15).map((r, i) => {
    const nome = String(r.razao_social || r.nome_fantasia || "Empresa");
    const local = [r.municipio, r.uf].filter(Boolean).join("/");
    const sit = String(r.situacao_cadastral || "—");
    const aberta = r.data_inicio_atividade ? String(r.data_inicio_atividade) : "—";
    const atv = String(r.cnae_fiscal_principal || r.cnae_fiscal_descricao || "—");
    const cnpj = String(r.cnpj || "");
    return `${i + 1}. **${nome}**${cnpj ? ` (\`${cnpj}\`)` : ""}\n   ${local || "—"} · ${sit} · aberta em ${aberta} · ${atv}`;
  });
  return head
    .concat(rows)
    .concat(["", "Manda o **número** da lista ou um **CNPJ** pra detalhar."])
    .join("\n");
}

export function isGreeting(message: string): boolean {
  return /^(oi|ol[aá]|hey|hello|e a[ií]|tudo bem|bom dia|boa tarde|boa noite)[\s!.?]*$/i.test(message.trim());
}
