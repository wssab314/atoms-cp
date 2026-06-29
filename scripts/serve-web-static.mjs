#!/usr/bin/env node
import { join } from 'node:path';
import { createWebStaticServer } from './web-static-server.mjs';

const rootDir = process.env.WEB_STATIC_ROOT ?? join(process.cwd(), 'apps/web/dist');
const port = Number.parseInt(process.env.WEB_STATIC_PORT ?? process.env.PORT ?? '8080', 10);
const host = process.env.WEB_STATIC_HOST ?? '0.0.0.0';
const apiProxyOrigin = process.env.WEB_API_PROXY_ORIGIN;

const server = createWebStaticServer({
  rootDir,
  apiProxyOrigin
});

server.listen(port, host, () => {
  console.log(`atoms-cp web static server listening on ${host}:${port}`);
});
