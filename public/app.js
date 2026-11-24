/* XTscores — front-end */

const FUSO = "America/Sao_Paulo";
const WHATSAPP = "5516974061534";
const CACHE_MAX_IDADE = 60 * 1000;
const INTERVALO_AOVIVO = 60 * 1000;
const INTERVALO_NORMAL = 5 * 60 * 1000;

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
const atualizadoEl = document.querySelector("#atualizado");

const emblemas = {
  BSA: "/brasiliirao.png",
  PL: "/premier.png",
  PD: "https://crests.football-data.org/PD.png",
  SA: "https://crests.football-data.org/SA.png",
  BL1: "https://crests.football-data.org/BL1.png",
  FL1: "https://crests.football-data.org/FL1.png",
  CL: "/champions.png",
  CLI: "https://crests.football-data.org/CLI.svg",
  DED: "/Eredivisie.png",
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
  CLI: "Libertadores",
  DED: "Eredivisie",
  PPL: "Primeira Liga",
  ELC: "Championship"
};

const ORDEM_LIGAS = Object.keys(nomesLiga);

const statusLabel = {
  SCHEDULED: "Agendado",
  TIMED: "Agendado",
  IN_PLAY: "Ao vivo",
  PAUSED: "Intervalo",
  FINISHED: "Encerrado",
  POSTPONED: "Adiado",
  SUSPENDED: "Suspenso",
  CANCELLED: "Cancelado",
  AWARDED: "Decidido"
};

/* Competições de mata-mata: sem tabela de classificação nem rodadas numeradas. */
const SEM_TABELA = new Set(["CLI"]);

const mataMata = new Set([
  "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL",
  "ROUND_OF_16", "PLAYOFFS", "PRELIMINARY_ROUND", "QUALIFICATION"
]);

/* ---------- Estado ---------- */

let cargas = 0;
let soAoVivo = false;
let jogosAtuais = [];
let modoHoje = true;
let timerAtualizacao = null;
const cacheJogos = {};
const cacheTabela = {};

/* ---------- Utilitários ---------- */

const formatadorData = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function escHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function dataSP(deslocamentoDias = 0) {
  const d = new Date(Date.now() + deslocamentoDias * 86400000);
  return formatadorData.format(d);
}
function diaSP(iso) {
  return formatadorData.format(new Date(iso));
}
function quando(iso) {
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
  return `${data}<br>${hora}`;
}
function espera(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function tempoDoLimite(msg) {
  const n = Number(String(msg || "").match(/(\d+)\s*(?:segundos?|seconds?)/i)?.[1]);
  return (Math.min(n || 20, 60) + 2) * 1000;
}
function cacheValido(item) {
  return Boolean(item) && Date.now() - item.salvoEm < CACHE_MAX_IDADE;
}
function mostrarLoading(silencioso = false) {
  if (silencioso) return false;
  cargas++;
  loading.classList.add("ativo");
  loading.setAttribute("aria-busy", "true");
  return true;
}
function esconderLoading(exibido) {
  if (!exibido) return;
  cargas = Math.max(0, cargas - 1);
  if (cargas === 0) {
    loading.classList.remove("ativo");
    loading.setAttribute("aria-busy", "false");
  }
}
function chaveAtual() {
  if (!leagueSelect.value) return "hoje";
  return `${leagueSelect.value}-${roundSelect.value || "atual"}`;
}
function aoVivo(m) {
  return m.status === "IN_PLAY" || m.status === "PAUSED";
}
function nomeTime(time) {
  const nome = time?.shortName || time?.name || "—";
  return nome === "Barça" ? "Barcelona" : nome;
}
function placar(m) {
  if (m.score?.fullTime?.home == null) return "x";
  return `${m.score.fullTime.home} x ${m.score.fullTime.away}`;
}
function statusClasse(status) {
  if (status === "IN_PLAY" || status === "PAUSED") return "aovivo";
  if (status === "FINISHED" || status === "AWARDED") return "encerrado";
  if (status === "SCHEDULED" || status === "TIMED") return "agendado";
  if (status === "CANCELLED" || status === "POSTPONED" || status === "SUSPENDED") return "cancelado";
  return "";
}

/* Estatísticas próprias do site (sem cookies). */
function rastrear(nome, valor, contexto) {
  if (typeof window.XTtrack === "function") window.XTtrack(nome, valor, contexto);
}
function prioridadeStatus(status) {
  if (status === "IN_PLAY" || status === "PAUSED") return 1;
  if (status === "SCHEDULED" || status === "TIMED") return 2;
  if (status === "FINISHED" || status === "AWARDED") return 3;
  if (status === "CANCELLED" || status === "POSTPONED" || status === "SUSPENDED") return 4;
  return 5;
}

/* Selo de frescor: mostra a hora do último carregamento bem-sucedido. */
let ultimaAtualizacao = null;

function marcarAtualizado() {
  if (!atualizadoEl) return;
  ultimaAtualizacao = Date.now();
  const hora = new Date(ultimaAtualizacao).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO
  });
  const temAoVivo = jogosAtuais.some(aoVivo);
  atualizadoEl.textContent = temAoVivo
    ? `Ao vivo · atualizado às ${hora}`
    : `Atualizado às ${hora}`;
  atualizadoEl.classList.toggle("aovivo", temAoVivo);
  atualizadoEl.classList.remove("escondido");
}

/* ---------- Busca com retry limitado ---------- */

async function buscar(url, tentativas = 3) {
  let ultimoErro = null;

  for (let i = 0; i < tentativas; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    } catch {
      ultimoErro = new Error("Sem conexão. Verifique sua internet.");
      if (i < tentativas - 1) {
        await espera(1500 * (i + 1));
        continue;
      }
      throw ultimoErro;
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      /* resposta vazia ou não-JSON */
    }

    if (res.status === 429 || data?.code === 429) {
      ultimoErro = new Error(data?.error || "Limite de consultas atingido. Tente em instantes.");
      if (i < tentativas - 1) {
        await espera(tempoDoLimite(data?.error));
        continue;
      }
      throw ultimoErro;
    }

    if (!res.ok) {
      throw new Error(data?.error || `Não foi possível carregar os dados (${res.status}).`);
    }

    return data || {};
  }

  throw ultimoErro || new Error("Não foi possível carregar os dados.");
}

/* ---------- Render ---------- */

function escudo(time, lado) {
  const img = time?.crest
    ? `<img class="escudo" src="${escHtml(time.crest)}" alt="" loading="lazy" width="39" height="39">`
    : `<span class="escudo escudo-vazio" aria-hidden="true"></span>`;
  const nome = `<span class="time">${escHtml(nomeTime(time))}</span>`;
  return lado === "casa" ? `${nome}${img}` : `${img}${nome}`;
}

function marcarPernas(jogos) {
  const ordenados = [...jogos].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const chavePar = (m) =>
    [m.homeTeam?.id, m.awayTeam?.id].sort().join("-") + "|" + m.stage;

  const total = new Map();
  for (const m of ordenados) {
    if (!mataMata.has(m.stage)) continue;
    const chave = chavePar(m);
    total.set(chave, (total.get(chave) || 0) + 1);
  }

  const vistos = new Map();
  return ordenados.map((m) => {
    if (!mataMata.has(m.stage)) return m;
    const chave = chavePar(m);
    if ((total.get(chave) || 0) < 2) return m; // jogo único (ex.: final)
    const n = (vistos.get(chave) || 0) + 1;
    vistos.set(chave, n);
    return { ...m, perna: n === 1 ? "Ida" : "Volta" };
  });
}

function card(m) {
  const vivo = aoVivo(m);
  const encerrado = m.status === "FINISHED" || m.status === "AWARDED";
  const cancelado = ["CANCELLED", "POSTPONED", "SUSPENDED"].includes(m.status);
  const casa = nomeTime(m.homeTeam);
  const fora = nomeTime(m.awayTeam);
  const bolinha = vivo ? `<span class="bolinha"></span>` : "";
  const minuto = vivo && m.minute ? ` ${m.minute}'` : "";
  const rotulo = `${statusLabel[m.status] || m.status}${minuto}`;
  const texto = encodeURIComponent("Olá! gostaria de conhecer a plataforma");
  const palpite = encerrado || cancelado
    ? ""
    : `<a class="palpite" href="https://wa.me/${WHATSAPP}?text=${texto}" target="_blank" rel="noopener">Palpite</a>`;
  const perna = m.perna ? ` <span class="perna">${m.perna}</span>` : "";
  const estadoJogo = vivo ? " vivo" : "";

  return `
    <div class="jogo${estadoJogo}">
      <div class="match">
        <button type="button" class="match-abrir" data-id="${escHtml(m.id)}"
          aria-label="Ver detalhes de ${escHtml(casa)} contra ${escHtml(fora)}"></button>
        <span class="quando">${quando(m.utcDate)}</span>
        <span class="casa">${escudo(m.homeTeam, "casa")}</span>
        <span class="placar">
          ${placar(m)}
          <span class="status-placar ${statusClasse(m.status)}">${bolinha}${rotulo}${perna}</span>
        </span>
        <span class="fora">${escudo(m.awayTeam, "fora")}</span>
        <span class="estado-area">${palpite}</span>
      </div>
    </div>`;
}

function desenharJogos() {
  let lista = soAoVivo ? jogosAtuais.filter(aoVivo) : [...jogosAtuais];

  lista.sort(
    (a, b) =>
      prioridadeStatus(a.status) - prioridadeStatus(b.status) ||
      new Date(a.utcDate) - new Date(b.utcDate)
  );

  if (!lista.length) {
    matchesEl.innerHTML = `<p class="vazio">${
      soAoVivo ? "Não há jogos ao vivo no momento." : "Nenhum jogo nessa seleção."
    }</p>`;
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
      const ia = ORDEM_LIGAS.indexOf(a[1][0]?.competition?.code);
      const ib = ORDEM_LIGAS.indexOf(b[1][0]?.competition?.code);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    matchesEl.innerHTML = ordem
      .map(([liga, itens]) => {
        const code = itens[0]?.competition?.code || "";
        const nome = nomesLiga[code] || liga;
        const emblemaLiga = emblemas[code] || itens[0]?.competition?.emblem || "";
        return `
          <button type="button" class="liga" data-liga="${escHtml(code)}">
            ${emblemaLiga ? `<img src="${escHtml(emblemaLiga)}" alt="" loading="lazy">` : ""}${escHtml(nome)}
          </button>
          ${itens.map(card).join("")}`;
      })
      .join("");
    return;
  }

  matchesEl.innerHTML = lista.map(card).join("");
}

function zona(code, pos) {
  const regras = {
    BSA: { c: [1, 4], e: [5, 6], conf: [7, 12], r: [17, 20] },
    PL: { c: [1, 4], e: [5, 5], conf: [6, 6], r: [18, 20] },
    PD: { c: [1, 4], e: [5, 5], conf: [6, 6], r: [18, 20] },
    SA: { c: [1, 4], e: [5, 5], conf: [6, 6], r: [18, 20] },
    BL1: { c: [1, 4], e: [5, 5], conf: [6, 6], r: [17, 18] },
    FL1: { c: [1, 3], e: [4, 4], conf: [5, 5], r: [16, 18] },
    DED: { c: [1, 2], e: [3, 3], conf: [4, 4], r: [16, 18] },
    PPL: { c: [1, 2], e: [3, 3], conf: [4, 4], r: [16, 18] },
    ELC: { promo: [1, 2], playoff: [3, 6], r: [22, 24] }
  };
  const r = regras[code];
  if (!r) return "";
  if (r.c && pos >= r.c[0] && pos <= r.c[1]) return "champions";
  if (r.e && pos >= r.e[0] && pos <= r.e[1]) return "europa";
  if (r.conf && pos >= r.conf[0] && pos <= r.conf[1]) return "conference";
  if (r.promo && pos >= r.promo[0] && pos <= r.promo[1]) return "promo";
  if (r.playoff && pos >= r.playoff[0] && pos <= r.playoff[1]) return "playoff";
  if (r.r && pos >= r.r[0] && pos <= r.r[1]) return "rebaixamento";
  return "";
}

function legenda(code) {
  const legendas = {
    BSA: `
      <span><i class="champions"></i>Libertadores</span>
      <span><i class="europa"></i>Pré-Libertadores</span>
      <span><i class="conference"></i>Sul-Americana</span>
      <span><i class="rebaixamento"></i>Rebaixamento</span>`,
    ELC: `
      <span><i class="promo"></i>Promoção</span>
      <span><i class="playoff"></i>Playoff</span>
      <span><i class="rebaixamento"></i>Rebaixamento</span>`
  };
  if (legendas[code]) return legendas[code];
  if (!nomesLiga[code]) return "";
  return `
    <span><i class="champions"></i>Champions</span>
    <span><i class="europa"></i>Europa League</span>
    <span><i class="conference"></i>Conference</span>
    <span><i class="rebaixamento"></i>Rebaixamento</span>`;
}

function preencherRodadas(atual, selecionada, total) {
  const fim = Math.max(1, Number(total) || 38);
  const valor = String(selecionada || atual || 1);
  if (roundSelect.options.length === fim && roundSelect.value === valor) return;

  roundSelect.innerHTML = "";
  for (let i = 1; i <= fim; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = i === atual ? `Rodada ${i} (atual)` : `Rodada ${i}`;
    roundSelect.appendChild(opt);
  }
  roundSelect.value = valor;
}

/* ---------- Carregamentos ---------- */

async function carregarHoje({ forcar = false, silencioso = false } = {}) {
  modoHoje = true;
  soAoVivo = false;
  botaoAoVivo.classList.remove("ativo");
  botaoAoVivo.classList.remove("escondido");
  botaoAoVivo.setAttribute("aria-pressed", "false");
  roundSelect.classList.add("escondido");
  tituloJogos.textContent = "Jogos de hoje";
  document.title = "XTscores | Jogos de hoje";

  if (forcar) delete cacheJogos.hoje;
  const cached = cacheJogos.hoje;
  if (cacheValido(cached)) {
    jogosAtuais = cached.dados;
    desenharJogos();
    marcarAtualizado();
    agendarAtualizacao();
    return;
  }

  const exibido = mostrarLoading(silencioso);
  try {
    /*
     * A API filtra por data em UTC. Um jogo às 00:00 UTC pertence ao dia
     * anterior no horário de Brasília, então buscamos uma janela maior e
     * agrupamos pelo dia local.
     */
    const inicio = dataSP(-1);
    const fim = dataSP(6);
    const data = await buscar(`/api/jogos?date=${inicio}&dateTo=${fim}`);

    const porDia = new Map();
    for (const m of data.matches || []) {
      const dia = diaSP(m.utcDate);
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(m);
    }

    /*
     * Jogos iniciados antes da meia-noite (horário de Brasília) podem seguir
     * ao vivo no dia seguinte; entram na lista de hoje para não desaparecerem.
     */
    const ontemAoVivo = (porDia.get(dataSP(-1)) || []).filter(aoVivo);

    for (let i = 0; i < 7; i++) {
      let jogosDoDia = porDia.get(dataSP(i)) || [];
      if (i === 0 && ontemAoVivo.length) {
        const ids = new Set(jogosDoDia.map((m) => m.id));
        jogosDoDia = [...ontemAoVivo.filter((m) => !ids.has(m.id)), ...jogosDoDia];
      }

      if (jogosDoDia.length) {
        const novos = marcarPernas(jogosDoDia);
        cacheJogos.hoje = { dados: novos, salvoEm: Date.now() };
        jogosAtuais = novos;
        tituloJogos.textContent = i === 0 ? "Jogos de hoje" : "Próximos jogos";
        document.title = `XTscores | ${tituloJogos.textContent}`;
        desenharJogos();
        marcarAtualizado();
        return;
      }
    }

    jogosAtuais = [];
    cacheJogos.hoje = { dados: [], salvoEm: Date.now() };
    matchesEl.innerHTML = `<p class="vazio">Nenhum jogo encontrado nos próximos dias.</p>`;
  } catch (err) {
    jogosAtuais = [];
    matchesEl.innerHTML = `<p class="vazio">${escHtml(err.message)}</p>`;
  } finally {
    esconderLoading(exibido);
    agendarAtualizacao();
  }
}

async function carregarJogos({ forcar = false, silencioso = false } = {}) {
  if (!leagueSelect.value) {
    await carregarHoje({ forcar, silencioso });
    return;
  }

  modoHoje = false;
  soAoVivo = false;
  botaoAoVivo.classList.remove("ativo");
  botaoAoVivo.classList.add("escondido");
  roundSelect.classList.remove("escondido");

  const code = leagueSelect.value;
  const rodada = roundSelect.value;
  const chave = `${code}-${rodada || "atual"}`;
  tituloJogos.textContent = "Jogos";
  document.title = `XTscores | ${nomesLiga[code] || "Jogos"}`;

  if (forcar) delete cacheJogos[chave];
  const cached = cacheJogos[chave];
  if (cacheValido(cached)) {
    jogosAtuais = cached.dados;
    desenharJogos();
    marcarAtualizado();
    agendarAtualizacao();
    return;
  }

  const exibido = mostrarLoading(silencioso);
  try {
    const url = `/api/rodada/${encodeURIComponent(code)}${rodada ? `?rodada=${encodeURIComponent(rodada)}` : ""}`;
    const data = await buscar(url);
    if (chaveAtual() !== chave && leagueSelect.value === code) return;

    if (data.totalRodadas) {
      roundSelect.classList.remove("escondido");
      preencherRodadas(data.rodadaAtual || 1, data.rodada || 1, data.totalRodadas);
    } else {
      /* Copa/mata-mata: lista corrida de jogos, sem seletor de rodada. */
      roundSelect.classList.add("escondido");
      roundSelect.innerHTML = "";
      tituloJogos.textContent = nomesLiga[code] || "Jogos";
      document.title = `XTscores | ${nomesLiga[code] || "Jogos"}`;
    }
    const novos = marcarPernas(data.matches || []);
    const registro = { dados: novos, salvoEm: Date.now() };
    cacheJogos[chave] = registro;
    if (data.rodada) cacheJogos[`${code}-${data.rodada}`] = registro;
    jogosAtuais = novos;
    desenharJogos();
    marcarAtualizado();
  } catch (err) {
    jogosAtuais = [];
    matchesEl.innerHTML = `<p class="vazio">${escHtml(err.message)}</p>`;
  } finally {
    esconderLoading(exibido);
    agendarAtualizacao();
  }
}

async function carregarTabela({ forcar = false } = {}) {
  const code = leagueSelect.value;

  if (!code) {
    tituloTabela.classList.add("escondido");
    tableEl.innerHTML = `<p class="vazio">Escolha uma liga para ver a tabela.</p>`;
    return;
  }

  if (SEM_TABELA.has(code)) {
    tituloTabela.classList.add("escondido");
    tableEl.innerHTML = `<p class="vazio">Classificação não disponível para esta competição.</p>`;
    return;
  }

  tituloTabela.classList.remove("escondido");

  if (forcar) delete cacheTabela[code];
  const cached = cacheTabela[code];
  if (cacheValido(cached)) {
    tableEl.innerHTML = cached.dados;
    return;
  }

  const exibido = mostrarLoading();
  try {
    const data = await buscar(`/api/tabela/${encodeURIComponent(code)}`);
    if (leagueSelect.value !== code) return;

    const linhas = data.standings?.flatMap?.((s) => s.table || []) || [];

    if (!linhas.length) {
      tableEl.innerHTML = `<p class="vazio">Classificação indisponível para esta liga.</p>`;
      return;
    }

    const html = `
      <p class="legenda">${legenda(code)}</p>
      <table>
        <thead><tr><th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th></tr></thead>
        <tbody>
          ${linhas
            .map(
              (r) => `
            <tr class="${zona(code, r.position)}">
              <td>${r.position}</td>
              <td>${escHtml(nomeTime(r.team))}</td>
              <td>${r.points}</td>
              <td>${r.playedGames}</td>
              <td>${r.won}</td>
              <td>${r.draw}</td>
              <td>${r.lost}</td>
              <td>${r.goalDifference}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    cacheTabela[code] = { dados: html, salvoEm: Date.now() };
    if (leagueSelect.value === code) tableEl.innerHTML = html;
  } catch (err) {
    tableEl.innerHTML = `<p class="vazio">${escHtml(err.message)}</p>`;
  } finally {
    esconderLoading(exibido);
  }
}

/* ---------- Modal de detalhes ---------- */

async function abrirDetalhe(id) {
  const alvo = jogosAtuais.find((m) => String(m.id) === String(id));
  if (alvo) {
    rastrear(
      "jogo_aberto",
      `${nomeTime(alvo.homeTeam)} x ${nomeTime(alvo.awayTeam)}`,
      alvo.competition?.code || ""
    );
  }

  detail.innerHTML = `<h3 id="detail-titulo">Carregando…</h3>`;
  if (!modal.open) modal.showModal();

  try {
    const res = await fetch(`/api/jogo/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    const m = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(m.error || "Não foi possível carregar o jogo.");

    const gols = (m.goals || [])
      .map(
        (g) =>
          `<li>${escHtml(g.minute)}' ${escHtml(g.scorer?.name || "Gol")} <span class="time-gol">(${escHtml(g.team?.name || "")})</span></li>`
      )
      .join("");

    detail.innerHTML = `
      <h3 id="detail-titulo">${escHtml(nomeTime(m.homeTeam))} ${placar(m)} ${escHtml(nomeTime(m.awayTeam))}</h3>
      <p class="modal-info">${escHtml(m.competition?.name || "")} · ${escHtml(statusLabel[m.status] || m.status || "")}</p>
      ${gols ? `<ul class="gols">${gols}</ul>` : ""}`;
  } catch (err) {
    detail.innerHTML = `
      <h3 id="detail-titulo">Detalhes indisponíveis</h3>
      <p class="modal-info">${escHtml(err.message)}</p>`;
  }
}

/* ---------- Eventos ---------- */

matchesEl.addEventListener("click", (e) => {
  const liga = e.target.closest(".liga[data-liga]");
  if (liga) {
    leagueSelect.value = liga.dataset.liga;
    leagueSelect.dispatchEvent(new Event("change"));
    pintarPicker();
    return;
  }

  const btn = e.target.closest(".match-abrir");
  if (btn) abrirDetalhe(btn.dataset.id);
});

botaoAoVivo.addEventListener("click", () => {
  soAoVivo = !soAoVivo;
  rastrear("ao_vivo", soAoVivo ? "ativado" : "desativado", leagueSelect.value || "todas");
  botaoAoVivo.classList.toggle("ativo", soAoVivo);
  botaoAoVivo.setAttribute("aria-pressed", String(soAoVivo));
  desenharJogos();
});

document.querySelector("#close").addEventListener("click", () => modal.close());
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close();
});

leagueSelect.addEventListener("change", () => {
  rastrear(
    "liga",
    leagueSelect.value || "todas",
    leagueSelect.value ? nomesLiga[leagueSelect.value] : "Todas as ligas"
  );
  roundSelect.innerHTML = "";
  carregarJogos();
  carregarTabela();
});
roundSelect.addEventListener("change", () => {
  rastrear("rodada", roundSelect.value, leagueSelect.value || "todas");
  carregarJogos();
});

/* ---------- Seletor de ligas ---------- */

const picker = document.querySelector("#picker");
const pickerBtn = document.querySelector("#picker-btn");
const pickerLista = document.querySelector("#picker-lista");

function emblema(code) {
  return emblemas[code] ? `<img class="emblema" src="${escHtml(emblemas[code])}" alt="" loading="lazy">` : "";
}

function atualizarDestaque() {
  const opt = leagueSelect.selectedOptions[0];
  if (!opt || !opt.value || !emblemas[opt.value]) {
    ligaDestaque.classList.add("escondido");
    ligaDestaque.innerHTML = "";
    return;
  }
  ligaDestaque.classList.remove("escondido");
  ligaDestaque.innerHTML = `<img src="${escHtml(emblemas[opt.value])}" alt="" loading="lazy"><span>${escHtml(opt.textContent)}</span>`;
}

function pintarPicker() {
  const opt = leagueSelect.selectedOptions[0];
  pickerBtn.innerHTML = `${emblema(opt?.value)}<span>${escHtml(opt?.textContent || "Todas as ligas")}</span>`;
  atualizarDestaque();
}

function abrirPicker() {
  pickerLista.classList.remove("escondido");
  pickerBtn.setAttribute("aria-expanded", "true");
}
function fecharPicker({ focar = false } = {}) {
  pickerLista.classList.add("escondido");
  pickerBtn.setAttribute("aria-expanded", "false");
  if (focar) pickerBtn.focus();
}

function montarPicker() {
  pickerLista.innerHTML = [...leagueSelect.options]
    .map(
      (opt) => `
      <button type="button" class="picker-item" role="option" data-value="${escHtml(opt.value)}"
        aria-selected="${opt.selected ? "true" : "false"}">
        ${emblema(opt.value)}<span>${escHtml(opt.textContent)}</span>
      </button>`
    )
    .join("");
}

pickerBtn.addEventListener("click", () => {
  if (pickerLista.classList.contains("escondido")) abrirPicker();
  else fecharPicker();
});

pickerBtn.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    abrirPicker();
    pickerLista.querySelector(".picker-item")?.focus();
  }
});

pickerLista.addEventListener("keydown", (e) => {
  const itens = [...pickerLista.querySelectorAll(".picker-item")];
  const idx = itens.indexOf(document.activeElement);

  if (e.key === "ArrowDown") {
    e.preventDefault();
    itens[Math.min(idx + 1, itens.length - 1)]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    itens[Math.max(idx - 1, 0)]?.focus();
  } else if (e.key === "Home") {
    e.preventDefault();
    itens[0]?.focus();
  } else if (e.key === "End") {
    e.preventDefault();
    itens[itens.length - 1]?.focus();
  } else if (e.key === "Escape") {
    fecharPicker({ focar: true });
  }
});

pickerLista.addEventListener("click", (e) => {
  const item = e.target.closest(".picker-item");
  if (!item) return;
  leagueSelect.value = item.dataset.value;
  leagueSelect.dispatchEvent(new Event("change"));
  pintarPicker();
  fecharPicker({ focar: true });
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#picker")) fecharPicker();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !pickerLista.classList.contains("escondido")) {
    fecharPicker({ focar: true });
  }
});

/* ---------- Atualização automática ---------- */

async function atualizar() {
  if (document.hidden) return;
  if (leagueSelect.value) await carregarJogos({ forcar: true, silencioso: true });
  else await carregarHoje({ forcar: true, silencioso: true });
}

function agendarAtualizacao() {
  clearTimeout(timerAtualizacao);
  const intervalo = jogosAtuais.some(aoVivo) ? INTERVALO_AOVIVO : INTERVALO_NORMAL;
  timerAtualizacao = setTimeout(async () => {
    await atualizar();
    agendarAtualizacao();
  }, intervalo);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    atualizar();
    agendarAtualizacao();
  }
});

/* ---------- Início ---------- */

montarPicker();
pintarPicker();
carregarJogos();
carregarTabela();
agendarAtualizacao();
