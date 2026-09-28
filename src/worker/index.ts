import { cleanName } from "../shared/settings";
import { PowerUpTable } from "./table";

export { PowerUpTable };

const TABLE_ID = /^[a-z0-9]{8,16}$/;
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 10 unambiguous characters (~49 bits): unguessable enough for a link shared among friends. */
function newTableId(): string {
  const limit = 256 - (256 % ID_ALPHABET.length); // reject bytes that would bias the modulo
  let out = "";
  while (out.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < 10) out += ID_ALPHABET[b % ID_ALPHABET.length];
    }
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function createTable(request: Request, env: Env): Promise<Response> {
  let body: { name?: unknown; settings?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const hostName = cleanName(body?.name);
  if (!hostName) return json({ error: "Please enter your name" }, 400);
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newTableId();
    const result = await env.TABLES.getByName(id).create({ id, settings: body?.settings ?? {}, hostName });
    if (result.ok) return json({ id, playerId: result.playerId, token: result.token }, 201);
    if (!result.exists) return json({ error: result.error }, 400);
  }
  return json({ error: "Could not create a table, please try again" }, 500);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/tables" && request.method === "POST") {
      return createTable(request, env);
    }
    const ws = url.pathname.match(/^\/api\/tables\/([^/]+)\/ws$/);
    if (ws) {
      if (!TABLE_ID.test(ws[1])) return json({ error: "Table not found" }, 404);
      return env.TABLES.getByName(ws[1]).fetch(request);
    }
    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
