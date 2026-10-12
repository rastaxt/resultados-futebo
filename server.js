require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_TOKEN;
const BASE = "https://api.football-data.org/v4";

const cache = new Map();

async function api(pathname) {
  const hit = cache.get(pathname);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;

  const res = await fetch(BASE + pathname, {
    headers: { "X-Auth-Token": TOKEN }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  const data = await res.json();
  cache.set(pathname, { at: Date.now(), data });
  return data;
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/jogos", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const dateTo = req.query.dateTo || date;
    const ligas = ["BSA", "PL", "PD", "SA", "BL1", "FL1", "CL", "DED", "PPL", "ELC"];
    const grupos = await Promise.all(ligas.map(async (code) => {
      try {
        return await api(`/competitions/${code}/matches?dateFrom=${date}&dateTo=${dateTo}`);
      } catch {
        return { matches: [] };
      }
    }));
    const matches = grupos.flatMap(g => g.matches || []);
    res.json({ matches, resultSet: { count: matches.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tabela/:code", async (req, res) => {
  try {
    const data = await api(`/competitions/${req.params.code}/standings`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jogo/:id", async (req, res) => {
  try {
    const data = await api(`/matches/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/rodada/:code", async (req, res) => {
  try {
    const tabela = await api(`/competitions/${req.params.code}/standings`);
    const atual = tabela.season?.currentMatchday || 1;
    const total = 38;
    const pedida = Number(req.query.rodada) || atual;
    const rodada = Math.min(Math.max(pedida, 1), total);
    const data = await api(`/competitions/${req.params.code}/matches?matchday=${rodada}`);
    data.rodadaAtual = atual;
    data.rodada = rodada;
    data.totalRodadas = total;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});