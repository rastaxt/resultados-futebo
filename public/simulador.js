/* XTscores — simulador do Brasileirão */

(function () {
  "use strict";

  var FUSO = "America/Sao_Paulo";
  var CHAVE_SIMS = "xt-simulador";
  var TEMPO_AVISO = 4200;

  var el = {
    temporada: document.querySelector("#temporada"),
    rodada: document.querySelector("#rodada"),
    anterior: document.querySelector("#rodada-anterior"),
    proxima: document.querySelector("#rodada-proxima"),
    limpar: document.querySelector("#limpar"),
    restaurar: document.querySelector("#restaurar"),
    visao: document.querySelector(".sim-visao"),
    aviso: document.querySelector("#sim-aviso"),
    grid: document.querySelector("#sim-grid"),
    painelJogos: document.querySelector("#painel-jogos"),
    painelTabela: document.querySelector("#painel-tabela"),
    tituloJogos: document.querySelector("#titulo-jogos"),
    seloRodada: document.querySelector("#selo-rodada"),
    seloTabela: document.querySelector("#selo-tabela"),
    jogos: document.querySelector("#jogos"),
    tabela: document.querySelector("#tabela")
  };

  var estado = {
    temporada: null,
    rodadaAtual: null,
    rodada: 1,
    visao: "ambos",
    partidas: [],
    rodadas: [],
    /* Apenas os placares simulados: { idDoJogo: [casa, fora] } */
    sims: {}
  };

  var timerAviso = null;

  /* ---------- utilitários ---------- */

  function esc(valor) {
    return String(valor == null ? "" : valor).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function escudo(time) {
    return time && time.escudo
      ? '<img src="' + esc(time.escudo) + '" alt="" width="26" height="26" loading="lazy">'
      : "";
  }

  function quando(iso) {
    var data = new Date(iso);
    var dia = data.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      weekday: "short",
      timeZone: FUSO
    });
    var hora = data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: FUSO
    });
    return dia.replace(".", "") + " · " + hora;
  }

  function aviso(mensagem) {
    el.aviso.textContent = mensagem;
    el.aviso.classList.remove("escondido");
    clearTimeout(timerAviso);
    timerAviso = setTimeout(function () {
      el.aviso.classList.add("escondido");
    }, TEMPO_AVISO);
  }

  /* ---------- simulações salvas no navegador ---------- */

  function chaveSims(temporada) {
    return CHAVE_SIMS + ":" + temporada;
  }

  function lerSims(temporada) {
    var guardado = {};
    try {
      guardado = JSON.parse(localStorage.getItem(chaveSims(temporada)) || "{}") || {};
    } catch (erro) {
      return {};
    }

    var limpo = {};
    Object.keys(guardado).forEach(function (id) {
      var par = guardado[id];
      if (!Array.isArray(par) || par.length !== 2) return;
      var casa = Number(par[0]);
      var fora = Number(par[1]);
      if (!Number.isInteger(casa) || !Number.isInteger(fora)) return;
      if (casa < 0 || fora < 0 || casa > 99 || fora > 99) return;
      limpo[id] = [casa, fora];
    });
    return limpo;
  }

  function salvarSims() {
    try {
      if (Object.keys(estado.sims).length) {
        localStorage.setItem(chaveSims(estado.temporada), JSON.stringify(estado.sims));
      } else {
        localStorage.removeItem(chaveSims(estado.temporada));
      }
    } catch (erro) {
      /* navegador sem armazenamento: a simulação vale só nesta página */
    }
  }

  /* ---------- placar efetivo ---------- */

  /* Jogo encerrado: sempre o placar oficial. Futuro: só conta com os dois lados. */
  function placarDe(jogo) {
    if (jogo.placar) return jogo.placar;
    var simulado = estado.sims[jogo.id];
    if (!simulado) return null;
    if (simulado[0] == null || simulado[1] == null) return null;
    return simulado;
  }

  function totalSimulacoes() {
    return Object.keys(estado.sims).length;
  }

  /* ---------- classificação ---------- */

  function zonaDe(posicao) {
    if (posicao <= 4) return "champions";
    if (posicao <= 6) return "europa";
    if (posicao <= 12) return "conference";
    if (posicao >= 17) return "rebaixamento";
    return "";
  }

  function classificar() {
    var linhas = new Map();

    function linhaDe(time) {
      if (!linhas.has(time.id)) {
        linhas.set(time.id, {
          id: time.id,
          nome: time.nome,
          escudo: time.escudo,
          pontos: 0,
          jogos: 0,
          vitorias: 0,
          empates: 0,
          derrotas: 0,
          gp: 0,
          gc: 0
        });
      }
      return linhas.get(time.id);
    }

    /* Todos os clubes entram na tabela, mesmo sem nenhum jogo encerrado. */
    estado.partidas.forEach(function (jogo) {
      linhaDe(jogo.casa);
      linhaDe(jogo.fora);
    });

    estado.partidas.forEach(function (jogo) {
      var placar = placarDe(jogo);
      if (!placar) return;

      var casa = linhaDe(jogo.casa);
      var fora = linhaDe(jogo.fora);
      var golsCasa = placar[0];
      var golsFora = placar[1];

      casa.jogos++;
      fora.jogos++;
      casa.gp += golsCasa;
      casa.gc += golsFora;
      fora.gp += golsFora;
      fora.gc += golsCasa;

      if (golsCasa > golsFora) {
        casa.vitorias++;
        fora.derrotas++;
        casa.pontos += 3;
      } else if (golsCasa < golsFora) {
        fora.vitorias++;
        casa.derrotas++;
        fora.pontos += 3;
      } else {
        casa.empates++;
        fora.empates++;
        casa.pontos++;
        fora.pontos++;
      }
    });

    return Array.from(linhas.values())
      .map(function (linha) {
        linha.saldo = linha.gp - linha.gc;
        return linha;
      })
      .sort(function (a, b) {
        return (
          b.pontos - a.pontos ||
          b.vitorias - a.vitorias ||
          b.saldo - a.saldo ||
          b.gp - a.gp ||
          a.nome.localeCompare(b.nome, "pt-BR")
        );
      });
  }

  function desenharTabela() {
    var linhas = classificar();

    if (!linhas.length) {
      el.tabela.innerHTML = '<p class="vazio">Sem jogos nesta temporada.</p>';
      return;
    }

    var corpo = linhas
      .map(function (linha, indice) {
        var posicao = indice + 1;
        return (
          '<tr class="' + zonaDe(posicao) + '">' +
          "<td>" + posicao + "</td>" +
          '<td><span class="sim-clube">' +
          (linha.escudo
            ? '<img src="' + esc(linha.escudo) + '" alt="" width="22" height="22" loading="lazy">'
            : "") +
          "<span>" + esc(linha.nome) + "</span></span></td>" +
          '<td class="sim-pontos">' + linha.pontos + "</td>" +
          "<td>" + linha.jogos + "</td>" +
          "<td>" + linha.vitorias + "</td>" +
          "<td>" + linha.empates + "</td>" +
          "<td>" + linha.derrotas + "</td>" +
          "<td>" + linha.gp + "</td>" +
          "<td>" + linha.gc + "</td>" +
          "<td>" + (linha.saldo > 0 ? "+" + linha.saldo : linha.saldo) + "</td>" +
          "</tr>"
        );
      })
      .join("");

    el.tabela.innerHTML =
      '<div class="sim-tabela-wrap"><table class="sim-tabela">' +
      "<thead><tr>" +
      '<th scope="col"><span class="rotulo-oculto">Posição</span>#</th>' +
      '<th scope="col">Clube</th>' +
      '<th scope="col" title="Pontos">P</th>' +
      '<th scope="col" title="Jogos">J</th>' +
      '<th scope="col" title="Vitórias">V</th>' +
      '<th scope="col" title="Empates">E</th>' +
      '<th scope="col" title="Derrotas">D</th>' +
      '<th scope="col" title="Gols pró">GP</th>' +
      '<th scope="col" title="Gols contra">GC</th>' +
      '<th scope="col" title="Saldo de gols">SG</th>' +
      "</tr></thead><tbody>" + corpo + "</tbody></table></div>";
  }

  /* ---------- jogos da rodada ---------- */

  function jogoHtml(jogo) {
    var simulado = estado.sims[jogo.id];
    var oficial = jogo.placar;
    var editavel = !oficial;
    var placar = oficial || simulado || [null, null];
    var casaValor = placar[0] == null ? "" : String(placar[0]);
    var foraValor = placar[1] == null ? "" : String(placar[1]);

    var inputs = editavel
      ? '<input class="sim-input" type="text" inputmode="numeric" autocomplete="off" maxlength="2" ' +
        'data-id="' + esc(jogo.id) + '" data-lado="casa" value="' + casaValor + '" ' +
        'aria-label="Gols de ' + esc(jogo.casa.nome) + '">' +
        '<i aria-hidden="true">×</i>' +
        '<input class="sim-input" type="text" inputmode="numeric" autocomplete="off" maxlength="2" ' +
        'data-id="' + esc(jogo.id) + '" data-lado="fora" value="' + foraValor + '" ' +
        'aria-label="Gols de ' + esc(jogo.fora.nome) + '">'
      : '<strong class="sim-num">' + oficial[0] + "</strong>" +
        '<i aria-hidden="true">×</i>' +
        '<strong class="sim-num">' + oficial[1] + "</strong>";

    var status = oficial
      ? jogo.status === "FINISHED" || jogo.status === "AWARDED"
        ? "Encerrado"
        : "Resultado oficial"
      : simulado && simulado[0] != null && simulado[1] != null
        ? "Simulado"
        : "Aguardando o placar";

    var classe = "sim-jogo" + (editavel ? "" : " encerrado") +
      (simulado && simulado[0] != null && simulado[1] != null ? " simulada" : "");

    return (
      '<article class="' + classe + '" data-jogo="' + esc(jogo.id) + '">' +
      '<p class="sim-quando">' + esc(quando(jogo.em)) + "</p>" +
      '<div class="sim-linha">' +
      '<span class="sim-time casa"><span>' + esc(jogo.casa.nome) + "</span>" +
      escudo(jogo.casa) + "</span>" +
      '<span class="sim-placar">' + inputs + "</span>" +
      '<span class="sim-time fora">' + escudo(jogo.fora) +
      "<span>" + esc(jogo.fora.nome) + "</span></span>" +
      "</div>" +
      '<p class="sim-status">' + status + "</p>" +
      "</article>"
    );
  }

  function desenharJogos() {
    var jogos = estado.partidas
      .filter(function (jogo) {
        return jogo.rodada === estado.rodada;
      })
      .sort(function (a, b) {
        return new Date(a.em) - new Date(b.em);
      });

    el.tituloJogos.textContent = estado.rodada ? "Rodada " + estado.rodada : "Jogos da rodada";

    if (!jogos.length) {
      el.jogos.innerHTML = '<p class="vazio">Nenhum jogo nesta rodada.</p>';
      return;
    }

    el.jogos.innerHTML = jogos.map(jogoHtml).join("");
  }

  /* ---------- estado da interface ---------- */

  function atualizarSelos() {
    var simulacoes = totalSimulacoes();
    el.seloTabela.textContent = simulacoes
      ? simulacoes + (simulacoes === 1 ? " jogo simulado" : " jogos simulados")
      : "Oficial";
    el.seloTabela.classList.toggle("ativo", simulacoes > 0);

    var total = estado.partidas.filter(function (jogo) {
      return jogo.rodada === estado.rodada;
    }).length;
    el.seloRodada.textContent = total ? total + (total === 1 ? " jogo" : " jogos") : "";

    el.limpar.disabled = !simulacoes;
    el.restaurar.disabled = !simulacoes;

    el.anterior.disabled = estado.rodada <= estado.rodadas[0];
    el.proxima.disabled = estado.rodada >= estado.rodadas[estado.rodadas.length - 1];
  }

  function aplicarVisao() {
    var mostraJogos = estado.visao === "ambos" || estado.visao === "jogos";
    var mostraTabela = estado.visao === "ambos" || estado.visao === "tabela";

    el.painelJogos.classList.toggle("escondido", !mostraJogos);
    el.painelTabela.classList.toggle("escondido", !mostraTabela);
    el.grid.classList.toggle("unico", estado.visao !== "ambos");

    Array.prototype.forEach.call(el.visao.querySelectorAll("[data-visao]"), function (botao) {
      var ativo = botao.dataset.visao === estado.visao;
      botao.classList.toggle("ativo", ativo);
      botao.setAttribute("aria-pressed", ativo ? "true" : "false");
    });
  }

  function desenharTudo() {
    desenharJogos();
    desenharTabela();
    atualizarSelos();
  }

  /* ---------- temporada e rodadas ---------- */

  function montarTemporadas(temporadas) {
    el.temporada.innerHTML = temporadas
      .map(function (item) {
        return (
          '<option value="' + item.temporada + '"' +
          (item.temporada === estado.temporada ? " selected" : "") + ">" +
          item.temporada + (item.atual ? " (atual)" : "") +
          "</option>"
        );
      })
      .join("");
  }

  function montarRodadas() {
    estado.rodadas = Array.from(
      new Set(
        estado.partidas
          .map(function (jogo) {
            return jogo.rodada;
          })
          .filter(function (rodada) {
            return Number.isInteger(rodada) && rodada > 0;
          })
      )
    ).sort(function (a, b) {
      return a - b;
    });

    el.rodada.innerHTML = estado.rodadas
      .map(function (rodada) {
        return (
          '<option value="' + rodada + '">Rodada ' + rodada +
          (rodada === estado.rodadaAtual ? " (atual)" : "") + "</option>"
        );
      })
      .join("");
  }

  function rodadaInicial() {
    if (estado.rodadas.indexOf(estado.rodadaAtual) >= 0) return estado.rodadaAtual;

    var proxima = estado.partidas.find(function (jogo) {
      return !jogo.placar;
    });
    if (proxima) return proxima.rodada;

    return estado.rodadas[estado.rodadas.length - 1] || 1;
  }

  function selecionarRodada(rodada) {
    if (estado.rodadas.indexOf(rodada) < 0) return;
    estado.rodada = rodada;
    el.rodada.value = String(rodada);
    desenharJogos();
    atualizarSelos();
  }

  /* ---------- carregamento ---------- */

  function desenharErro(mensagem) {
    el.jogos.innerHTML = '<p class="vazio">' + esc(mensagem) + "</p>";
    el.tabela.innerHTML = '<p class="vazio">' + esc(mensagem) + "</p>";
    el.seloRodada.textContent = "";
    el.seloTabela.textContent = "";
  }

  async function carregar(temporada) {
    el.jogos.innerHTML = '<p class="vazio">Carregando os jogos…</p>';
    el.tabela.innerHTML = '<p class="vazio">Carregando a classificação…</p>';

    try {
      var url = "/api/simulador" + (temporada ? "?season=" + encodeURIComponent(temporada) : "");
      var resposta = await fetch(url, { headers: { Accept: "application/json" } });
      var dados = await resposta.json().catch(function () {
        return {};
      });

      if (!resposta.ok) throw new Error(dados.error || "Não foi possível carregar o simulador.");

      estado.temporada = dados.temporada;
      estado.rodadaAtual = dados.rodadaAtual;
      estado.partidas = (dados.partidas || []).filter(function (jogo) {
        return jogo.rodada && jogo.casa && jogo.fora;
      });
      estado.sims = lerSims(dados.temporada);

      montarTemporadas(dados.temporadas || []);
      montarRodadas();

      estado.rodada = rodadaInicial();
      el.rodada.value = String(estado.rodada);

      desenharTudo();
      aplicarVisao();
    } catch (erro) {
      desenharErro(erro.message);
    }
  }

  /* ---------- interação ---------- */

  el.temporada.addEventListener("change", function () {
    carregar(Number(el.temporada.value));
  });

  el.rodada.addEventListener("change", function () {
    selecionarRodada(Number(el.rodada.value));
  });

  el.anterior.addEventListener("click", function () {
    var posicao = estado.rodadas.indexOf(estado.rodada);
    if (posicao > 0) selecionarRodada(estado.rodadas[posicao - 1]);
  });

  el.proxima.addEventListener("click", function () {
    var posicao = estado.rodadas.indexOf(estado.rodada);
    if (posicao >= 0 && posicao < estado.rodadas.length - 1) {
      selecionarRodada(estado.rodadas[posicao + 1]);
    }
  });

  el.visao.addEventListener("click", function (evento) {
    var botao = evento.target.closest("[data-visao]");
    if (!botao) return;
    estado.visao = botao.dataset.visao;
    aplicarVisao();
  });

  /* Ao digitar um placar, a tabela é recalculada na hora. */
  el.jogos.addEventListener("input", function (evento) {
    var campo = evento.target;
    if (!campo.classList || !campo.classList.contains("sim-input")) return;

    var digitos = campo.value.replace(/\D+/g, "").slice(0, 2);
    if (digitos !== campo.value) campo.value = digitos;

    var id = campo.dataset.id;
    var par = estado.sims[id] ? estado.sims[id].slice() : [null, null];
    par[campo.dataset.lado === "casa" ? 0 : 1] = digitos === "" ? null : Number(digitos);

    if (par[0] == null && par[1] == null) delete estado.sims[id];
    else estado.sims[id] = par;

    var cartao = campo.closest(".sim-jogo");
    if (cartao) {
      var completo = par[0] != null && par[1] != null;
      cartao.classList.toggle("simulada", completo);
      var status = cartao.querySelector(".sim-status");
      if (status) status.textContent = completo ? "Simulado" : "Aguardando o placar";
    }

    salvarSims();
    desenharTabela();
    atualizarSelos();
  });

  function limparSimulacoes() {
    estado.sims = {};
    salvarSims();
    desenharTudo();
  }

  el.limpar.addEventListener("click", function () {
    limparSimulacoes();
    aviso("Simulações removidas. A tabela voltou a mostrar apenas os resultados oficiais.");
  });

  el.restaurar.addEventListener("click", function () {
    limparSimulacoes();
    aviso("Classificação oficial restaurada.");
  });

  /* ---------- início ---------- */

  carregar(null);
})();
