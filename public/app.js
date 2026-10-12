const leagueSelect = document.querySelector("#league");
const roundSelect = document.querySelector("#round");
const matchesEl = document.querySelector("#matches");
const tableEl = document.querySelector("#table");
const modal = document.querySelector("#modal");
const detail = document.querySelector("#detail");
const tituloJogos = document.querySelector("#titulo-jogos");
const tituloTabela = document.querySelector("#titulo-tabela");
const loading = document.querySelector("#loading");
const botaoAoVivo = document.querySelector("#aovivo");
const ligaDestaque = document.querySelector("#liga-destaque");
const WHATSAPP = "5541999999999";
let cargas = 0;
let soAoVivo = false;
let jogosAtuais = [];
const cacheJogos = {};
const cacheTabela = {};
let modoHoje = true;

function chaveAtual() {
  return leagueSelect.value ? `${leagueSelect.value}-${roundSelect.value || "atual"}` : "hoje";
}
function mostrarLoading() {
  cargas++;
  loading.classList.add("ativo");
}
function esconderLoading() {
  cargas = Math.max(0, cargas - 1);
  if (cargas === 0) loading.classList.remove("ativo");
}
function espera(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function tempoDoLimite(msg) {
  const n = Number(String(msg).match(/Wait (\d+)/)?.[1]);
  return ((n || 20) + 2) * 1000;
}
async function buscar(url) {
  while (true) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error && String(data.error).includes("429")) {
      await espera(tempoDoLimite(data.error));
      continue;
    }
    return data;
  }
}
function aoVivo(m) {
  return m.status === "IN_PLAY" || m.status === "PAUSED";
}
function nomeTime(time) {
  const nome = time.shortName || time.name;
  if (nome === "Barça") return "Barcelona";
  return nome;
}

const statusLabel = {
  SCHEDULED: "Agendado",
  TIMED: "Agendado",
  IN_PLAY: "Ao vivo",
  PAUSED: "Intervalo",
  FINISHED: "Encerrado",
  POSTPONED: "Adiado",
  CANCELLED: "Cancelado"
};

const mataMata = new Set([
  "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL",
  "ROUND_OF_16", "PLAYOFFS", "PRELIMINARY_ROUND", "QUALIFICATION"
]);

function hoje() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function diaLocal(iso) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function quando(iso) {
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return `${data}<br>${hora}`;
}

function escudo(time, lado) {
  const img = `<img class="escudo" src="${time.crest || ""}" alt="">`;
  const nome = `<span class="time">${nomeTime(time)}</span>`;
  return lado === "casa" ? `${nome}${img}` : `${img}${nome}`;
}

function placar(m) {
  if (m.score?.fullTime?.home == null) return "x";
  return `${m.score.fullTime.home} x ${m.score.fullTime.away}`;
}

function statusClasse(status) {
  if (status === "IN_PLAY" || status === "PAUSED") return "aovivo";
  if (status === "FINISHED") return "encerrado";
  if (status === "SCHEDULED" || status === "TIMED") return "agendado";
  if (status === "CANCELLED" || status === "POSTPONED") return "cancelado";
  return "";
}

function marcarPernas(jogos) {
  const vistos = new Set();
  return [...jogos]
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .map(m => {
      if (!mataMata.has(m.stage)) return m;
      const chave = [m.homeTeam.id, m.awayTeam.id].sort().join("-") + "|" + m.stage;
      const perna = vistos.has(chave) ? "Volta" : "Ida";
      vistos.add(chave);
      return { ...m, perna };
    });
}

function card(m) {
  const vivo = aoVivo(m);
  const encerrado = m.status === "FINISHED";
  const cancelado = m.status === "CANCELLED";
  const bolinha = vivo ? `<span class="bolinha"></span>` : "";
  const minuto = vivo && m.minute ? `<br>${m.minute}'` : "";
  const perna = m.perna ? `<br>${m.perna}` : `<br>R${m.matchday || "-"}`;
  const casa = nomeTime(m.homeTeam);
  const fora = nomeTime(m.awayTeam);
  const texto = encodeURIComponent(`Palpite: ${casa} x ${fora}`);
  const palpite = (encerrado || cancelado) ? "" : `<a class="palpite" href="https://wa.me/${WHATSAPP}?text=${texto}" target="_blank" rel="noopener">Palpite $</a>`;
  return `
    <div class="jogo">
      ${palpite}
      <button class="match" data-id="${m.id}">
        <span class="quando">${quando(m.utcDate)}</span>
        <span class="casa">${escudo(m.homeTeam, "casa")}</span>
        <span class="placar">${placar(m)}</span>
        <span class="fora">${escudo(m.awayTeam, "fora")}</span>
        <span class="estado ${statusClasse(m.status)}">${bolinha}${statusLabel[m.status] || m.status}${minuto}${perna}</span>
      </button>
    </div>
  `;
}

function desenharJogos() {
  const lista = soAoVivo ? jogosAtuais.filter(aoVivo) : jogosAtuais;
  if (!lista.length) {
    matchesEl.innerHTML = `<p class="vazio">${soAoVivo ? "Não há jogos no momento." : "Nenhum jogo nessa seleção."}</p>`;
    return;
  }
  if (modoHoje) {
    const grupos = new Map();
    for (const m of lista) {
      const nome = m.competition?.name || "Outras";
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(m);
    }
    const ordem = [...grupos.entries()].sort((a, b) => {
      const aBr = a[1][0]?.competition?.code === "BSA" ? 0 : 1;
      const bBr = b[1][0]?.competition?.code === "BSA" ? 0 : 1;
      return aBr - bBr;
    });
    matchesEl.innerHTML = ordem.map(([liga, itens]) => {
      const code = itens[0]?.competition?.code || "";
      const nome = nomesLiga[code] || liga;
      const emblemaLiga = emblemas[code] || itens[0]?.competition?.emblem || "";
      return `
        <button type="button" class="liga" data-liga="${code}">
          ${emblemaLiga ? `<img src="${emblemaLiga}" alt="">` : ""}${nome}
        </button>
        ${itens.map(card).join("")}
      `;
    }).join("");
    return;
  }
  matchesEl.innerHTML = lista.map(card).join("");
}

function zona(pos) {
  if (pos <= 4) return "libertadores";
  if (pos <= 6) return "pre-libertadores";
  if (pos <= 12) return "sulamericana";
  if (pos >= 17) return "rebaixamento";
  return "";
}

function preencherRodadas(atual, selecionada, total) {
  const fim = total || 38;
  if (roundSelect.options.length === fim && roundSelect.value == selecionada) return;
  roundSelect.innerHTML = "";
  for (let i = 1; i <= fim; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i === atual ? `Rodada ${i} (atual)` : `Rodada ${i}`;
    roundSelect.appendChild(opt);
  }
  roundSelect.value = String(selecionada);
}

async function carregarHoje() {
  modoHoje = true;
  botaoAoVivo.classList.remove("escondido");
  roundSelect.classList.add("escondido");
  tituloJogos.textContent = "Jogos de hoje";
  document.title = "XTscores | Jogos de hoje";
  const chave = "hoje";
  if (cacheJogos[chave]) {
    jogosAtuais = cacheJogos[chave];
    desenharJogos();
  }
  const primeira = !cacheJogos[chave];
  if (primeira) mostrarLoading();
  try {
    const inicio = hoje();
    const fim = new Date();
    fim.setDate(fim.getDate() + 1);
    const dateTo = fim.toISOString().slice(0, 10);
    const data = await buscar(`/api/jogos?date=${inicio}&dateTo=${dateTo}`);
    if (data.error) {
      if (primeira) matchesEl.textContent = data.error;
      return;
    }
    const hojeBr = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    jogosAtuais = marcarPernas((data.matches || []).filter(m => diaLocal(m.utcDate) === hojeBr));
    cacheJogos[chave] = jogosAtuais;
    if (chaveAtual() === chave) desenharJogos();
  } finally {
    if (primeira) esconderLoading();
  }
}

async function carregarJogos() {
  if (!leagueSelect.value) {
    carregarHoje();
    return;
  }
  modoHoje = false;
  soAoVivo = false;
  botaoAoVivo.classList.remove("ativo");
  botaoAoVivo.classList.add("escondido");
  roundSelect.classList.remove("escondido");
  tituloJogos.textContent = "Jogos";
  document.title = "XTscores | Jogos";
  const chave = chaveAtual();
  if (cacheJogos[chave]) {
    jogosAtuais = cacheJogos[chave];
    desenharJogos();
  } else {
    jogosAtuais = [];
    matchesEl.textContent = "";
  }
  const primeira = !cacheJogos[chave];
  if (primeira) mostrarLoading();
  try {
    const code = leagueSelect.value;
    const rodada = roundSelect.value;
    const data = await buscar(`/api/rodada/${code}${rodada ? `?rodada=${rodada}` : ""}`);
    if (chaveAtual() !== `${code}-${rodada || "atual"}`) return;
    if (data.error) {
      if (primeira) matchesEl.textContent = data.error;
      return;
    }
    preencherRodadas(data.rodadaAtual || 1, data.rodada || 1, data.totalRodadas || 38);
    jogosAtuais = marcarPernas(data.matches || []);
    cacheJogos[chaveAtual()] = jogosAtuais;
    desenharJogos();
  } finally {
    if (primeira) esconderLoading();
  }
}

async function carregarTabela() {
  const code = leagueSelect.value;
  if (!code) {
    tituloTabela.classList.add("escondido");
    tableEl.innerHTML = "<p>Escolha uma liga para ver a tabela.</p>";
    return;
  }
  tituloTabela.classList.remove("escondido");
  if (cacheTabela[code]) tableEl.innerHTML = cacheTabela[code];
  const primeira = !cacheTabela[code];
  if (primeira) mostrarLoading();
  try {
    const data = await buscar(`/api/tabela/${code}`);
    if (leagueSelect.value !== code) return;
    if (data.error) {
      if (primeira) tableEl.textContent = data.error;
      return;
    }
    const rows = data.standings?.[0]?.table || [];
    const brasileirao = code === "BSA";
    const html = `
      ${brasileirao ? `
        <p class="legenda">
          <span><i class="l"></i>Libertadores</span>
          <span><i class="p"></i>Pré-Libertadores</span>
          <span><i class="s"></i>Sul-Americana</span>
          <span><i class="z"></i>Rebaixamento</span>
        </p>` : ""}
      <table>
        <thead><tr><th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="${brasileirao ? zona(r.position) : ""}">
              <td>${r.position}</td>
              <td>${nomeTime(r.team)}</td>
              <td>${r.points}</td>
              <td>${r.playedGames}</td>
              <td>${r.won}</td>
              <td>${r.draw}</td>
              <td>${r.lost}</td>
              <td>${r.goalDifference}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    cacheTabela[code] = html;
    if (leagueSelect.value === code) tableEl.innerHTML = html;
  } finally {
    if (primeira) esconderLoading();
  }
}

matchesEl.addEventListener("click", async (e) => {
  const liga = e.target.closest(".liga");
  if (liga && liga.dataset.liga) {
    leagueSelect.value = liga.dataset.liga;
    leagueSelect.dispatchEvent(new Event("change"));
    pintarPicker();
    return;
  }
  const btn = e.target.closest(".match");
  if (!btn) return;
  const res = await fetch(`/api/jogo/${btn.dataset.id}`);
  const m = await res.json();
  const gols = (m.goals || []).map(g => `${g.minute}' ${g.scorer?.name || ""} (${g.team?.name || ""})`).join("<br>") || "Sem gols registrados.";
  detail.innerHTML = `
    <h3>${nomeTime(m.homeTeam)} ${placar(m)} ${nomeTime(m.awayTeam)}</h3>
    <p>${m.competition.name} · ${statusLabel[m.status] || m.status}</p>
    <p>${gols}</p>
  `;
  modal.showModal();
});

botaoAoVivo.onclick = () => {
  soAoVivo = !soAoVivo;
  botaoAoVivo.classList.toggle("ativo", soAoVivo);
  desenharJogos();
};
document.querySelector("#close").onclick = () => modal.close();
leagueSelect.onchange = () => {
  roundSelect.innerHTML = "";
  carregarJogos();
  carregarTabela();
};
roundSelect.onchange = carregarJogos;

const emblemas = {
  BSA: "/brasiliirao.png",
  PL: "/premier.png",
  PD: "https://crests.football-data.org/PD.png",
  SA: "https://crests.football-data.org/SA.png",
  BL1: "https://crests.football-data.org/BL1.png",
  FL1: "https://crests.football-data.org/FL1.png",
  CL: "/champions.png",
  DED: "/eredivisie.png",
  PPL: "https://crests.football-data.org/PPL.png",
  ELC: "https://crests.football-data.org/ELC.png"
};
const nomesLiga = {
  BSA: "Brasileirão",
  PL: "Premier League",
  PD: "La Liga",
  SA: "Serie A",
  BL1: "Bundesliga",
  FL1: "Ligue 1",
  CL: "Champions League",
  DED: "Eredivisie",
  PPL: "Primeira Liga",
  ELC: "Championship"
};
const pickerBtn = document.querySelector("#picker-btn");
const pickerLista = document.querySelector("#picker-lista");

function emblema(code) {
  return emblemas[code] ? `<img class="emblema" src="${emblemas[code]}" alt="">` : "";
}
function atualizarDestaque() {
  const opt = leagueSelect.selectedOptions[0];
  if (!opt.value || !emblemas[opt.value]) {
    ligaDestaque.classList.add("escondido");
    ligaDestaque.innerHTML = "";
    return;
  }
  ligaDestaque.classList.remove("escondido");
  ligaDestaque.innerHTML = `<img src="${emblemas[opt.value]}" alt=""><span>${opt.textContent}</span>`;
}
function pintarPicker() {
  const opt = leagueSelect.selectedOptions[0];
  pickerBtn.innerHTML = `${emblema(opt.value)}<span>${opt.textContent}</span>`;
  atualizarDestaque();
}
pickerLista.innerHTML = [...leagueSelect.options].map(opt => `
  <button type="button" class="picker-item" data-value="${opt.value}">
    ${emblema(opt.value)}<span>${opt.textContent}</span>
  </button>
`).join("");
pickerBtn.onclick = () => pickerLista.classList.toggle("escondido");
pickerLista.onclick = (e) => {
  const item = e.target.closest(".picker-item");
  if (!item) return;
  leagueSelect.value = item.dataset.value;
  leagueSelect.dispatchEvent(new Event("change"));
  pintarPicker();
  pickerLista.classList.add("escondido");
};
document.addEventListener("click", (e) => {
  if (!e.target.closest("#picker")) pickerLista.classList.add("escondido");
});
pintarPicker();

carregarJogos();
carregarTabela();
setInterval(carregarJogos, 180_000);