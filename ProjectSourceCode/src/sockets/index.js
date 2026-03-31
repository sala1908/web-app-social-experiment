function initSockets(io) {
  io.on("connection", (socket) => {
    socket.emit("connected", { ok: true, id: socket.id });
  });
}

module.exports = { initSockets };
