/* XTscores — painel administrativo */
(function () {
  "use strict";

  var estado = {
    dias: 7,
    secao: "visao",
    dados: null,
    timerVisao: null,
    timerRt: null,
    timerLogin: null
  };

  var NOMES_LIGAS = {
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

  var NOMES_ROTAS = {
    "/": "Início",
    "/politica.html": "Política de cookies",
    "/contato.html": "Contato"
  };

  /* Unidades federativas na ordem usada pelo mapa (por região). */
  var ESTADOS_BR = [
    ["AC", "Acre"], ["AM", "Amazonas"], ["AP", "Amapá"], ["PA", "Pará"],
    ["RO", "Rondônia"], ["RR", "Roraima"], ["TO", "Tocantins"],
    ["AL", "Alagoas"], ["BA", "Bahia"], ["CE", "Ceará"], ["MA", "Maranhão"],
    ["PB", "Paraíba"], ["PE", "Pernambuco"], ["PI", "Piauí"],
    ["RN", "Rio Grande do Norte"], ["SE", "Sergipe"],
    ["DF", "Distrito Federal"], ["GO", "Goiás"], ["MS", "Mato Grosso do Sul"],
    ["MT", "Mato Grosso"],
    ["ES", "Espírito Santo"], ["MG", "Minas Gerais"], ["RJ", "Rio de Janeiro"],
    ["SP", "São Paulo"],
    ["PR", "Paraná"], ["RS", "Rio Grande do Sul"], ["SC", "Santa Catarina"]
  ];

  function semAcento(valor) {
    return String(valor == null ? "" : valor)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  var UF_POR_NOME = {};
  var NOME_POR_UF = {};
  ESTADOS_BR.forEach(function (estado) {
    UF_POR_NOME[semAcento(estado[1])] = estado[0];
    UF_POR_NOME[semAcento(estado[0])] = estado[0];
    NOME_POR_UF[estado[0]] = estado[1];
  });

  function siglaEstado(nomeOuUf) {
    var chave = semAcento(nomeOuUf);
    return chave ? UF_POR_NOME[chave] || "" : "";
  }

  function rotuloEstado(nome, uf) {
    var sigla = String(uf || siglaEstado(nome) || "").toUpperCase();
    if (!nome) return sigla || "—";
    return sigla ? sigla + " · " + nome : nome;
  }

  var NOMES_EVENTOS = {
    liga: "Liga escolhida",
    rodada: "Rodada",
    ao_vivo: "Filtro ao vivo",
    jogo_aberto: "Jogo aberto",
    whatsapp: "WhatsApp",
    palpite: "Palpite",
    tema: "Tema",
    busca: "Busca",
    compartilhar: "Compartilhar",
    tabela: "Classificação"
  };

  var CORES = ["var(--verde)", "var(--azul)", "var(--violeta)", "var(--amarelo)", "var(--vermelho)"];

  var $ = function (seletor) {
    return document.querySelector(seletor);
  };

  /* ---------- utilidades ---------- */

  function esc(valor) {
    return String(valor == null ? "" : valor).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function numero(valor) {
    var n = Number(valor);
    if (!Number.isFinite(n)) n = 0;
    return n.toLocaleString("pt-BR");
  }

  function pct(valor, casas) {
    var n = Number(valor);
    if (!Number.isFinite(n)) n = 0;
    return (
      n.toLocaleString("pt-BR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: casas == null ? 1 : casas
      }) + "%"
    );
  }

  function duracao(segundos) {
    var s = Math.max(0, Math.round(Number(segundos) || 0));
    if (s < 60) return s + " s";
    var m = Math.floor(s / 60);
    var resto = s % 60;
    if (m < 60) return m + " min" + (resto ? " " + resto + " s" : "");
    return Math.floor(m / 60) + " h " + (m % 60) + " min";
  }

  function dataCurta(dia) {
    var partes = String(dia || "").split("-");
    if (partes.length !== 3) return dia || "";
    return partes[2] + "/" + partes[1];
  }

  function rotuloRota(rota) {
    if (!rota) return "—";
    return NOMES_ROTAS[rota] || rota;
  }

  function rotuloLiga(codigo) {
    if (!codigo) return "Todas as ligas";
    if (codigo === "todas") return "Todas as ligas";
    return NOMES_LIGAS[codigo] || codigo;
  }

  function rotuloOrigem(origem) {
    var o = String(origem || "").toLowerCase();
    if (!o || o === "direto") return "Acesso direto";
    if (/google/.test(o)) return "Google";
    if (/bing/.test(o)) return "Bing";
    if (/duckduckgo/.test(o)) return "DuckDuckGo";
    if (/instagram/.test(o)) return "Instagram";
    if (/facebook|fb\./.test(o)) return "Facebook";
    if (/whatsapp|wa\.me/.test(o)) return "WhatsApp";
    if (/twitter|(^|\.)x\.com|t\.co/.test(o)) return "X / Twitter";
    if (/youtube/.test(o)) return "YouTube";
    if (/tiktok/.test(o)) return "TikTok";
    if (/linkedin/.test(o)) return "LinkedIn";
    return origem;
  }

  var nomesPaises = null;
  try {
    nomesPaises = new Intl.DisplayNames(["pt-BR"], { type: "region" });
  } catch (erro) {
    nomesPaises = null;
  }

  function rotuloPais(codigo) {
    if (!codigo) return "Não informado";
    try {
      return nomesPaises ? nomesPaises.of(codigo) : codigo;
    } catch (erro) {
      return codigo;
    }
  }

  function vazio(mensagem) {
    return '<p class="vazio-lista">' + esc(mensagem || "Sem dados no período.") + "</p>";
  }

  function valorEvento(nome, valor) {
    if (nome === "liga") return rotuloLiga(valor);
    if (nome === "tema") return valor === "claro" ? "Claro" : "Escuro";
    if (nome === "ao_vivo") return valor === "ativado" ? "Ativado" : "Desativado";
    return valor || "—";
  }

  /* Nomes dos botões que levam ao WhatsApp (valores gravados pelo site). */
  var ROTULOS_WHATSAPP = {
    "Botao flutuante": "Botão flutuante",
    Assistente: "Imagem da assistente",
    "Banner do grupo": "Banner do grupo",
    "Botao do grupo": "Botão do grupo",
    Palpite: "Palpite do jogo",
    WhatsApp: "Outros links"
  };

  function rotuloWhatsapp(valor) {
    return ROTULOS_WHATSAPP[valor] || valor || "Outros links";
  }

  /* ---------- comunicação ---------- */

  async function api(caminho, opcoes) {
    var config = Object.assign({ cache: "no-store", headers: {} }, opcoes || {});
    config.headers = Object.assign({ Accept: "application/json" }, (opcoes && opcoes.headers) || {});

    var resposta = await fetch(caminho, config);
    var dados = null;
    try {
      dados = await resposta.json();
    } catch (erro) {
      dados = null;
    }

    if (resposta.status === 401 && caminho.indexOf("/entrar") < 0) {
      mostrarLogin();
      throw new Error("Sessão expirada. Entre novamente.");
    }
    if (!resposta.ok) {
      var erro = new Error((dados && dados.error) || "Não foi possível concluir a operação.");
      erro.status = resposta.status;
      erro.dados = dados;
      throw erro;
    }
    return dados || {};
  }

  /* ---------- avisos e progresso ---------- */

  var timerAviso = null;

  function aviso(mensagem, erro) {
    var el = $("#aviso");
    el.textContent = mensagem;
    el.classList.toggle("erro", Boolean(erro));
    el.classList.add("visivel");
    clearTimeout(timerAviso);
    timerAviso = setTimeout(function () {
      el.classList.remove("visivel");
    }, 3800);
  }

  function progresso(ativo) {
    var barra = $("#progresso");
    if (ativo) {
      barra.classList.remove("pronto");
      barra.classList.add("ativo");
    } else {
      barra.classList.remove("ativo");
      barra.classList.add("pronto");
      setTimeout(function () {
        barra.classList.remove("pronto");
      }, 350);
    }
  }

  /* ---------- sessão ---------- */

  function pararTimers() {
    clearInterval(estado.timerVisao);
    clearInterval(estado.timerRt);
    clearInterval(estado.timerLogin);
    estado.timerLogin = null;
  }

  function iniciarTimers() {
    pararTimers();
    estado.timerVisao = setInterval(function () {
      if (estado.secao === "visao" && !document.hidden) carregarResumo(true);
    }, 60000);
    estado.timerRt = setInterval(function () {
      if (estado.secao === "tempo-real" && !document.hidden) carregarRt(true);
    }, 10000);
  }

  function mostrarLogin() {
    pararTimers();
    $("#app").classList.add("escondido");
    $("#tela-login").classList.remove("escondido");
    setTimeout(function () {
      var campo = $("#login-senha");
      if (campo) campo.focus();
    }, 60);
  }

  function mostrarApp() {
    $("#tela-login").classList.add("escondido");
    $("#app").classList.remove("escondido");
    estado.secao = "visao";
    definirSecao("visao");
    iniciarTimers();
  }

  /* ---------- navegação ---------- */

  var TITULOS = {
    visao: ["Visão geral", ""],
    "tempo-real": ["Tempo real", "Quem está navegando no site agora"],
    conteudo: ["Conteúdo", "Páginas, origens, ligas e ações"],
    config: ["Configurações", "Coleta, exportação, senha e segurança"]
  };

  function definirSecao(nome) {
    estado.secao = nome;

    document.querySelectorAll(".menu-item").forEach(function (botao) {
      var ativo = botao.dataset.secao === nome;
      botao.classList.toggle("ativo", ativo);
      if (ativo) botao.setAttribute("aria-current", "page");
      else botao.removeAttribute("aria-current");
    });

    document.querySelectorAll(".secao").forEach(function (secao) {
      secao.classList.add("escondido");
    });
    var alvo = document.getElementById("secao-" + nome);
    if (alvo) alvo.classList.remove("escondido");

    $("#titulo-secao").textContent = TITULOS[nome][0];
    $("#subtitulo").textContent = TITULOS[nome][1];

    var comPeriodo = nome === "visao" || nome === "conteudo";
    $("#acoes-periodo").classList.toggle("escondido", !comPeriodo);

    if (nome === "visao" || nome === "conteudo") carregarResumo();
    if (nome === "tempo-real") carregarRt();
    if (nome === "config") carregarConfig();
  }

  /* ---------- carregamento ---------- */

  async function carregarResumo(silencioso) {
    if (!silencioso) progresso(true);
    try {
      var dados = await api("/api/admin/resumo?dias=" + estado.dias);
      estado.dados = dados;

      renderKpis(dados);
      renderLocalidades(dados);
      renderSerie(dados);
      renderPaginas(dados);
      renderOrigens(dados);
      renderCidades(dados);
      renderEstados(dados);
      renderDispositivos(dados);
      renderNavegadores(dados);
      renderSistemas(dados);
      renderLigas(dados);
      renderJogos(dados);
      renderEngajamento(dados);
      renderWhatsapp(dados);
      renderConteudo(dados);

      var p = dados.periodo;
      var periodo = p.inicio === p.fim ? dataCurta(p.inicio) : dataCurta(p.inicio) + " a " + dataCurta(p.fim);
      var hora = new Date(dados.atualizadoEm).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      });
      $("#subtitulo").textContent = periodo + " · atualizado às " + hora;

      /* Avisa quando o período pedido vai além do histórico que a retenção mantém. */
      var nota = $("#nota-periodo");
      if (dados.primeiroDia && p.inicio < dados.primeiroDia) {
        nota.hidden = false;
        nota.textContent =
          "Histórico disponível a partir de " +
          dataCurta(dados.primeiroDia) +
          ". Dias anteriores não têm registros (retenção atual: " +
          numero(dados.retencaoDias || 0) +
          " dias).";
      } else {
        nota.hidden = true;
        nota.textContent = "";
      }
    } catch (erro) {
      if (!silencioso) aviso(erro.message, true);
    } finally {
      if (!silencioso) progresso(false);
    }
  }

  async function carregarRt(silencioso) {
    if (!silencioso) progresso(true);
    try {
      var dados = await api("/api/admin/tempo-real");
      renderRt(dados);
    } catch (erro) {
      if (!silencioso) aviso(erro.message, true);
    } finally {
      if (!silencioso) progresso(false);
    }
  }

  async function carregarConfig() {
    progresso(true);
    try {
      var config = await api("/api/admin/config");
      $("#cfg-coleta").checked = Boolean(config.coleta);
      $("#cfg-geo").checked = config.geo !== false;
      $("#cfg-retencao").value = String(config.retencaoDias);
      $("#senha-ambiente").hidden = !config.senhaAmbiente;

      var info = config.geoInfo || {};
      var geoTexto = info.ativo
        ? "Provedor " +
          info.provedor +
          " · consultas hoje: " +
          numero(info.consultasHoje) +
          " de " +
          numero(info.limiteDia) +
          " · até " +
          numero(info.limiteIp) +
          " por IP" +
          " · IPs distintos: " +
          numero(info.ipsDistintos) +
          " · em cache: " +
          numero(info.cache)
        : "Estimativa desativada no servidor (GEO_MAX_DIA=0).";
      if (info.ultimoErro) geoTexto += " · último erro: " + info.ultimoErro;
      $("#geo-info").textContent = geoTexto;

      var desabilitar = Boolean(config.senhaAmbiente);
      ["#senha-atual", "#senha-nova", "#senha-confirma", "#senha-btn"].forEach(function (seletor) {
        var el = $(seletor);
        if (el) el.disabled = desabilitar;
      });
    } catch (erro) {
      aviso(erro.message, true);
    } finally {
      progresso(false);
    }
  }

  /* ---------- cartões de KPI ---------- */

  function delta(variacao, invertido) {
    var v = Number(variacao);
    if (!Number.isFinite(v) || Math.abs(v) < 0.05) {
      return '<span class="delta neutro">estável</span>';
    }
    var bom = invertido ? v < 0 : v > 0;
    var seta = v > 0 ? "\u25B2" : "\u25BC";
    return (
      '<span class="delta ' +
      (bom ? "sobe" : "desce") +
      '">' +
      seta +
      " " +
      pct(Math.abs(v)) +
      "</span>"
    );
  }

  function kpi(rotulo, valorHtml, variacao, invertido, dica) {
    return (
      '<article class="kpi"' +
      (dica ? ' title="' + esc(dica) + '"' : "") +
      '><span class="kpi-rotulo">' +
      esc(rotulo) +
      '</span><p class="kpi-valor">' +
      valorHtml +
      '</p><span class="kpi-meta">' +
      delta(variacao, invertido) +
      "<span>vs. período anterior</span></span></article>"
    );
  }

  function renderKpis(dados) {
    var k = dados.kpis;
    $("#kpis").innerHTML = [
      kpi("Visualizações", numero(k.visualizacoes.valor), k.visualizacoes.variacao, false, "Páginas abertas no período."),
      kpi(
        "Visitantes",
        numero(k.visitantes.valor),
        k.visitantes.variacao,
        false,
        "Soma de visitantes únicos por dia (o identificador muda diariamente)."
      ),
      kpi("Sessões", numero(k.sessoes.valor), k.sessoes.variacao, false, "Visitas distintas, mesmo que tenham visto várias páginas."),
      kpi("Tempo médio", duracao(k.duracaoMedia.valor), k.duracaoMedia.variacao, false, "Tempo médio antes de sair da página."),
      kpi("Rejeição", pct(k.rejeicao.valor), k.rejeicao.variacao, true, "Sessões que viram apenas uma página."),
      kpi("Rolagem", pct(k.rolagemMedia.valor), k.rolagemMedia.variacao, false, "Quanto da página foi percorrido, em média.")
    ].join("");
  }

  /* ---------- gráfico de linha ---------- */

  function tetoGrafico(valor) {
    if (valor <= 4) return 4;
    var expoente = Math.pow(10, Math.floor(Math.log10(valor)));
    var proporcao = valor / expoente;
    var passo = proporcao <= 1 ? 1 : proporcao <= 2 ? 2 : proporcao <= 5 ? 5 : 10;
    return passo * expoente;
  }

  function graficoLinha(serie) {
    var w = 720;
    var h = 230;
    var ml = 38;
    var mr = 14;
    var mt = 14;
    var mb = 30;
    var largura = w - ml - mr;
    var altura = h - mt - mb;
    var total = serie.length;
    var maior = 1;

    serie.forEach(function (dia) {
      if (dia.visualizacoes > maior) maior = dia.visualizacoes;
      if (dia.visitantes > maior) maior = dia.visitantes;
    });
    var maximo = tetoGrafico(maior);

    function px(i) {
      if (total <= 1) return ml + largura / 2;
      return ml + (i * largura) / (total - 1);
    }
    function py(valor) {
      return mt + altura * (1 - valor / maximo);
    }

    function caminho(chave) {
      return serie
        .map(function (dia, i) {
          return (i ? "L" : "M") + px(i).toFixed(1) + "," + py(dia[chave]).toFixed(1);
        })
        .join(" ");
    }

    var linhaVis = caminho("visualizacoes");
    var linhaUni = caminho("visitantes");
    var area =
      linhaVis +
      " L" +
      px(total - 1).toFixed(1) +
      "," +
      (mt + altura) +
      " L" +
      px(0).toFixed(1) +
      "," +
      (mt + altura) +
      " Z";

    var grade = "";
    for (var g = 0; g <= 4; g++) {
      var y = mt + (altura * g) / 4;
      var valor = Math.round(maximo * (1 - g / 4));
      grade +=
        '<line x1="' + ml + '" y1="' + y.toFixed(1) + '" x2="' + (w - mr) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--grade)" stroke-width="1"/>' +
        '<text x="' + (ml - 8) + '" y="' + (y + 3.5).toFixed(1) +
        '" text-anchor="end" font-size="10" fill="var(--suave)">' + numero(valor) + "</text>";
    }

    var passo = Math.max(1, Math.ceil(total / 8));
    var rotulos = serie
      .map(function (dia, i) {
        if (i % passo !== 0 && i !== total - 1) return "";
        return (
          '<text x="' + px(i).toFixed(1) + '" y="' + (h - 8) +
          '" text-anchor="middle" font-size="10" fill="var(--suave)">' + dataCurta(dia.dia) + "</text>"
        );
      })
      .join("");

    var pontos = "";
    if (total <= 16) {
      pontos = serie
        .map(function (dia, i) {
          return (
            '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(dia.visualizacoes).toFixed(1) +
            '" r="3" fill="var(--verde)"><title>' + dataCurta(dia.dia) + ": " + numero(dia.visualizacoes) +
            " visualizações</title></circle>"
          );
        })
        .join("");
    }

    return (
      '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Visualizações e visitantes por dia">' +
      "<defs>" +
      '<linearGradient id="areaSerie" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--verde)" stop-opacity="0.32"/>' +
      '<stop offset="100%" stop-color="var(--verde)" stop-opacity="0"/>' +
      "</linearGradient>" +
      "</defs>" +
      grade +
      '<path d="' + area + '" fill="url(#areaSerie)"/>' +
      '<path d="' + linhaVis + '" fill="none" stroke="var(--verde)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + linhaUni + '" fill="none" stroke="var(--azul)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round"/>' +
      pontos +
      rotulos +
      "</svg>"
    );
  }

  function barrasHoras(horas) {
    var maximo = 1;
    var pico = 0;
    horas.forEach(function (valor, i) {
      if (valor > maximo) maximo = valor;
      if (valor > horas[pico]) pico = i;
    });

    return (
      '<div class="barras">' +
      horas
        .map(function (valor, i) {
          var altura = valor ? Math.max(3, Math.round((valor / maximo) * 128)) : 2;
          var rotulo = i % 3 === 0 ? ("0" + i).slice(-2) : "";
          return (
            '<div class="barra-col' +
            (i === pico && valor ? " destaque" : "") +
            (valor ? "" : " zerada") +
            '" title="' +
            ("0" + i).slice(-2) + "h: " + numero(valor) + ' visualizações">' +
            '<span class="barra" style="height:' + altura + 'px"></span>' +
            '<span class="barra-rotulo">' + rotulo + "</span></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderSerie(dados) {
    var legenda = document.querySelector(".legenda-chart");
    var cartaoHoras = $("#cartao-horas");
    var grade = $("#grafico-serie").closest(".grid");

    if (estado.dias === 1) {
      $("#titulo-serie").textContent = "Visitas por hora";
      legenda.classList.add("escondido");
      cartaoHoras.classList.add("escondido");
      grade.classList.add("unico");
      $("#grafico-serie").innerHTML = barrasHoras(dados.horas);
      return;
    }

    $("#titulo-serie").textContent = "Visitas por dia";
    legenda.classList.remove("escondido");
    cartaoHoras.classList.remove("escondido");
    grade.classList.remove("unico");
    $("#grafico-serie").innerHTML = graficoLinha(dados.serie);
    $("#grafico-horas").innerHTML = barrasHoras(dados.horas);
  }

  /* ---------- tabelas ---------- */

  function tabelaPaginas(paginas, limite) {
    if (!paginas.length) return vazio("Nenhuma visualização registrada ainda.");
    var maximo = paginas[0].visitas || 1;
    var linhas = paginas
      .slice(0, limite || 8)
      .map(function (pagina, i) {
        return (
          "<tr><td class=\"posicao\">" + (i + 1) + "</td>" +
          '<td><span class="principal">' + esc(rotuloRota(pagina.rota)) + "</span>" +
          '<span class="secundario">' + esc(pagina.rota) + "</span></td>" +
          '<td class="num">' + numero(pagina.visitas) + "</td>" +
          '<td><div class="medidor"><i style="width:' + Math.round((pagina.visitas / maximo) * 100) + '%"></i></div></td></tr>'
        );
      })
      .join("");

    return (
      '<table class="adm-tabela"><thead><tr><th scope="col">#</th><th scope="col">Página</th><th scope="col" class="num">Visitas</th>' +
      '<th scope="col"><span class="rotulo-oculto">Participação</span></th></tr></thead>' +
      "<tbody>" + linhas + "</tbody></table>"
    );
  }

  function tabelaOrigens(origens, limite) {
    if (!origens.length) return vazio("Nenhuma origem registrada ainda.");
    var maximo = origens[0].visitas || 1;
    var linhas = origens
      .slice(0, limite || 8)
      .map(function (origem) {
        return (
          "<tr>" +
          '<td><span class="principal">' + esc(rotuloOrigem(origem.origem)) + "</span>" +
          (origem.origem !== "Direto" && rotuloOrigem(origem.origem) !== origem.origem
            ? '<span class="secundario">' + esc(origem.origem) + "</span>"
            : "") +
          "</td>" +
          '<td class="num">' + numero(origem.visitas) + "</td>" +
          '<td><div class="medidor"><i style="width:' + Math.round((origem.visitas / maximo) * 100) + '%"></i></div></td></tr>'
        );
      })
      .join("");

    return (
      '<table class="adm-tabela"><thead><tr><th scope="col">Origem</th><th scope="col" class="num">Visitas</th>' +
      '<th scope="col"><span class="rotulo-oculto">Participação</span></th></tr></thead>' +
      "<tbody>" + linhas + "</tbody></table>"
    );
  }

  function tabelaValores(itens, rotulo, limite, tituloColuna) {
    if (!itens.length) return vazio("Sem registros no período.");
    var maximo = itens[0].total || 1;
    var linhas = itens
      .slice(0, limite || 8)
      .map(function (item, i) {
        return (
          "<tr><td class=\"posicao\">" + (i + 1) + "</td>" +
          '<td><span class="principal">' + esc(rotulo ? rotulo(item.valor) : item.valor) + "</span></td>" +
          '<td class="num">' + numero(item.total) + "</td>" +
          '<td><div class="medidor"><i style="width:' + Math.round((item.total / maximo) * 100) + '%"></i></div></td></tr>'
        );
      })
      .join("");

    return (
      '<table class="adm-tabela"><thead><tr><th scope="col">#</th><th scope="col">Item</th>' +
      '<th scope="col" class="num">' + esc(tituloColuna || "Ações") + "</th>" +
      '<th scope="col"><span class="rotulo-oculto">Participação</span></th></tr></thead>' +
      "<tbody>" + linhas + "</tbody></table>"
    );
  }

  function rotuloLocal(cidade) {
    var sigla = String(cidade.uf || siglaEstado(cidade.estado) || "").toUpperCase();
    var estado = cidade.estado || "";
    var repetido = semAcento(estado) === semAcento(cidade.cidade);
    return [sigla, repetido ? "" : estado].filter(Boolean).join(" · ");
  }

  function tabelaCidades(cidades, limite) {
    if (!cidades || !cidades.length) {
      return vazio("Nenhuma cidade registrada ainda. A localização é estimada pelo IP, sem gravá-lo.");
    }

    var maximo = cidades[0].total || 1;
    var linhas = cidades
      .slice(0, limite || 8)
      .map(function (cidade, i) {
        return (
          "<tr><td class=\"posicao\">" + (i + 1) + "</td>" +
          '<td><span class="principal">' + esc(cidade.cidade) + "</span>" +
          (cidade.estado || cidade.uf
            ? '<span class="secundario">' + esc(rotuloLocal(cidade)) + "</span>"
            : "") +
          "</td>" +
          '<td class="num">' + numero(cidade.total) + "</td>" +
          '<td><div class="medidor"><i style="width:' + Math.round((cidade.total / maximo) * 100) + '%"></i></div></td></tr>'
        );
      })
      .join("");

    return (
      '<table class="adm-tabela"><thead><tr><th scope="col">#</th><th scope="col">Cidade</th>' +
      '<th scope="col" class="num">Visitas</th>' +
      '<th scope="col"><span class="rotulo-oculto">Participação</span></th></tr></thead>' +
      "<tbody>" + linhas + "</tbody></table>"
    );
  }

  function tabelaEstados(estados, limite) {
    if (!estados || !estados.length) {
      return vazio("Nenhum estado registrado ainda. A localização é estimada pelo IP, sem gravá-lo.");
    }

    var maximo = estados[0].total || 1;
    var linhas = estados
      .slice(0, limite || 8)
      .map(function (estado, i) {
        return (
          "<tr><td class=\"posicao\">" + (i + 1) + "</td>" +
          '<td><span class="principal">' + esc(rotuloEstado(estado.nome)) + "</span></td>" +
          '<td class="num">' + numero(estado.total) + "</td>" +
          '<td><div class="medidor"><i style="width:' + Math.round((estado.total / maximo) * 100) + '%"></i></div></td></tr>'
        );
      })
      .join("");

    return (
      '<table class="adm-tabela"><thead><tr><th scope="col">#</th><th scope="col">Estado</th>' +
      '<th scope="col" class="num">Visitas</th>' +
      '<th scope="col"><span class="rotulo-oculto">Participação</span></th></tr></thead>' +
      "<tbody>" + linhas + "</tbody></table>"
    );
  }

  function listaBarras(itens, rotulo) {
    if (!itens.length) return vazio("Sem dados no período.");
    var maximo = itens[0].valor || 1;
    var total = itens.reduce(function (soma, item) {
      return soma + item.valor;
    }, 0);

    return (
      '<div class="lista-barras">' +
      itens
        .slice(0, 8)
        .map(function (item) {
          var nome = rotulo ? rotulo(item.nome) : item.nome;
          return (
            '<div class="lista-linha"><span class="lista-nome">' + esc(nome) + "</span>" +
            '<span class="lista-valor">' +
            pct(total ? (item.valor / total) * 100 : 0) +
            "</span>" +
            '<span class="lista-trilho"><i style="width:' + Math.round((item.valor / maximo) * 100) + '%"></i></span></div>'
          );
        })
        .join("") +
      "</div>"
    );
  }

  function donut(itens) {
    var total = itens.reduce(function (soma, item) {
      return soma + item.valor;
    }, 0);
    if (!total) return vazio("Sem dados no período.");

    var acumulado = 0;
    var segmentos = itens.slice(0, 5).map(function (item, i) {
      var inicio = (acumulado / total) * 360;
      acumulado += item.valor;
      var fim = (acumulado / total) * 360;
      return CORES[i] + " " + inicio.toFixed(1) + "deg " + fim.toFixed(1) + "deg";
    });

    var legenda = itens
      .slice(0, 5)
      .map(function (item, i) {
        return (
          '<div><i style="background:' + CORES[i] + '"></i>' + esc(item.nome) +
          "<strong>" + pct((item.valor / total) * 100) + "</strong></div>"
        );
      })
      .join("");

    return (
      '<div class="donut-area"><div class="donut" style="background:conic-gradient(' + segmentos.join(",") + ')">' +
      '<div class="donut-centro"><strong>' + numero(total) + "</strong><span>visitas</span></div></div>" +
      '<div class="donut-legenda">' + legenda + "</div></div>"
    );
  }

  function itensEvento(dados, nome) {
    var evento = (dados.eventos || []).find(function (item) {
      return item.nome === nome;
    });
    return evento ? evento.valores : [];
  }

  function totalEvento(dados, nome) {
    var evento = (dados.eventos || []).find(function (item) {
      return item.nome === nome;
    });
    return evento ? evento.total : 0;
  }

  function valorDeEvento(dados, nome, valor) {
    var itens = itensEvento(dados, nome);
    var item = itens.find(function (i) {
      return i.valor === valor;
    });
    return item ? item.total : 0;
  }

  /* ---------- renderizações ---------- */

  function mapaEstados(ufs, estados) {
    var contagem = {};
    var temUf = Boolean(ufs && ufs.length);

    (ufs || []).forEach(function (item) {
      if (item && item.uf) contagem[item.uf] = (contagem[item.uf] || 0) + item.total;
    });

    /* Registros antigos não têm UF: cai para o nome do estado. */
    if (!temUf) {
      (estados || []).forEach(function (item) {
        var sigla = siglaEstado(item.nome);
        if (sigla) contagem[sigla] = (contagem[sigla] || 0) + item.total;
      });
    }

    var maior = 1;
    var total = 0;
    Object.keys(contagem).forEach(function (uf) {
      if (contagem[uf] > maior) maior = contagem[uf];
      total += contagem[uf];
    });

    return ESTADOS_BR.map(function (estado) {
      var uf = estado[0];
      var visitas = contagem[uf] || 0;
      var nivel = visitas ? Math.max(0.14, visitas / maior) : 0;
      var titulo =
        estado[1] +
        ": " +
        numero(visitas) +
        (total ? " · " + pct((visitas / total) * 100) + " das visitas localizadas" : "");

      return (
        '<div class="mapa-estado' +
        (visitas ? "" : " vazio") +
        '" role="listitem" tabindex="0" style="--nivel:' +
        nivel.toFixed(2) +
        '" title="' +
        esc(titulo) +
        '" aria-label="' +
        esc(titulo) +
        '"><strong>' +
        uf +
        "</strong><span>" +
        (visitas ? numero(visitas) : "—") +
        "</span></div>"
      );
    }).join("");
  }

  function renderLocalidades(dados) {
    var loc = dados.localidades || {};
    var topCidade = loc.topCidade || null;
    var topEstado = loc.topEstado || null;
    var visualizacoes = dados.kpis && dados.kpis.visualizacoes ? dados.kpis.visualizacoes.valor : 0;

    $("#geo-resumo").innerHTML = [
      ["Visitas localizadas", numero(loc.visitas || 0), "de " + numero(visualizacoes) + " visualizações"],
      ["Cobertura", pct(loc.cobertura || 0), "das visitas com cidade/estado"],
      ["Cidades", numero(loc.cidades || 0), "distintas no período"],
      ["Estados", numero(loc.ufs || loc.estados || 0), "UFs identificadas"]
    ]
      .map(function (item) {
        return (
          '<div class="mini"><span>' + esc(item[0]) + "</span><strong>" + esc(item[1]) +
          "</strong><small>" + esc(item[2]) + "</small></div>"
        );
      })
      .join("");

    $("#mapa-estados").innerHTML = mapaEstados(dados.ufs || [], dados.estados || []);

    var partes = [];
    if (topCidade) {
      var localCidade = rotuloLocal(topCidade);
      partes.push(
        "Cidade com mais visitas: " +
          topCidade.cidade +
          (localCidade ? " (" + localCidade + ")" : "") +
          " · " +
          numero(topCidade.total)
      );
    }
    if (topEstado) {
      partes.push(
        "Estado líder: " +
          rotuloEstado(NOME_POR_UF[topEstado.uf] || topEstado.uf, topEstado.uf) +
          " · " +
          numero(topEstado.total)
      );
    }
    if (!partes.length) {
      partes.push(
        "Ainda não há visitas com localização no período. A estimativa depende do IP e pode estar desligada nas Configurações."
      );
    }

    $("#geo-nota").textContent = partes.join(" · ");
  }

  function renderPaginas(dados) {
    $("#tabela-paginas").innerHTML = tabelaPaginas(dados.paginas, 6);
  }

  function renderOrigens(dados) {
    $("#tabela-origens").innerHTML = tabelaOrigens(dados.origens, 6);
  }

  function renderCidades(dados) {
    $("#tabela-cidades").innerHTML = tabelaCidades(dados.cidades, 8);
    $("#conteudo-cidades").innerHTML = tabelaCidades(dados.cidades, 30);
  }

  function renderEstados(dados) {
    $("#tabela-estados").innerHTML = tabelaEstados(dados.estados, 8);
    $("#conteudo-estados").innerHTML = tabelaEstados(dados.estados, 30);
  }

  function renderDispositivos(dados) {
    $("#donut-dispositivos").innerHTML = donut(dados.dispositivos);
  }

  function renderNavegadores(dados) {
    $("#lista-navegadores").innerHTML = listaBarras(dados.navegadores);
  }

  function renderSistemas(dados) {
    $("#lista-sistemas").innerHTML = listaBarras(dados.sistemas);
  }

  function renderLigas(dados) {
    $("#tabela-ligas").innerHTML = tabelaValores(itensEvento(dados, "liga"), rotuloLiga, 6);
  }

  function renderJogos(dados) {
    $("#tabela-jogos").innerHTML = tabelaValores(itensEvento(dados, "jogo_aberto"), null, 6);
  }

  function renderEngajamento(dados) {
    var sessoes = dados.kpis.sessoes.valor || 0;
    var whats = totalEvento(dados, "whatsapp");
    var palpites = valorDeEvento(dados, "whatsapp", "Palpite");
    var jogos = totalEvento(dados, "jogo_aberto");
    var temas = totalEvento(dados, "tema");

    function taxa(valor) {
      return sessoes ? pct((valor / sessoes) * 100) : "0%";
    }

    $("#engajamento").innerHTML = [
      ["Cliques no WhatsApp", taxa(whats), numero(whats) + " cliques"],
      ['Cliques em "Palpite"', taxa(palpites), numero(palpites) + " cliques"],
      ["Jogos abertos", taxa(jogos), numero(jogos) + " aberturas"],
      ["Trocas de tema", taxa(temas), numero(temas) + " trocas"]
    ]
      .map(function (item) {
        return (
          '<div class="mini"><span>' + esc(item[0]) + "</span><strong>" + esc(item[1]) +
          "</strong><small>" + esc(item[2]) + "</small></div>"
        );
      })
      .join("");
  }

  function renderWhatsapp(dados) {
    var sessoes = (dados.kpis && dados.kpis.sessoes && dados.kpis.sessoes.valor) || 0;
    var itens = itensEvento(dados, "whatsapp");
    var total = totalEvento(dados, "whatsapp");
    var lider = itens[0] ? rotuloWhatsapp(itens[0].valor) : "—";
    var porSessao = sessoes ? (total / sessoes).toFixed(2).replace(".", ",") : "0";

    $("#whatsapp-resumo").innerHTML = [
      [
        "Total de cliques",
        numero(total),
        sessoes ? pct((total / sessoes) * 100) + " das sessões" : "sem sessões no período"
      ],
      ["Cliques por sessão", porSessao, numero(sessoes) + " sessões"],
      [
        "Botão mais clicado",
        lider,
        itens[0]
          ? numero(itens[0].total) + (itens[0].total === 1 ? " clique" : " cliques")
          : "sem cliques ainda"
      ],
      ["Botões com cliques", numero(itens.length), "no período selecionado"]
    ]
      .map(function (item) {
        return (
          '<div class="mini"><span>' + esc(item[0]) + "</span><strong>" + esc(item[1]) +
          "</strong><small>" + esc(item[2]) + "</small></div>"
        );
      })
      .join("");

    $("#tabela-whatsapp").innerHTML = itens.length
      ? tabelaValores(itens, rotuloWhatsapp, 10, "Cliques")
      : vazio("Nenhum clique no WhatsApp registrado no período.");
  }

  function renderConteudo(dados) {
    $("#conteudo-paginas").innerHTML = tabelaPaginas(dados.paginas, 20);
    $("#conteudo-origens").innerHTML = tabelaOrigens(dados.origens, 20);
    $("#conteudo-ligas").innerHTML = tabelaValores(itensEvento(dados, "liga"), rotuloLiga, 10);
    $("#conteudo-paises").innerHTML = listaBarras(dados.paises, rotuloPais);

    if (!dados.eventos.length) {
      $("#conteudo-eventos").innerHTML = vazio("Nenhum evento registrado ainda.");
      return;
    }

    var linhas = dados.eventos
      .map(function (evento) {
        var detalhes = evento.valores
          .slice(0, 4)
          .map(function (valor) {
            return (
              esc(valorEvento(evento.nome, valor.valor)) +
              " <strong>" + numero(valor.total) + "</strong>"
            );
          })
          .join(" · ");

        return (
          "<tr><td><span class=\"principal\">" + esc(NOMES_EVENTOS[evento.nome] || evento.nome) + "</span>" +
          '<span class="secundario">' + esc(evento.nome) + "</span></td>" +
          '<td class="num">' + numero(evento.total) + "</td>" +
          "<td>" + (detalhes || '<span class="secundario">—</span>') + "</td></tr>"
        );
      })
      .join("");

    $("#conteudo-eventos").innerHTML =
      '<table class="adm-tabela"><thead><tr><th scope="col">Evento</th>' +
      '<th scope="col" class="num">Total</th><th scope="col">Detalhes</th></tr></thead>' +
      "<tbody>" + linhas + "</tbody></table>";
  }

  function renderRt(dados) {
    $("#rt-ativos").textContent = numero(dados.ativos);

    $("#rt-paginas").innerHTML = dados.paginas.length
      ? listaBarras(
          dados.paginas.map(function (pagina) {
            return { nome: rotuloRota(pagina.rota), valor: pagina.valor };
          })
        )
      : vazio("Ninguém no site neste momento.");

    var cidades = dados.cidades || [];
    $("#rt-cidades").innerHTML = cidades.length
      ? listaBarras(
          cidades.map(function (cidade) {
            var sigla = String(cidade.uf || siglaEstado(cidade.estado) || "").toUpperCase();
            return {
              nome: cidade.cidade + (sigla ? " (" + sigla + ")" : ""),
              valor: cidade.valor
            };
          })
        )
      : vazio("Nenhuma localização nos últimos 5 minutos.");

    if (!dados.ultimos.length) {
      $("#rt-eventos").innerHTML = vazio("Nenhum evento recente.");
      return;
    }

    $("#rt-eventos").innerHTML = dados.ultimos
      .map(function (item) {
        var hora = new Date(item.quando).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit"
        });
        var texto;
        if (item.tipo === "pageview") {
          texto = "Abriu <strong>" + esc(rotuloRota(item.rota)) + "</strong>";
          if (item.dispositivo) texto += " · " + esc(item.dispositivo);
          if (item.cidade) {
            texto += " · " + esc(item.cidade) + (item.uf ? " (" + esc(item.uf) + ")" : "");
          }
        } else if (item.tipo === "evento") {
          texto =
            "Evento <strong>" + esc(NOMES_EVENTOS[item.evento] || item.evento) + "</strong>" +
            (item.valor ? " · " + esc(valorEvento(item.evento, item.valor)) : "");
        } else {
          texto = "Saiu de <strong>" + esc(rotuloRota(item.rota)) + "</strong>";
        }

        return (
          '<div class="feed-item"><span class="feed-hora">' + hora + "</span>" +
          '<span class="feed-tipo ' + esc(item.tipo) + '"></span>' +
          '<span class="feed-texto">' + texto + "</span></div>"
        );
      })
      .join("");
  }

  /* ---------- eventos da interface ---------- */

  function contarBloqueio(segundos) {
    clearInterval(estado.timerLogin);
    var botao = $("#login-btn");
    var restante = Math.max(1, Math.round(segundos));

    function pintar() {
      if (restante <= 0) {
        clearInterval(estado.timerLogin);
        estado.timerLogin = null;
        botao.disabled = false;
        botao.textContent = "Entrar";
        $("#login-erro").textContent = "";
        return;
      }

      var minutos = Math.floor(restante / 60);
      var resto = restante % 60;
      botao.disabled = true;
      botao.textContent =
        "Aguarde " + (minutos ? minutos + ":" + ("0" + resto).slice(-2) : resto + "s");
      restante--;
    }

    pintar();
    estado.timerLogin = setInterval(pintar, 1000);
  }

  $("#form-login").addEventListener("submit", async function (evento) {
    evento.preventDefault();
    var botao = $("#login-btn");
    var senha = $("#login-senha").value;
    var bloqueado = false;
    $("#login-erro").textContent = "";
    botao.disabled = true;
    botao.textContent = "Entrando…";

    try {
      await api("/api/admin/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha: senha })
      });
      $("#login-senha").value = "";
      mostrarApp();
    } catch (erro) {
      $("#login-erro").textContent = erro.message;
      if (erro.status === 429 && erro.dados && erro.dados.retryAfter) {
        bloqueado = true;
        contarBloqueio(Number(erro.dados.retryAfter));
      } else {
        $("#login-senha").select();
      }
    } finally {
      if (!bloqueado) {
        botao.disabled = false;
        botao.textContent = "Entrar";
      }
    }
  });

  $("#sair").addEventListener("click", async function () {
    try {
      await api("/api/admin/sair", { method: "POST" });
    } catch (erro) {
      /* ignora */
    }
    mostrarLogin();
  });

  document.querySelectorAll(".menu-item").forEach(function (botao) {
    botao.addEventListener("click", function () {
      definirSecao(botao.dataset.secao);
    });
  });

  document.querySelectorAll("#acoes-periodo [data-dias]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      var dias = Number(botao.dataset.dias);
      if (!dias || dias === estado.dias) return;
      estado.dias = dias;
      document.querySelectorAll("#acoes-periodo [data-dias]").forEach(function (outro) {
        outro.classList.toggle("ativo", outro === botao);
      });
      carregarResumo();
    });
  });

  $("#atualizar").addEventListener("click", function () {
    if (estado.secao === "tempo-real") carregarRt();
    else if (estado.secao === "config") carregarConfig();
    else carregarResumo();
  });

  $("#cfg-salvar").addEventListener("click", async function () {
    var botao = $("#cfg-salvar");
    var status = $("#cfg-status");
    botao.disabled = true;
    status.textContent = "";

    try {
      var resultado = await api("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coleta: $("#cfg-coleta").checked,
          geo: $("#cfg-geo").checked,
          retencaoDias: Number($("#cfg-retencao").value)
        })
      });
      status.textContent = resultado.coleta ? "Configurações salvas." : "Coleta pausada.";
      aviso("Configurações salvas.");
    } catch (erro) {
      aviso(erro.message, true);
    } finally {
      botao.disabled = false;
    }
  });

  document.querySelectorAll("[data-export]").forEach(function (botao) {
    botao.addEventListener("click", function () {
      var dias = $("#export-dias").value;
      window.location.href =
        "/api/admin/exportar?tipo=" + encodeURIComponent(botao.dataset.export) + "&dias=" + encodeURIComponent(dias);
    });
  });

  $("#form-senha").addEventListener("submit", async function (evento) {
    evento.preventDefault();
    var atual = $("#senha-atual").value;
    var nova = $("#senha-nova").value;
    var confirma = $("#senha-confirma").value;
    var botao = $("#senha-btn");

    if (nova.length < 8) {
      aviso("A nova senha precisa ter pelo menos 8 caracteres.", true);
      return;
    }
    if (nova !== confirma) {
      aviso("As senhas não coincidem.", true);
      return;
    }

    botao.disabled = true;
    try {
      await api("/api/admin/senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atual: atual, nova: nova })
      });
      $("#form-senha").reset();
      aviso("Senha alterada.");
    } catch (erro) {
      aviso(erro.message, true);
    } finally {
      botao.disabled = false;
    }
  });

  $("#btn-limpar").addEventListener("click", async function () {
    var escopo = $("#limpar-escopo").value;
    var descricao = escopo === "tudo" ? "todos os dados de estatísticas" : "os dados com mais de " + escopo + " dias";
    var confirmacao = window.prompt("Digite APAGAR para confirmar a exclusão de " + descricao + ":");

    if (confirmacao === null) return;
    if (confirmacao.trim().toUpperCase() !== "APAGAR") {
      aviso("Confirmação incorreta. Nada foi apagado.", true);
      return;
    }

    var corpo =
      escopo === "tudo"
        ? { confirmar: "APAGAR", tudo: true }
        : { confirmar: "APAGAR", dias: Number(escopo) };

    try {
      var resultado = await api("/api/admin/limpar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
      aviso(numero(resultado.removidos) + " arquivo(s) apagado(s).");
      carregarResumo(true);
    } catch (erro) {
      aviso(erro.message, true);
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    if (estado.secao === "tempo-real") carregarRt(true);
    else if (estado.secao === "visao") carregarResumo(true);
  });

  /* ---------- início ---------- */

  (async function iniciar() {
    try {
      var sessao = await api("/api/admin/sessao");
      if (sessao.autenticado) mostrarApp();
      else mostrarLogin();
    } catch (erro) {
      mostrarLogin();
    }
  })();
})();
