import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("memory.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    user_id INTEGER UNIQUE,
    nome TEXT,
    preferencias TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS conversas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    mensagem TEXT,
    resposta TEXT,
    data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

export function salvarUsuario(userId: number, nome: string) {
  db.prepare(
    "INSERT INTO usuarios (user_id, nome) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET nome = excluded.nome"
  ).run(userId, nome);
}

export function salvarConversa(userId: number, msg: string, resp: string) {
  db.prepare(
    "INSERT INTO conversas (user_id, mensagem, resposta) VALUES (?, ?, ?)"
  ).run(userId, msg, resp);
}

export function historico(userId: number, limite = 10) {
  return db
    .prepare(
      "SELECT mensagem, resposta FROM conversas WHERE user_id = ? ORDER BY id DESC LIMIT ?"
    )
    .all(userId, limite);
}

export function limparHistorico(userId: number) {
  db.prepare("DELETE FROM conversas WHERE user_id = ?").run(userId);
}
