// The writers tell the reading room what they wrote.
//
// Best effort, on purpose. The record is Firestore and the commit has already
// landed by the time this runs; the room reconciles against the record on its
// own if a message is lost. So a slow or absent room can cost a poll some
// freshness, but never a result. The node test scripts build every object
// with a bare env, and that is why an unbound room is simply a no-op.

const WAIT_MS = 2000;

export async function tellCommons(env, path, body) {
  if (!env?.COMMONS) return false;
  try {
    const stub = env.COMMONS.get(env.COMMONS.idFromName("global"));
    const res = await Promise.race([
      stub.fetch(`https://commons${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("the room did not answer")), WAIT_MS)),
    ]);
    return res.ok;
  } catch (err) {
    console.error(`[commons] ${path}: ${err.message}`);
    return false;
  }
}
