const app = document.querySelector("#app");
const landing = document.querySelector("#landing");
const chat = document.querySelector("#chat");
const thread = document.querySelector("#thread");
const btnNew = document.querySelector("#btn-new");
const landingForm = document.querySelector("#landing-form");
const landingInput = document.querySelector("#landing-input");
const composer = document.querySelector("#composer");
const msgInput = document.querySelector("#msg");

/** @type {{role: string, content: string}[]} */
let history = [];
let lastEmpresa = null;
/** @type {Record<string, string>|null} */
let filters = null;
/** @type {any[]|null} */
let results = null;

function enterChat() {
  app.classList.remove("mode-landing");
  app.classList.add("mode-chat");
  landing.hidden = true;
  chat.hidden = false;
  btnNew.hidden = false;
  msgInput.focus();
}

function resetChat() {
  history = [];
  lastEmpresa = null;
  filters = null;
  results = null;
  thread.innerHTML = "";
  app.classList.add("mode-landing");
  app.classList.remove("mode-chat");
  landing.hidden = false;
  chat.hidden = true;
  btnNew.hidden = true;
  landingInput.value = "";
  landingInput.focus();
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderText(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function formatCnpj(cnpj) {
  const d = String(cnpj || "").replace(/\D/g, "");
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function money(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function empresaCard(data) {
  if (!data) return "";
  const socios = Array.isArray(data.qsa) ? data.qsa.slice(0, 6) : [];
  const sociosHtml = socios.length
    ? `<div class="socios"><label style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted)">Sócios</label><ul>${socios
        .map((s) => `<li>${esc(s.nome_socio)} — ${esc(s.qualificacao_socio || "")}</li>`)
        .join("")}</ul></div>`
    : "";
  return `<article class="card-empresa">
    <header>
      <strong>${esc(data.razao_social || "Empresa")}</strong>
      <span>${esc(formatCnpj(data.cnpj))} · ${esc(data.descricao_situacao_cadastral || "—")}</span>
    </header>
    <div class="grid">
      <div class="item"><label>Fantasia</label><div>${esc(data.nome_fantasia || "—")}</div></div>
      <div class="item"><label>Abertura</label><div>${esc(data.data_inicio_atividade || "—")}</div></div>
      <div class="item"><label>CNAE</label><div>${esc(`${data.cnae_fiscal ?? ""} ${data.cnae_fiscal_descricao || ""}`.trim() || "—")}</div></div>
      <div class="item"><label>Capital</label><div>${esc(money(data.capital_social))}</div></div>
      <div class="item" style="grid-column:1/-1"><label>Endereço</label><div>${esc([data.logradouro, data.numero, data.bairro, data.municipio, data.uf, data.cep].filter(Boolean).join(", ") || "—")}</div></div>
    </div>
    ${sociosHtml}
  </article>`;
}

function addRow(role, text, empresa = null) {
  const row = document.createElement("div");
  row.className = `row ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "EU" : "Í";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = renderText(text) + (empresa ? empresaCard(empresa) : "");
  row.appendChild(avatar);
  row.appendChild(bubble);
  thread.appendChild(row);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

async function ask(message) {
  enterChat();
  addRow("user", message);
  history.push({ role: "user", content: message });
  const thinking = addRow("assistant", "…");
  thinking.classList.add("dim");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        history,
        lastEmpresa,
        filters,
        results,
        stream: false,
      }),
    });
    const data = await res.json();
    thinking.parentElement.remove();
    if (data.empresa) lastEmpresa = data.empresa;
    if (data.filters) filters = data.filters;
    if (data.results) results = data.results;
    if (data.phase === "results") results = data.results || results;
    addRow("assistant", data.reply || data.error || "Sem resposta.", data.empresa || null);
    history.push({ role: "assistant", content: data.reply || "" });
  } catch {
    thinking.parentElement.remove();
    addRow("assistant", "Falha de rede ao falar com a API.");
  }
}

landingForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = landingInput.value.trim();
  if (!q) return;
  landingInput.value = "";
  ask(q);
});

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = msgInput.value.trim();
  if (!q) return;
  msgInput.value = "";
  ask(q);
});

document.querySelector("#chips").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-q]");
  if (!btn) return;
  ask(btn.getAttribute("data-q"));
});

btnNew.addEventListener("click", resetChat);
