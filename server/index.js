import path from 'node:path';
import express from 'express';
import { createApplication } from './app.js';

const { app, httpServer, roomStore, io, sources, downloadedLibrary } = await createApplication({ dataDir: path.resolve(process.env.COPLAY_DATA_DIR || 'data') });
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
if (production) {
  app.use(express.static(path.resolve('dist'), { setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); } }));
  app.get('/{*path}', (req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: '接口不存在' }) : res.sendFile(path.resolve('dist/index.html'), { headers: { 'Cache-Control': 'no-store' } }));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, '127.0.0.1', () => console.log(`\n  共映 CoPlay is ready\n  Local only: http://localhost:${port}\n`));
const shutdown = async () => { await Promise.allSettled([roomStore.flush(), sources.flush(), downloadedLibrary.flush()]); io.close(); httpServer.close(); setTimeout(() => process.exit(0), 1000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
