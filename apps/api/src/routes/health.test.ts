import { describe, expect, it } from 'vitest';
import { createServer as createTcpServer } from 'node:net';
import { createServer } from '../server.js';

describe('health route', () => {
  it('reports the active store health', async () => {
    const app = await createServer();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        service: 'atoms-cp-api',
        checks: {
          database: 'memory'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('reports Redis as connected when the configured Redis endpoint replies to PING', async () => {
    const originalRedisUrl = process.env.REDIS_URL;
    const redisServer = createTcpServer((socket) => {
      socket.on('data', () => {
        socket.write('+PONG\r\n');
        socket.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      redisServer.once('error', reject);
      redisServer.listen(0, '127.0.0.1', () => resolve());
    });

    const address = redisServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    process.env.REDIS_URL = `redis://127.0.0.1:${address.port}`;
    const app = await createServer();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        checks: {
          redis: 'connected'
        }
      });
    } finally {
      await app.close();
      await new Promise<void>((resolve, reject) => {
        redisServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      if (originalRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = originalRedisUrl;
      }
    }
  });
});
