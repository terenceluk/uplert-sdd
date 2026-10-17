import http from 'node:http';

/** Starts a throwaway local HTTP server standing in for a "monitored endpoint". */
export async function startMockEndpoint(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  async function close() {
    await new Promise((resolve) => server.close(resolve));
  }

  return { url, close, server };
}
