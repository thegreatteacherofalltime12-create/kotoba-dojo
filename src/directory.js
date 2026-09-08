// One instance for the whole app. Every lobby reports its state here as it
// changes, because Durable Objects cannot be enumerated — there is no way to
// ask Cloudflare which ones are alive, so they have to announce themselves.
//
// Entries are pruned on read as well as on removal: a lobby whose Worker died
// mid-round never sends its goodbye, and a stale row would offer players a
// door into a room that no longer exists.

const STALE_MS = 90_000;

export class DojoDirectory {
  constructor(state) {
    this.state = state;
    state.blockConcurrencyWhile(async () => {
      this.dojos = (await state.storage.get("dojos")) || {};
    });
  }

  live() {
    const now = Date.now();
    const out = [];
    let changed = false;
    for (const [code, row] of Object.entries(this.dojos)) {
      if (now - row.updatedAt > STALE_MS || row.players < 1) {
        delete this.dojos[code];
        changed = true;
      } else {
        out.push(row);
      }
    }
    if (changed) this.state.storage.put({ dojos: this.dojos });
    // Busiest first, then longest-running.
    return out.sort((a, z) => z.players - a.players || a.openedAt - z.openedAt);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/list") {
      return Response.json({ dojos: this.live() });
    }

    // Which game a code belongs to. Codes are handed out from one pool, so
    // without this a battle code opens a crossword.
    if (url.pathname === "/find") {
      const code = url.searchParams.get("code");
      const row = this.live().find((r) => r.code === code);
      return Response.json({ game: row?.game || null, room: row || null });
    }

    if (url.pathname === "/announce") {
      const row = await request.json();
      if (!row?.code) return new Response("bad announce", { status: 400 });

      if (row.players < 1) delete this.dojos[row.code];
      else {
        const existing = this.dojos[row.code];
        this.dojos[row.code] = {
          code: row.code,
          game: row.game || "crossword",
          sensei: row.sensei || "Someone",
          players: row.players || 0,
          phase: row.phase || "LOBBY",
          puzzle: row.puzzle || null,
          roundNo: row.roundNo || 0,
          openedAt: existing?.openedAt || Date.now(),
          updatedAt: Date.now(),
        };
      }
      await this.state.storage.put({ dojos: this.dojos });
      return Response.json({ ok: true });
    }

    if (url.pathname === "/remove") {
      const { code } = await request.json();
      delete this.dojos[code];
      await this.state.storage.put({ dojos: this.dojos });
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }
}
