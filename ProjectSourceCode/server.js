const http = require("http");
const { Server } = require("socket.io");
const { createApp } = require("./src/app");
const { initSockets } = require("./src/sockets");
const { initDb } = require("./src/db/initDb");

const PORT = Number(process.env.PORT || 3000);

async function bootstrap() {
  await initDb();

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server);

  initSockets(io);
  app.set("io", io);

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
