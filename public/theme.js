/* XTscores — alternância de tema (claro/escuro) sem flash na carga */
(function () {
  var CHAVE = "xt-tema";
  var raiz = document.documentElement;
  var midia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function lerSalvo() {
    try {
      var valor = localStorage.getItem(CHAVE);
      if (valor === "claro") return "light";
      if (valor === "escuro") return "dark";
    } catch (erro) {
      /* localStorage indisponível (modo privado) */
    }
    return null;
  }

  function temaDoSistema() {
    return midia && midia.matches ? "light" : "dark";
  }

  function pintarMeta(tema) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", tema === "light" ? "#eef3f9" : "#0f1419");
  }

  function rotularBotao(tema) {
    var botao = document.getElementById("tema");
    if (!botao) return;
    var claro = tema === "light";
    var acao = claro ? "Mudar para tema escuro" : "Mudar para tema claro";
    botao.setAttribute("aria-label", acao);
    botao.setAttribute("title", acao);
    botao.setAttribute("aria-pressed", String(claro));
  }

  function aplicar(tema) {
    raiz.setAttribute("data-theme", tema);
    raiz.style.colorScheme = tema;
    pintarMeta(tema);
    rotularBotao(tema);
  }

  aplicar(lerSalvo() || temaDoSistema());

  document.addEventListener("DOMContentLoaded", function () {
    rotularBotao(raiz.getAttribute("data-theme") || temaDoSistema());

    var botao = document.getElementById("tema");
    if (!botao) return;
    botao.addEventListener("click", function () {
      var novo = raiz.getAttribute("data-theme") === "light" ? "dark" : "light";
      try {
        localStorage.setItem(CHAVE, novo === "light" ? "claro" : "escuro");
      } catch (erro) {
        /* sem persistência: aplica só nesta sessão */
      }
      aplicar(novo);
    });
  });

  /* Segue o sistema enquanto o usuário não escolher manualmente. */
  if (midia) {
    var aoMudarSistema = function (evento) {
      if (!lerSalvo()) aplicar(evento.matches ? "light" : "dark");
    };
    if (midia.addEventListener) midia.addEventListener("change", aoMudarSistema);
    else if (midia.addListener) midia.addListener(aoMudarSistema);
  }
})();
