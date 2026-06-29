import { loadEnv } from './config/env.js';
import { createServer } from './server.js';

const env = loadEnv();
const app = await createServer();

await app.listen({
  host: '0.0.0.0',
  port: env.PORT
});
