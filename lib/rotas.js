"use strict";

/*
 * Rotas de coleta de estatísticas e do painel administrativo.
 */

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const geoip = require("./geo");

const COOKIE = "xt_painel";
const JANELA_LOGIN_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 6;
const EVENTOS_PERMITIDOS = new Set([
  "liga",
  "rodada",
  "ao_vivo",
  "jogo_aberto",
  "whatsapp",
  "palpite",
  "tema",
  "busca",
  "compartilhar",
  "tabela"
]);

const UA_BOT =
  /bot|crawl|spider|slurp|headless|preview|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|facebookexternalhit|embedly/i;

const limiterLogin = new Map();
const limiterTrack = new Map();
const limiterApi = new Map();

/* Limite de requisições por IP nas rotas públicas da API (0 desativa). */
const LIMITE_API_MINUTO =
  process.env.API_MAX_MIN == null || String(process.env.API_MAX_MIN).trim() === ""
    ? 120
    : Math.max(0, Math.floor(Number(process.env.API_MAX_MIN)) || 0);

/* ---------- Utilidades HTTP ---------- */

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || "";
  for (const parte of bruto.split(";")) {
    const corte = parte.indexOf("=");
    if (corte < 0) continue;
    if (parte.slice(0, corte).trim() !== nome) continue;
    try {
      return decodeURIComponent(parte.slice(corte + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function usarHttps(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return proto === "https";
}

function definirCookie(req, res, token) {
  const partes = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=28800"
  ];
  if (usarHttps(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function limparCookie(req, res) {
  const partes = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (usarHttps(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    return new URL(origem).host === req.headers.host;
  } catch {
    return false;
  }
}

function enderecoConexao(req) {
  return String(req.socket?.remoteAddress || "")
    .replace(/^::ffff:/i, "")
    .trim()
    .slice(0, 64);
}

function ipLocal(ip) {
  const limpo = String(ip || "").replace(/^::ffff:/i, "").trim();
  if (!limpo) return false;
  if (limpo === "::1" || limpo === "0.0.0.0") return true;
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(limpo)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(limpo)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(limpo) || /^fe80:/i.test(limpo)) return true;
  return false;
}

/*
 * Cabeçalhos de proxy só são confiáveis quando existe um proxy na frente.
 * TRUST_PROXY=1 força o uso, TRUST_PROXY=0 ignora; sem a variável confiamos
 * apenas quando a conexão chega de um endereço local/privado (proxy na mesma máquina).
 */
function confiarNoProxy(req) {
  const modo = String(process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (["1", "true", "sim", "on"].includes(modo)) return true;
  if (["0", "false", "nao", "não", "off"].includes(modo)) return false;
  return ipLocal(enderecoConexao(req));
}

function ipDoReq(req) {
  const direto = enderecoConexao(req);
  if (!confiarNoProxy(req)) return direto;

  /* Hostinger/CDN envia o visitante em X-Real-IP e no último item do X-Forwarded-For. */
  const real = String(req.headers["x-real-ip"] || "").trim().slice(0, 64);
  if (real) return real;

  const lista = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((parte) => parte.trim().slice(0, 64))
    .filter(Boolean);
  if (lista.length) return lista[lista.length - 1];

  return direto;
}

/*
 * Rate limit simples por IP para as rotas públicas da API, que consomem a
 * cota de 10 req/min da football-data.org.
 */
function limitarApi(req, res, next) {
  if (!LIMITE_API_MINUTO) return next();

  const ip = ipDoReq(req);
  const agora = Date.now();
  let janela = limiterApi.get(ip);
  if (!janela || agora - janela.inicio > 60000) {
    janela = { inicio: agora, total: 0 };
    limiterApi.set(ip, janela);
  }
  janela.total++;
  podarMapa(limiterApi, 4000);

  if (janela.total > LIMITE_API_MINUTO) {
    const espera = Math.max(1, Math.ceil((60000 - (agora - janela.inicio)) / 1000));
    res.setHeader("Retry-After", String(espera));
    return res.status(429).json({
      error: "Muitas consultas em pouco tempo. Tente novamente em instantes.",
      code: 429,
      retryAfter: espera
    });
  }

  next();
}

function podarMapa(mapa, limite = 3000) {
  if (mapa.size <= limite) return;
  for (const chave of mapa.keys()) {
    if (mapa.size <= limite) break;
    mapa.delete(chave);
  }
}

/* ---------- Limites de uso ---------- */

function podeTentarLogin(ip) {
  const agora = Date.now();
  const registro = limiterLogin.get(ip);
  if (!registro) return true;

  if (registro.bloqueadoAte && registro.bloqueadoAte > agora) return false;
  if (agora - registro.inicio > JANELA_LOGIN_MS) {
    limiterLogin.delete(ip);
    return true;
  }
  return registro.tentativas < MAX_TENTATIVAS;
}

function esperaLoginMs(ip) {
  const registro = limiterLogin.get(ip);
  if (!registro || !registro.bloqueadoAte) return 0;
  return Math.max(0, registro.bloqueadoAte - Date.now());
}

function falhouLogin(ip) {
  const agora = Date.now();
  const registro = limiterLogin.get(ip);
  if (!registro || agora - registro.inicio > JANELA_LOGIN_MS) {
    limiterLogin.set(ip, { inicio: agora, tentativas: 1, bloqueadoAte: 0 });
  } else {
    registro.tentativas++;
    if (registro.tentativas >= MAX_TENTATIVAS) registro.bloqueadoAte = agora + JANELA_LOGIN_MS;
  }
  podarMapa(limiterLogin, 1000);
}

function liberarTrack(ip) {
  const agora = Date.now();
  let janela = limiterTrack.get(ip);
  if (!janela || agora - janela.inicio > 60000) {
    janela = { inicio: agora, total: 0 };
    limiterTrack.set(ip, janela);
  }
  janela.total++;
  podarMapa(limiterTrack, 3000);
  return janela.total <= 240;
}

/* ---------- Normalização dos dados ---------- */

function limparTexto(valor, tamanho) {
  return String(valor ?? "")
    .replace(/[\u0000-\u001f\u007f|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, tamanho);
}

function normalizarRota(valor) {
  let rota = limparTexto(valor, 120).split("?")[0].split("#")[0];
  if (!rota) rota = "/";
  if (!rota.startsWith("/")) rota = `/${rota}`;
  if (rota.startsWith("//")) rota = rota.replace(/^\/+/, "/");
  if (!/^\/[A-Za-z0-9._\-/]*$/.test(rota)) rota = "/";
  return rota.slice(0, 80);
}

function hostAtual(req) {
  return String(req.headers.host || "")
    .split(":")[0]
    .replace(/^www\./i, "")
    .toLowerCase();
}

function hostDe(valor, req) {
  try {
    const url = new URL(String(valor));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || host === hostAtual(req)) return "";
    return host.slice(0, 60);
  } catch {
    return "";
  }
}

function navegadorDe(agente) {
  if (/Edg\//.test(agente)) return "Edge";
  if (/OPR\/|Opera/.test(agente)) return "Opera";
  if (/SamsungBrowser/.test(agente)) return "Samsung Internet";
  if (/Firefox|FxiOS/.test(agente)) return "Firefox";
  if (/CriOS|Chrome/.test(agente)) return "Chrome";
  if (/Safari/.test(agente)) return "Safari";
  return "Outro";
}

function sistemaDe(agente) {
  if (/Android/.test(agente)) return "Android";
  if (/iPhone|iPad|iPod/.test(agente)) return "iOS";
  if (/Windows/.test(agente)) return "Windows";
  if (/Mac OS X|Macintosh/.test(agente)) return "macOS";
  if (/Linux/.test(agente)) return "Linux";
  return "Outro";
}

function dispositivoDe(agente) {
  if (/SmartTV|HbbTV|PlayStation|Xbox|Nintendo/i.test(agente)) return "TV/Console";
  if (/iPad|Tablet|PlayBook|Silk/i.test(agente)) return "Tablet";
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(agente)) return "Celular";
  return "Computador";
}

function paisDe(req) {
  const bruto = String(
    req.headers["cf-ipcountry"] ||
      req.headers["x-vercel-ip-country"] ||
      req.headers["x-country-code"] ||
      req.headers["x-geo-country"] ||
      ""
  ).toUpperCase();
  if (!/^[A-Z]{2}$/.test(bruto)) return "";
  if (bruto === "XX" || bruto === "T1") return "";
  return bruto;
}

/* Quando o CDN já entrega cidade/estado nos headers, não é preciso consultar o IP. */
function geoDosHeaders(req) {
  const pais = paisDe(req);
  const ufBruta = limparTexto(
    req.headers["cf-region-code"] || req.headers["x-geo-region-code"] || "",
    2
  ).toUpperCase();

  return {
    cidade: limparTexto(
      req.headers["cf-ipcity"] ||
        req.headers["x-vercel-ip-city"] ||
        req.headers["x-geo-city"] ||
        "",
      60
    ),
    estado: limparTexto(
      req.headers["cf-region"] ||
        req.headers["x-vercel-ip-country-region"] ||
        req.headers["x-geo-region"] ||
        "",
      60
    ),
    uf: pais === "BR" && /^[A-Z]{2}$/.test(ufBruta) ? ufBruta : "",
    pais
  };
}

/* ---------- Coleta ---------- */

function montarColeta(app, analytics, painel) {
  const json = express.json({ limit: "4kb" });

  app.post("/api/track", json, async (req, res) => {
    res.status(204);

    const config = painel.obter();
    if (!config.coleta) return res.end();

    if (String(req.headers.dnt || "") === "1" || String(req.headers["sec-gpc"] || "") === "1") {
      return res.end();
    }

    /* Beacons de outras origens são descartados (protege as estatísticas). */
    const mesmoSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (mesmoSite && !["same-origin", "same-site", "none"].includes(mesmoSite)) return res.end();
    if (req.headers.origin && !mesmaOrigem(req)) return res.end();

    const agente = String(req.headers["user-agent"] || "").slice(0, 500);
    if (!agente || UA_BOT.test(agente)) return res.end();

    const ip = ipDoReq(req);
    if (!liberarTrack(ip)) return res.end();

    const corpo = req.body;
    if (!corpo || typeof corpo !== "object") return res.end();

    const tipo = String(corpo.t || "");
    if (tipo !== "pageview" && tipo !== "saida" && tipo !== "evento") return res.end();

    const rota = normalizarRota(corpo.r);
    if (rota.startsWith("/admin") || rota.startsWith("/api/")) return res.end();

    const sessao = /^[a-f0-9]{16,32}$/.test(String(corpo.s || ""))
      ? String(corpo.s)
      : crypto.randomBytes(12).toString("hex");

    const ts = Date.now();
    const doHeader = geoDosHeaders(req);
    let local = doHeader;

    if (tipo === "pageview" && config.geo && (!doHeader.cidade || !doHeader.estado)) {
      const extra = await geoip.resolver(ip, analytics.diaSP(ts)).catch(() => null);
      if (extra) {
        local = {
          cidade: doHeader.cidade || extra.cidade || "",
          estado: doHeader.estado || extra.estado || "",
          uf: doHeader.uf || extra.uf || "",
          pais: doHeader.pais || extra.pais || ""
        };
      }
    }

    const registro = {
      ts,
      t: tipo,
      ses: sessao,
      vis: analytics.hashVisitante(ip, agente, analytics.diaSP(ts)),
      rota,
      ref: tipo === "pageview" ? hostDe(corpo.ref, req) : "",
      disp: dispositivoDe(agente),
      nav: navegadorDe(agente),
      so: sistemaDe(agente)
    };

    if (local.cidade) registro.cidade = local.cidade;
    if (local.estado) registro.estado = local.estado;
    if (local.uf) registro.uf = local.uf;
    if (local.pais) registro.pais = local.pais;

    if (tipo === "saida") {
      const duracao = Number(corpo.dur);
      const rolagem = Number(corpo.rol);
      if (Number.isFinite(duracao) && duracao > 0) registro.dur = Math.min(Math.round(duracao), 6 * 3600 * 1000);
      if (Number.isFinite(rolagem)) registro.rol = Math.min(Math.max(Math.round(rolagem), 0), 100);
      if (registro.dur == null && registro.rol == null) return res.end();
    }

    if (tipo === "evento") {
      const nome = limparTexto(corpo.n, 40);
      if (!EVENTOS_PERMITIDOS.has(nome)) return res.end();
      registro.n = nome;
      registro.v = limparTexto(corpo.v, 80);
      registro.c = limparTexto(corpo.c, 80);
    }

    try {
      await analytics.registrar(registro);
    } catch {
      /* nunca expõe erro de gravação ao visitante */
    }
    res.end();
  });
}

/* ---------- Painel ---------- */

function montarPainel(app, analytics, painel) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  router.use(express.json({ limit: "8kb" }));

  router.get("/sessao", (req, res) => {
    const autenticado = painel.validarToken(lerCookie(req, COOKIE));
    res.json({
      autenticado,
      senhaAmbiente: Boolean(painel.senhaDoAmbiente())
    });
  });

  router.post("/entrar", (req, res) => {
    const ip = ipDoReq(req);

    if (!mesmaOrigem(req)) {
      return res.status(403).json({ error: "Origem não permitida." });
    }
    if (!podeTentarLogin(ip)) {
      const restante = esperaLoginMs(ip);
      const minutos = Math.max(1, Math.ceil(restante / 60000));
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(restante / 1000))));
      return res.status(429).json({
        error: `Muitas tentativas de login. Tente novamente em ${minutos} min.`,
        retryAfter: Math.max(1, Math.ceil(restante / 1000))
      });
    }

    /* A senha é comparada como foi digitada: nada de normalizar espaços. */
    const senha = String(req.body?.senha ?? "").slice(0, 200);
    if (!senha || !painel.conferirSenha(senha)) {
      falhouLogin(ip);
      return res.status(401).json({ error: "Senha incorreta." });
    }

    limiterLogin.delete(ip);
    definirCookie(req, res, painel.criarToken());
    res.json({ ok: true });
  });

  router.post("/sair", (req, res) => {
    limparCookie(req, res);
    res.json({ ok: true });
  });

  /* Daqui para baixo, tudo exige sessão válida. */
  router.use((req, res, next) => {
    if (!painel.validarToken(lerCookie(req, COOKIE))) {
      return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    }
    if (req.method !== "GET" && req.method !== "HEAD" && !mesmaOrigem(req)) {
      return res.status(403).json({ error: "Origem não permitida." });
    }
    next();
  });

  router.get("/resumo", async (req, res) => {
    try {
      const dias = [1, 7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 7;
      const [atual, anterior] = await Promise.all([
        analytics.agregarPeriodo(dias),
        analytics.agregarPeriodo(dias, 1)
      ]);

      const variacao = (valor, base) => {
        if (!base) return valor > 0 ? 100 : 0;
        return Number((((valor - base) / base) * 100).toFixed(1));
      };

      const kpis = {};
      for (const chave of [
        "visualizacoes",
        "visitantes",
        "sessoes",
        "duracaoMedia",
        "rejeicao",
        "rolagemMedia"
      ]) {
        kpis[chave] = {
          valor: atual.kpis[chave],
          anterior: anterior.kpis[chave],
          variacao: variacao(atual.kpis[chave], anterior.kpis[chave])
        };
      }

      res.json({
        ...atual,
        kpis,
        retencaoDias: painel.obter().retencaoDias,
        primeiroDia: await analytics.primeiroDia(),
        tempoReal: analytics.tempoReal(),
        atualizadoEm: new Date().toISOString()
      });
    } catch (err) {
      console.error("[painel] resumo:", err.message);
      res.status(500).json({ error: "Não foi possível calcular as estatísticas." });
    }
  });

  router.get("/tempo-real", (req, res) => {
    res.json({ ...analytics.tempoReal(), atualizadoEm: new Date().toISOString() });
  });

  router.get("/config", (req, res) => {
    const config = painel.obter();
    res.json({
      coleta: config.coleta,
      geo: config.geo,
      retencaoDias: config.retencaoDias,
      senhaAmbiente: Boolean(painel.senhaDoAmbiente()),
      criadoEm: config.criadoEm,
      geoInfo: geoip.info(analytics.diaSP())
    });
  });

  router.post("/config", async (req, res) => {
    const mudancas = {};
    if (typeof req.body?.coleta === "boolean") mudancas.coleta = req.body.coleta;
    if (typeof req.body?.geo === "boolean") mudancas.geo = req.body.geo;

    const retencao = Number(req.body?.retencaoDias);
    if (Number.isFinite(retencao)) {
      mudancas.retencaoDias = Math.min(730, Math.max(7, Math.floor(retencao)));
    }

    if (!Object.keys(mudancas).length) {
      return res.status(400).json({ error: "Nada para atualizar." });
    }

    const config = painel.atualizar(mudancas);
    if (mudancas.retencaoDias) {
      await analytics.limparAnteriores(config.retencaoDias).catch(() => 0);
    }

    res.json({
      ok: true,
      coleta: config.coleta,
      geo: config.geo,
      retencaoDias: config.retencaoDias
    });
  });

  router.post("/senha", (req, res) => {
    if (painel.senhaDoAmbiente()) {
      return res.status(400).json({
        error: "A senha é definida pela variável ADMIN_SENHA. Altere-a no servidor para trocar."
      });
    }

    const atual = String(req.body?.atual ?? "").slice(0, 200);
    const nova = String(req.body?.nova ?? "");

    if (!painel.conferirSenha(atual)) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    if (nova.length < 8 || nova.length > 200) {
      return res.status(400).json({ error: "A nova senha precisa ter entre 8 e 200 caracteres." });
    }

    painel.alterarSenha(nova);
    definirCookie(req, res, painel.criarToken());
    res.json({ ok: true });
  });

  router.get("/exportar", async (req, res) => {
    const dias = [1, 7, 30, 90, 365].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    const tipo = ["resumo", "paginas", "eventos", "localidades", "bruto"].includes(
      String(req.query.tipo)
    )
      ? String(req.query.tipo)
      : "resumo";

    try {
      let conteudo;
      if (tipo === "paginas") conteudo = await analytics.exportarPaginasCSV(dias);
      else if (tipo === "eventos") conteudo = await analytics.exportarEventosCSV(dias);
      else if (tipo === "localidades") conteudo = await analytics.exportarLocalidadesCSV(dias);
      else if (tipo === "bruto") conteudo = await analytics.exportarBrutoCSV(dias);
      else conteudo = await analytics.exportarResumoCSV(dias);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="xtscores-${tipo}-${analytics.diaSP()}.csv"`
      );
      res.send(`\uFEFF${conteudo}`);
    } catch (err) {
      console.error("[painel] exportar:", err.message);
      res.status(500).json({ error: "Não foi possível gerar o arquivo." });
    }
  });

  router.post("/limpar", async (req, res) => {
    if (String(req.body?.confirmar || "").toUpperCase() !== "APAGAR") {
      return res.status(400).json({ error: 'Digite "APAGAR" para confirmar.' });
    }

    try {
      let removidos;
      if (req.body?.tudo === true) {
        removidos = await analytics.limparTudo();
      } else {
        const dias = Math.min(3650, Math.max(0, Math.floor(Number(req.body?.dias) || 0)));
        removidos = await analytics.limparAnteriores(dias);
      }
      res.json({ ok: true, removidos });
    } catch (err) {
      console.error("[painel] limpar:", err.message);
      res.status(500).json({ error: "Não foi possível apagar os dados." });
    }
  });

  router.use((req, res) => {
    res.status(404).json({ error: "Rota não encontrada." });
  });

  app.use("/api/admin", router);

  app.get("/admin", (req, res) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
  });
}

module.exports = { montarColeta, montarPainel, limitarApi };
