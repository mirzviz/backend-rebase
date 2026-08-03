import { createServer } from 'http';
import { PORT } from './config';
import { handleRequest } from './proxy';

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`HTTP proxy listening on 127.0.0.1:${PORT}`);
});
