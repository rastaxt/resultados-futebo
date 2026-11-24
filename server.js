require("dotenv").config();
const express = require("express");
const compression = require("compression");
const path = require("path");

const analytics = require("./lib/analytics");
const painel = require("./lib/painel");
const rotas = require("./lib/rotas");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
/* Em produção o padrão é escutar em todas as interfaces; localmente use HOST=127.0.0.1. */
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = process.env.FOOTBALL_TOKEN;
const BASE = "https://api.football-data.org/v4";
const PUBLIC_DIR = path.join(__dirname, "public");

const infoPainel = painel.iniciar();

/* Competições exibidas no site (códigos da football-data.org). */
const LIGAS = ["BSA", "PL", "PD", "SA", "BL1", "FL1", "CL", "CLI", "DED", "PPL", "ELC"];
const LIGAS_VALIDAS = new Set(LIGAS);

const limitarApi = rotas.limitarApi;

/* Total de rodadas de cada competição (temporada regular). */
const TOTAL_RODADAS = {
  BSA: 38,
  PL: 38,
  PD: 38,
  SA: 38,
  BL1: 34,
  FL1: 34,
  CL: 8, // fase de liga da Champions
  DED: 34,
  PPL: 34,
  ELC: 46
};

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_CODIGO = /^[A-Z0-9]{2,4}$/;
const RE_ID = /^\d{1,10}$/;
const CACHE_TTL = 5 * 60 * 1000;
/* Placar ao vivo precisa de cache curto: 1 minuto. */
const CACHE_TTL_JOGOS = 60 * 1000;

/* Cache em memória com TTL e deduplicação de requisições em andamento. */
const cache = new Map();
const emAndamento = new Map();

class UpstreamError extends Error {
  constructor(status, detalhe) {
    super(`API ${status}${detalhe ? `: ${detalhe}` : ""}`);
    this.status = status;
  }
}

function podarCache() {
  const agora = Date.now();
  for (const [chave, item] of cache) {
    if (agora - item.at > CACHE_TTL) cache.delete(chave);
  }
  // Limite de segurança: mantém apenas os itens mais recentes.
  if (cache.size > 200) {
    const antigos = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [chave] of antigos.slice(0, cache.size - 200)) cache.delete(chave);
  }
}

async function api(pathname, ttl = CACHE_TTL) {
  const hit = cache.get(pathname);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  if (emAndamento.has(pathname)) return emAndamento.get(pathname);

  const promessa = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(BASE + pathname, {
        headers: { "X-Auth-Token": TOKEN || "" },
        signal: ctrl.signal
      });

      if (!res.ok) {
        let detalhe = "";
        try {
          const corpo = await res.json();
          detalhe = corpo?.message || corpo?.error || "";
        } catch {
          /* corpo não-JSON */
        }
        throw new UpstreamError(res.status, detalhe);
      }

      const data = await res.json();
      cache.set(pathname, { at: Date.now(), data });
      podarCache();
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new UpstreamError(504, "tempo esgotado");
      throw err;
    } finally {
      clearTimeout(timer);
      emAndamento.delete(pathname);
    }
  })();

  emAndamento.set(pathname, promessa);
  return promessa;
}

/*
 * A API devolve jogos de mata-mata ainda sem os dois times definidos (ex.:
 * final da Libertadores); sem os times o card fica vazio, então descartamos.
 */
function semTimesIndefinidos(matches) {
  return (matches || []).filter((m) => m?.homeTeam?.name && m?.awayTeam?.name);
}

/*
 * Busca jogos de todas as ligas. Tenta uma única chamada (economiza cota da
 * API) e cai para chamadas por competição se o plano/endpoint não aceitar.
 */
async function jogosDoPeriodo(date, dateTo) {
  try {
    const data = await api(
      `/matches?competitions=${LIGAS.join(",")}&dateFrom=${date}&dateTo=${dateTo}`,
      CACHE_TTL_JOGOS
    );
    if (Array.isArray(data?.matches) && data.matches.length) return semTimesIndefinidos(data.matches);
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 429) throw err;
    console.warn("Chamada agrupada falhou, usando chamadas por liga:", err.message);
  }

  const grupos = await Promise.allSettled(
    LIGAS.map((code) =>
      api(
        `/competitions/${code}/matches?dateFrom=${date}&dateTo=${dateTo}`,
        CACHE_TTL_JOGOS
      )
    )
  );

  const vistos = new Set();
  const matches = [];
  for (const grupo of grupos) {
    if (grupo.status !== "fulfilled") continue;
    for (const m of grupo.value?.matches || []) {
      if (!vistos.has(m.id)) {
        vistos.add(m.id);
        matches.push(m);
      }
    }
  }
  if (!matches.length && grupos.every((g) => g.status === "rejected")) {
    const motivo = grupos.find((g) => g.status === "rejected")?.reason;
    throw motivo || new UpstreamError(502, "sem dados");
  }
  return semTimesIndefinidos(matches);
}

function dataSP(deslocamentoDias = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Date.now() + deslocamentoDias * 86400000));
}

function dataHoje() {
  return dataSP(0);
}

function diaSP(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(iso));
}

/*
 * Rodada que o usuário espera ver: a dos jogos ao vivo ou, na falta deles,
 * a dos jogos de hoje. A API às vezes informa currentMatchday adiantado,
 * o que esconderia partidas em andamento.
 */
function rodadaRelevante(jogos) {
  const daLiga = jogos.filter((m) => m.matchday);
  const vivo = daLiga.find((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
  if (vivo) return vivo.matchday;
  const hoje = dataHoje();
  const doDia = daLiga.find(
    (m) => diaSP(m.utcDate) === hoje && m.status !== "CANCELLED" && m.status !== "POSTPONED"
  );
  return doDia?.matchday || null;
}

function rodadaDoCache(code) {
  let melhor = null;
  for (const [chave, item] of cache) {
    if (!chave.startsWith("/matches?competitions=")) continue;
    if (Date.now() - item.at >= CACHE_TTL_JOGOS) continue;
    const jogos = item.data?.matches;
    if (!Array.isArray(jogos)) continue;
    const alvo = rodadaRelevante(jogos.filter((m) => m.competition?.code === code));
    if (alvo && (!melhor || item.at > melhor.at)) melhor = { at: item.at, rodada: alvo };
  }
  return melhor ? melhor.rodada : null;
}

async function rodadaDaJanela(code) {
  try {
    const janela = await api(
      `/competitions/${code}/matches?dateFrom=${dataSP(-1)}&dateTo=${dataSP(1)}`,
      CACHE_TTL_JOGOS
    );
    return rodadaRelevante(janela?.matches || []);
  } catch {
    return null;
  }
}

function responderErro(res, err) {
  const status = err instanceof UpstreamError ? err.status : 500;
  console.error("[api]", err.message);

  if (status === 429) {
    return res.status(429).json({
      error: "Muitas consultas em pouco tempo. Tente novamente em instantes.",
      code: 429
    });
  }
  if (status === 400 || status === 403 || status === 404) {
    return res.status(status).json({
      error: "Liga ou jogo indisponível no momento.",
      code: status
    });
  }
  return res.status(502).json({
    error: "Não foi possível carregar os dados agora. Tente novamente.",
    code: 502
  });
}

/* ---------- Segurança e performance ---------- */

app.disable("x-powered-by");
app.use(compression());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://crests.football-data.org https://www.google-analytics.com https://www.googletagmanager.com",
      "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  );
  next();
});

/* ---------- Estatísticas e painel ---------- */

rotas.montarColeta(app, analytics, painel);
rotas.montarPainel(app, analytics, painel);

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (/\.html?$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\.(png|jpe?g|gif|svg|ico|webp)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=2592000");
      } else if (/\.(css|js)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }

      if (/admin\.html?$/i.test(filePath)) {
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
      }
    }
  })
);

/* ---------- API ---------- */

app.get("/api/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, uptime: Math.round(process.uptime()), cache: cache.size });
});

app.get("/api/jogos", limitarApi, async (req, res) => {
  try {
    const date = RE_DATA.test(req.query.date || "") ? req.query.date : dataHoje();
    let dateTo = RE_DATA.test(req.query.dateTo || "") ? req.query.dateTo : date;
    if (dateTo < date) [date, dateTo] = [dateTo, date];

    // Limite de 10 dias por consulta (protege a cota da API).
    const limiteData = new Date(`${date}T00:00:00Z`);
    limiteData.setUTCDate(limiteData.getUTCDate() + 10);
    const limite = limiteData.toISOString().slice(0, 10);
    if (dateTo > limite) dateTo = limite;

    const matches = await jogosDoPeriodo(date, dateTo);
    res.setHeader("Cache-Control", "no-store");
    res.json({ matches, resultSet: { count: matches.length } });
  } catch (err) {
    responderErro(res, err);
  }
});

app.get("/api/tabela/:code", limitarApi, async (req, res) => {
  const code = req.params.code;
  if (!RE_CODIGO.test(code) || !LIGAS_VALIDAS.has(code)) {
    return res.status(400).json({ error: "Código de liga inválido.", code: 400 });
  }
  try {
    const data = await api(`/competitions/${code}/standings`);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(data);
  } catch (err) {
    responderErro(res, err);
  }
});

app.get("/api/jogo/:id", limitarApi, async (req, res) => {
  const id = req.params.id;
  if (!RE_ID.test(id)) {
    return res.status(400).json({ error: "Identificador de jogo inválido.", code: 400 });
  }
  try {
    const data = await api(`/matches/${id}`, CACHE_TTL_JOGOS);
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  } catch (err) {
    responderErro(res, err);
  }
});

app.get("/api/rodada/:code", limitarApi, async (req, res) => {
  const code = req.params.code;
  if (!RE_CODIGO.test(code) || !LIGAS_VALIDAS.has(code)) {
    return res.status(400).json({ error: "Código de liga inválido.", code: 400 });
  }

  try {
    /*
     * Competições de mata-mata (ex.: Libertadores) não têm tabela de rodadas
     * na API: mostramos os jogos da janela atual em vez de buscar matchday.
     */
    if (!TOTAL_RODADAS[code]) {
      const janela = await api(
        `/competitions/${code}/matches?dateFrom=${dataSP(-1)}&dateTo=${dataSP(21)}`,
        CACHE_TTL_JOGOS
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ...janela,
        matches: semTimesIndefinidos(janela?.matches),
        rodadaAtual: null,
        rodada: null,
        totalRodadas: 0
      });
    }

    const totalRodadas = TOTAL_RODADAS[code] || 38;
    const tabela = await api(`/competitions/${code}/standings`);
    const atual = tabela?.season?.currentMatchday || 1;

    const pedida = Number(req.query.rodada);
    let alvo;
    if (Number.isFinite(pedida) && pedida >= 1) {
      alvo = pedida;
    } else {
      alvo = rodadaDoCache(code) || (await rodadaDaJanela(code)) || atual;
    }
    const rodada = Math.min(Math.max(Math.floor(alvo), 1), totalRodadas);

    const data = await api(
      `/competitions/${code}/matches?matchday=${rodada}`,
      CACHE_TTL_JOGOS
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...data,
      rodadaAtual: atual,
      rodada,
      totalRodadas
    });
  } catch (err) {
    responderErro(res, err);
  }
});

/*
 * Simulador do Brasileirão: devolve a temporada inteira num formato enxuto.
 * Duas chamadas à API (temporadas e jogos), ambas com cache do servidor.
 */
const SIMULADOR_LIGA = "BSA";

app.get("/api/simulador", limitarApi, async (req, res) => {
  try {
    const competicao = await api(`/competitions/${SIMULADOR_LIGA}`);
    const temporadas = (competicao?.seasons || [])
      .filter((s) => s?.startDate)
      .map((s) => ({
        temporada: Number(String(s.startDate).slice(0, 4)),
        atual: Boolean(s.current),
        rodadaAtual: s.currentMatchday || null
      }))
      .filter((s) => Number.isInteger(s.temporada))
      .sort((a, b) => b.temporada - a.temporada);

    const pedida = Number(req.query.season);
    const escolhida =
      temporadas.find((t) => t.temporada === pedida) ||
      temporadas.find((t) => t.atual) ||
      temporadas[0];

    if (!escolhida) throw new UpstreamError(502, "sem temporadas disponíveis");

    const dados = await api(
      `/competitions/${SIMULADOR_LIGA}/matches?season=${escolhida.temporada}`
    );

    const partidas = semTimesIndefinidos(dados?.matches).map((m) => ({
      id: m.id,
      rodada: m.matchday || null,
      em: m.utcDate,
      status: m.status,
      casa: {
        id: m.homeTeam.id,
        nome: m.homeTeam.shortName || m.homeTeam.name,
        escudo: m.homeTeam.crest || ""
      },
      fora: {
        id: m.awayTeam.id,
        nome: m.awayTeam.shortName || m.awayTeam.name,
        escudo: m.awayTeam.crest || ""
      },
      placar:
        m.score?.fullTime?.home == null
          ? null
          : [m.score.fullTime.home, m.score.fullTime.away]
    }));

    res.setHeader("Cache-Control", "public, max-age=120");
    res.json({
      competicao: competicao?.name || "Campeonato Brasileiro Série A",
      temporadas,
      temporada: escolhida.temporada,
      rodadaAtual: escolhida.rodadaAtual,
      partidas
    });
  } catch (err) {
    responderErro(res, err);
  }
});

/* Página do simulador (URL limpa, sem extensão). */
app.get("/simulador", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(PUBLIC_DIR, "simulador.html"));
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

const servidor = app.listen(PORT, HOST, () => {
  console.log(`XTscores no ar em http://localhost:${PORT}`);
  console.log(`Painel administrativo: http://localhost:${PORT}/admin`);

  if (infoPainel.senhaInicial) {
    console.log("");
    console.log("=== PAINEL XTSCORES - SENHA INICIAL ===");
    console.log(`Senha: ${infoPainel.senhaInicial}`);
    console.log("Troque a senha em Configuracoes depois de entrar.");
    console.log("=======================================");
    console.log("");
  }

  if (painel.senhaDoAmbiente()) {
    console.log("[painel] senha definida pela variavel ADMIN_SENHA.");
  }

  console.log(
    `[painel] dados em ${analytics.DIR_DADOS}${
      process.env.DADOS_DIR ? "" : " (defina DADOS_DIR para um disco persistente)"
    }`
  );

  if (!TOKEN) console.warn("Aviso: FOOTBALL_TOKEN não definido no .env");

  const limpar = () =>
    analytics
      .limparAnteriores(painel.obter().retencaoDias)
      .then((removidos) => {
        if (removidos) console.log(`[painel] ${removidos} arquivo(s) antigo(s) removido(s).`);
      })
      .catch((err) => console.warn("[painel] limpeza:", err.message));

  limpar();
  setInterval(limpar, 6 * 3600 * 1000).unref();
});

/* Encerra com segurança: para de aceitar conexões e grava a fila de estatísticas. */
let encerrando = false;
function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[servidor] ${sinal} recebido, encerrando...`);

  const prazo = setTimeout(() => process.exit(0), 8000);
  prazo.unref();

  servidor.close(() => {
    analytics
      .aguardarGravacao()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));
