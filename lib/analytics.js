"use strict";

/*
 * Coleta e agregação de estatísticas próprias do XTscores.
 *
 * Princípios:
 *  - sem cookies de analytics;
 *  - o IP nunca é gravado: gera-se um hash diário (IP + navegador + dia + segredo);
 *  - apenas dados derivados são armazenados (rota, origem, dispositivo, navegador, sistema, país);
 *  - registros ficam em NDJSON por dia, com retenção configurável.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const DIR_DADOS = process.env.DADOS_DIR
  ? path.resolve(process.env.DADOS_DIR)
  : path.join(__dirname, "..", "dados");
const DIR = path.join(DIR_DADOS, "analytics");
const ARQ_SEGREDO = path.join(DIR, ".segredo");

const LIMITE_ARQUIVO = 40 * 1024 * 1024; // 40 MB por dia, proteção de disco
const MAX_RECENTES = 4000;
const TTL_CACHE = 20 * 1000;
const MAX_CACHE = 24;

const fmtDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const fmtHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  hourCycle: "h23"
});

let filaGravacao = Promise.resolve();
let segredoVisitante = null;
const recentes = [];
const cacheAgregados = new Map();

/* ---------- Datas (fuso do site) ---------- */

function diaSP(ts = Date.now()) {
  return fmtDia.format(new Date(ts));
}

function horaSP(ts) {
  return Number(fmtHora.format(new Date(ts)));
}

function somarDias(dia, quantidade) {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + quantidade);
  return d.toISOString().slice(0, 10);
}

function listarDias(inicio, fim) {
  const dias = [];
  let atual = inicio;
  while (atual <= fim) {
    dias.push(atual);
    atual = somarDias(atual, 1);
  }
  return dias;
}

/* ---------- Segredo para anonimizar visitantes ---------- */

function obterSegredoVisitante() {
  if (segredoVisitante) return segredoVisitante;
  fs.mkdirSync(DIR, { recursive: true });
  try {
    segredoVisitante = fs.readFileSync(ARQ_SEGREDO, "utf8").trim();
  } catch {
    /* primeiro uso */
  }
  if (!segredoVisitante || segredoVisitante.length < 32) {
    segredoVisitante = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(ARQ_SEGREDO, segredoVisitante, { mode: 0o600 });
  }
  return segredoVisitante;
}

function hashVisitante(ip, agente, dia) {
  return crypto
    .createHash("sha256")
    .update(`${ip}|${agente}|${dia}|${obterSegredoVisitante()}`)
    .digest("hex")
    .slice(0, 16);
}

/* ---------- Gravação ---------- */

function guardarRecente(registro) {
  recentes.push(registro);
  if (recentes.length > MAX_RECENTES) recentes.splice(0, recentes.length - MAX_RECENTES);
}

async function gravarLinha(dia, linha) {
  await fsp.mkdir(DIR, { recursive: true });
  const arquivo = path.join(DIR, `${dia}.ndjson`);
  const info = await fsp.stat(arquivo).catch(() => null);
  if (info && info.size > LIMITE_ARQUIVO) return;
  await fsp.appendFile(arquivo, linha, "utf8");
}

function registrar(registro) {
  const completo = {
    ...registro,
    ts: registro.ts || Date.now()
  };
  completo.dia = diaSP(completo.ts);
  completo.hora = horaSP(completo.ts);

  guardarRecente(completo);

  const linha = `${JSON.stringify(completo)}\n`;
  filaGravacao = filaGravacao
    .then(() => gravarLinha(completo.dia, linha))
    .catch((err) => console.error("[analytics] falha ao gravar:", err.message));
  return filaGravacao;
}

function aguardarGravacao() {
  return filaGravacao;
}

/* ---------- Agregação ---------- */

function novoAcumulador() {
  return {
    views: 0,
    visitantes: new Set(),
    sessoes: new Set(),
    serie: new Map(),
    paginas: new Map(),
    origens: new Map(),
    disp: new Map(),
    nav: new Map(),
    so: new Map(),
    pais: new Map(),
    cidades: new Map(),
    estados: new Map(),
    ufs: new Map(),
    horas: new Array(24).fill(0),
    eventos: new Map(),
    duracoes: [],
    rolagens: [],
    paginasPorSessao: new Map()
  };
}

function incMapa(mapa, chave) {
  if (!chave) return;
  mapa.set(chave, (mapa.get(chave) || 0) + 1);
}

function acumular(acc, ev) {
  if (!ev || typeof ev !== "object") return;

  if (ev.t === "pageview") {
    acc.views++;
    if (ev.vis) acc.visitantes.add(ev.vis);
    if (ev.ses) acc.sessoes.add(ev.ses);

    if (ev.dia) {
      let dia = acc.serie.get(ev.dia);
      if (!dia) {
        dia = { views: 0, vis: new Set(), ses: new Set() };
        acc.serie.set(ev.dia, dia);
      }
      dia.views++;
      if (ev.vis) dia.vis.add(ev.vis);
      if (ev.ses) dia.ses.add(ev.ses);
    }

    const rota = ev.rota || "/";
    let pagina = acc.paginas.get(rota);
    if (!pagina) {
      pagina = { views: 0, vis: new Set() };
      acc.paginas.set(rota, pagina);
    }
    pagina.views++;
    if (ev.vis) pagina.vis.add(ev.vis);

    incMapa(acc.origens, ev.ref || "Direto");
    incMapa(acc.disp, ev.disp);
    incMapa(acc.nav, ev.nav);
    incMapa(acc.so, ev.so);
    incMapa(acc.pais, ev.pais);
    if (ev.cidade) incMapa(acc.cidades, `${ev.cidade}|${ev.estado || ""}|${ev.uf || ""}`);
    if (ev.estado) incMapa(acc.estados, ev.estado);
    if (ev.uf) incMapa(acc.ufs, ev.uf);
    if (Number.isFinite(ev.hora) && ev.hora >= 0 && ev.hora < 24) acc.horas[ev.hora]++;
    if (ev.ses) acc.paginasPorSessao.set(ev.ses, (acc.paginasPorSessao.get(ev.ses) || 0) + 1);
    return;
  }

  if (ev.t === "saida") {
    if (Number.isFinite(ev.dur) && ev.dur > 0) acc.duracoes.push(Math.min(ev.dur, 6 * 3600 * 1000));
    if (Number.isFinite(ev.rol)) acc.rolagens.push(Math.min(Math.max(ev.rol, 0), 100));
    return;
  }

  if (ev.t === "evento" && ev.n) {
    let evento = acc.eventos.get(ev.n);
    if (!evento) {
      evento = { total: 0, valores: new Map() };
      acc.eventos.set(ev.n, evento);
    }
    evento.total++;
    if (ev.v) evento.valores.set(ev.v, (evento.valores.get(ev.v) || 0) + 1);
  }
}

function media(lista) {
  if (!lista.length) return 0;
  return lista.reduce((soma, valor) => soma + valor, 0) / lista.length;
}

function listarMapa(mapa, limite = 10) {
  return [...mapa.entries()]
    .map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limite);
}

function finalizar(acc, inicio, fim) {
  const sessoes = acc.sessoes.size;
  const rejeitadas = [...acc.paginasPorSessao.values()].filter((n) => n <= 1).length;
  const rejeicao = sessoes ? (rejeitadas / sessoes) * 100 : 0;
  const visitantes = [...acc.serie.values()].reduce((soma, dia) => soma + dia.vis.size, 0);

  const cidades = [...acc.cidades.entries()]
    .map(([chave, total]) => {
      const [cidade, estado, uf] = chave.split("|");
      return { cidade, estado: estado || "", uf: uf || "", total };
    })
    .sort((a, b) => b.total - a.total);

  const estados = [...acc.estados.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total);

  const ufs = [...acc.ufs.entries()]
    .map(([uf, total]) => ({ uf, total }))
    .sort((a, b) => b.total - a.total);

  const visitasLocalizadas = cidades.reduce((soma, cidade) => soma + cidade.total, 0);
  const cobertura = acc.views ? (visitasLocalizadas / acc.views) * 100 : 0;

  const serie = listarDias(inicio, fim).map((dia) => {
    const item = acc.serie.get(dia);
    return {
      dia,
      visualizacoes: item?.views || 0,
      visitantes: item?.vis.size || 0,
      sessoes: item?.ses.size || 0
    };
  });

  const paginas = [...acc.paginas.entries()]
    .map(([rota, dados]) => ({ rota, visitas: dados.views, visitantes: dados.vis.size }))
    .sort((a, b) => b.visitas - a.visitas);

  const eventos = [...acc.eventos.entries()]
    .map(([nome, dados]) => ({
      nome,
      total: dados.total,
      valores: [...dados.valores.entries()]
        .map(([valor, total]) => ({ valor, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 15)
    }))
    .sort((a, b) => b.total - a.total);

  return {
    periodo: { inicio, fim },
    kpis: {
      visualizacoes: acc.views,
      visitantes,
      sessoes,
      duracaoMedia: Math.round(media(acc.duracoes) / 1000),
      rejeicao: Number(rejeicao.toFixed(1)),
      rolagemMedia: Math.round(media(acc.rolagens))
    },
    serie,
    horas: acc.horas,
    paginas,
    origens: [...acc.origens.entries()]
      .map(([origem, visitas]) => ({ origem, visitas }))
      .sort((a, b) => b.visitas - a.visitas)
      .slice(0, 12),
    dispositivos: listarMapa(acc.disp),
    navegadores: listarMapa(acc.nav),
    sistemas: listarMapa(acc.so),
    paises: listarMapa(acc.pais),
    localidades: {
      visitas: visitasLocalizadas,
      cobertura: Number(cobertura.toFixed(1)),
      cidades: cidades.length,
      estados: estados.length,
      ufs: ufs.length,
      topCidade: cidades[0] || null,
      topEstado: ufs[0] || null
    },
    cidades: cidades.slice(0, 30),
    estados: estados.slice(0, 30),
    ufs,
    eventos
  };
}

async function lerPeriodo(inicio, fim) {
  const acc = novoAcumulador();
  const arquivos = listarDias(inicio, fim).map((dia) => path.join(DIR, `${dia}.ndjson`));

  for (let i = 0; i < arquivos.length; i += 6) {
    const lote = arquivos.slice(i, i + 6);
    const textos = await Promise.all(lote.map((arquivo) => fsp.readFile(arquivo, "utf8").catch(() => "")));
    for (const texto of textos) {
      if (!texto) continue;
      for (const linha of texto.split("\n")) {
        if (!linha) continue;
        try {
          acumular(acc, JSON.parse(linha));
        } catch {
          /* linha corrompida: ignora */
        }
      }
    }
  }

  return finalizar(acc, inicio, fim);
}

/*
 * dias: tamanho da janela. deslocamento: 0 = período atual, 1 = período anterior.
 */
async function agregarPeriodo(dias, deslocamento = 0) {
  const janela = Math.max(1, Math.floor(Number(dias) || 7));
  const hoje = diaSP();
  const fim = somarDias(hoje, -janela * deslocamento);
  const inicio = somarDias(fim, -(janela - 1));
  const chave = `${inicio}|${fim}`;
  const agora = Date.now();

  const emCache = cacheAgregados.get(chave);
  if (emCache && agora - emCache.em < TTL_CACHE) return emCache.dados;

  const dados = await lerPeriodo(inicio, fim);
  cacheAgregados.set(chave, { em: agora, dados });
  if (cacheAgregados.size > MAX_CACHE) {
    const maisAntigo = [...cacheAgregados.entries()].sort((a, b) => a[1].em - b[1].em)[0];
    if (maisAntigo) cacheAgregados.delete(maisAntigo[0]);
  }
  return dados;
}

function limparCache() {
  cacheAgregados.clear();
}

/* ---------- Tempo real ---------- */

function tempoReal(janelaMs = 5 * 60 * 1000) {
  const limite = Date.now() - janelaMs;
  const ativos = new Set();
  const paginas = new Map();
  const cidades = new Map();
  const estados = new Map();
  const ultimos = [];

  for (let i = recentes.length - 1; i >= 0; i--) {
    const ev = recentes[i];
    if (ev.ts < limite) break;
    if (ev.t === "pageview" && ev.ses) {
      ativos.add(ev.ses);
      incMapa(paginas, ev.rota || "/");
      if (ev.cidade) incMapa(cidades, `${ev.cidade}|${ev.estado || ""}|${ev.uf || ""}`);
      if (ev.uf) incMapa(estados, ev.uf);
    }
    if (ultimos.length < 18) {
      ultimos.push({
        tipo: ev.t,
        rota: ev.rota || "/",
        evento: ev.n || "",
        valor: ev.v || "",
        dispositivo: ev.disp || "",
        cidade: ev.cidade || "",
        estado: ev.estado || "",
        uf: ev.uf || "",
        quando: ev.ts
      });
    }
  }

  return {
    ativos: ativos.size,
    paginas: [...paginas.entries()]
      .map(([rota, valor]) => ({ rota, valor }))
      .sort((a, b) => b.valor - a.valor),
    cidades: [...cidades.entries()]
      .map(([chave, valor]) => {
        const [cidade, estado, uf] = chave.split("|");
        return { cidade, estado: estado || "", uf: uf || "", valor };
      })
      .sort((a, b) => b.valor - a.valor),
    estados: [...estados.entries()]
      .map(([uf, valor]) => ({ uf, valor }))
      .sort((a, b) => b.valor - a.valor),
    atualizadoEm: new Date().toISOString(),
    ultimos
  };
}

/* ---------- Limpeza / retenção ---------- */

async function listarArquivos() {
  const nomes = await fsp.readdir(DIR).catch(() => []);
  return nomes.filter((nome) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(nome));
}

async function limparAnteriores(dias) {
  const janela = Math.max(0, Math.floor(Number(dias) || 0));
  /* Mantém exatamente `janela` dias: hoje e os (janela - 1) anteriores. */
  const limite = somarDias(diaSP(), -(janela - 1));
  const arquivos = await listarArquivos();
  let removidos = 0;

  for (const nome of arquivos) {
    const dia = nome.slice(0, 10);
    if (dia >= limite) continue;
    await fsp.unlink(path.join(DIR, nome)).catch(() => {});
    removidos++;
  }

  if (removidos) limparCache();
  return removidos;
}

async function limparTudo() {
  const arquivos = await listarArquivos();
  for (const nome of arquivos) {
    await fsp.unlink(path.join(DIR, nome)).catch(() => {});
  }
  recentes.length = 0;
  limparCache();
  return arquivos.length;
}

/* ---------- Exportação ---------- */

function csv(valor) {
  let texto = String(valor ?? "");
  /* Evita injeção de fórmula ao abrir o CSV no Excel/Sheets. */
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",;\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function linhaCSV(valores) {
  return valores.map(csv).join(",");
}

async function exportarResumoCSV(dias) {
  const dados = await agregarPeriodo(dias);
  const linhas = [linhaCSV(["data", "visualizacoes", "visitantes", "sessoes"])];
  for (const dia of dados.serie) {
    linhas.push(linhaCSV([dia.dia, dia.visualizacoes, dia.visitantes, dia.sessoes]));
  }
  return linhas.join("\r\n");
}

async function exportarPaginasCSV(dias) {
  const dados = await agregarPeriodo(dias);
  const linhas = [linhaCSV(["pagina", "visualizacoes", "visitantes"])];
  for (const pagina of dados.paginas) {
    linhas.push(linhaCSV([pagina.rota, pagina.visitas, pagina.visitantes]));
  }
  return linhas.join("\r\n");
}

async function exportarEventosCSV(dias) {
  const dados = await agregarPeriodo(dias);
  const linhas = [linhaCSV(["evento", "valor", "total"])];
  for (const evento of dados.eventos) {
    if (!evento.valores.length) {
      linhas.push(linhaCSV([evento.nome, "", evento.total]));
      continue;
    }
    for (const valor of evento.valores) {
      linhas.push(linhaCSV([evento.nome, valor.valor, valor.total]));
    }
  }
  return linhas.join("\r\n");
}

async function exportarLocalidadesCSV(dias) {
  const dados = await agregarPeriodo(dias);
  const linhas = [linhaCSV(["cidade", "estado", "uf", "visitas"])];
  for (const cidade of dados.cidades) {
    linhas.push(linhaCSV([cidade.cidade, cidade.estado, cidade.uf, cidade.total]));
  }
  return linhas.join("\r\n");
}

async function exportarBrutoCSV(dias, limite = 15000) {
  const janela = Math.max(1, Math.floor(Number(dias) || 1));
  const hoje = diaSP();
  const inicio = somarDias(hoje, -(janela - 1));
  const linhas = [
    linhaCSV([
      "data",
      "hora",
      "tipo",
      "pagina",
      "evento",
      "valor",
      "contexto",
      "origem",
      "dispositivo",
      "navegador",
      "sistema",
      "pais",
      "estado",
      "uf",
      "cidade",
      "duracao_s",
      "rolagem"
    ])
  ];

  for (const dia of listarDias(inicio, hoje)) {
    if (linhas.length >= limite) break;
    const texto = await fsp.readFile(path.join(DIR, `${dia}.ndjson`), "utf8").catch(() => "");
    if (!texto) continue;
    for (const linha of texto.split("\n")) {
      if (!linha) continue;
      if (linhas.length >= limite) break;
      let ev;
      try {
        ev = JSON.parse(linha);
      } catch {
        continue;
      }
      linhas.push(
        linhaCSV([
          ev.dia,
          String(ev.hora ?? "").padStart(2, "0"),
          ev.t,
          ev.rota,
          ev.n,
          ev.v,
          ev.c,
          ev.ref,
          ev.disp,
          ev.nav,
          ev.so,
          ev.pais,
          ev.estado,
          ev.uf,
          ev.cidade,
          ev.dur != null ? Math.round(ev.dur / 1000) : "",
          ev.rol
        ])
      );
    }
  }

  if (linhas.length >= limite) linhas.push(linhaCSV([`# limite de ${limite} linhas atingido`]));
  return linhas.join("\r\n");
}

module.exports = {
  DIR,
  DIR_DADOS,
  diaSP,
  somarDias,
  hashVisitante,
  registrar,
  aguardarGravacao,
  agregarPeriodo,
  tempoReal,
  limparAnteriores,
  limparTudo,
  exportarResumoCSV,
  exportarPaginasCSV,
  exportarEventosCSV,
  exportarLocalidadesCSV,
  exportarBrutoCSV
};
