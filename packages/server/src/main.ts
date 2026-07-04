/**
 * Vstupní bod serveru: postaví app a nechá ji naslouchat na portu.
 * Port lze přebít proměnnou PORT (využívá to i curl brána, aby si vzala volný).
 */

import { buildApp, DEFAULT_PORT } from './index.js';

const app = buildApp();
const port = Number(process.env.PORT ?? DEFAULT_PORT);

app
  .listen({ port, host: '127.0.0.1' })
  .then((address) => {
    console.log(`Server naslouchá na ${address}`);
  })
  .catch((err: unknown) => {
    console.error('Server se nepodařilo spustit:', err);
    process.exit(1);
  });
