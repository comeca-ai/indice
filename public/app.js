async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function el(id) { return document.getElementById(id); }

function formatCnpj(digits) {
  const d = String(digits || "").replace(/\D+/g, "").slice(0, 14);
  if (d.length !== 14) return d;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

async function wireHealth() {
  const node = el("health");
  if (!node) return;
  try {
    const data = await api("/api/health");
    const keys = (data.r2 && data.r2.sampleKeys ? data.r2.sampleKeys : []).length;
    node.textContent = data.ok ? `API online · R2 amostra: ${keys} objeto(s)` : "API sem resposta";
  } catch {
    node.textContent = "API indisponível neste ambiente";
  }
}

async function runSearch(query) {
  const box = el("results");
  if (!box) return;
  box.innerHTML = `<div class="empty">Consultando…</div>`;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (data.empty || !(data.results && data.results.length)) {
      box.innerHTML = `<div class="empty">Nenhum resultado para <strong>${query}</strong>. Índice ainda em stub.</div>`;
      return;
    }
    box.innerHTML = data.results.map((r) => `<article class="result"><div class="mono">${formatCnpj(r.cnpj)}</div><strong>${r.razao_social || "—"}</strong><div class="muted">${r.uf || ""} ${r.municipio || ""}</div></article>`).join("");
  } catch (err) {
    box.innerHTML = `<div class="empty">Falha na busca: ${err.message}</div>`;
  }
}

function wireSearchForm() {
  const form = el("search-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(form).get("q");
    const query = String(q || "").trim();
    if (!query) return;
    const onBuscar = location.pathname.endsWith("/buscar.html");
    if (!onBuscar) { location.href = `/buscar.html?q=${encodeURIComponent(query)}`; return; }
    const url = new URL(location.href);
    url.searchParams.set("q", query);
    history.replaceState({}, "", url);
    runSearch(query);
  });
  const params = new URLSearchParams(location.search);
  const initial = params.get("q");
  if (initial && el("q")) { el("q").value = initial; runSearch(initial); }
}

document.addEventListener("DOMContentLoaded", () => { wireHealth(); wireSearchForm(); });
