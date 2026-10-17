import { makeDb } from './db.js';
import { makeAdapters } from './adapters.js';
import { makeStorage } from './storage.js';
import { createApp } from './app.js';
import { seed, seedDemoBouquet } from './seed.js';
const db = await makeDb();
import crypto from 'node:crypto';
const internalToken = crypto.randomBytes(24).toString('hex'); // lets the in-process demo seeder pass Turnstile; never leaves the server
const { app, sweep } = createApp({ db, ...makeAdapters(), storage: makeStorage(), internalToken });
if (process.env.SEED !== '0') await seed(db);
setInterval(() => sweep().catch(console.error), Number(process.env.SWEEP_MS ?? 10000));
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => { console.log(`Bouquet API on :${port}`);
  if (process.env.SEED_DEMO !== '0') seedDemoBouquet(`http://127.0.0.1:${port}`, internalToken).catch(e => console.warn('demo seed skipped:', e.message)); });
