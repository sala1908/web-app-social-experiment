const chai = require("chai");
const chaiHttp = require("chai-http");
const { startServer } = require("../server");
const { pool } = require("../src/db/pool");

chai.use(chaiHttp);
const { expect } = chai;

describe("Auth registration API", () => {
  let server;

  before(async () => {
    const started = await startServer(0);
    server = started.server;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) return reject(error);
          return resolve();
        });
      });
    }
    await pool.end();
  });

  it("Positive: registers a new user and inserts into users table", async () => {
    const email = `testuser_${Date.now()}@example.com`;
    const password = "validpass123";

    const res = await chai
      .request(server)
      .post("/auth/register")
      .type("form")
      .send({ email, password });

    expect(res).to.have.status(200);

    const { rows } = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    expect(rows).to.have.length(1);
    expect(rows[0].email).to.equal(email);
  });

  it("Negative: rejects registration when password is too short", async () => {
    const email = `shortpass_${Date.now()}@example.com`;
    const password = "short";

    const res = await chai
      .request(server)
      .post("/auth/register")
      .type("form")
      .send({ email, password });

    expect(res).to.have.status(400);

    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    expect(rows).to.have.length(0);
  });
});

describe("Paint API", () => {
  let server;

  before(async () => {
    const started = await startServer(0);
    server = started.server;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) return reject(error);
          return resolve();
        });
      });
    }
    await pool.end();
  });

  it("Positive: successfully paints a pixel with valid coordinates and color", async () => {
    const paintPayload = {
      x: 100,
      y: 150,
      brushSize: 1,
      mode: "paint",
      color: "#FF0000"
    };

    const res = await chai
      .request(server)
      .post("/api/paint")
      .send(paintPayload);

    expect(res).to.have.status(200);
    expect(res.body).to.have.property("ok").that.is.true;
    expect(res.body).to.have.property("modifiedPixels").that.is.an("array");
    expect(res.body.modifiedPixels).to.have.length(1);
    expect(res.body.modifiedPixels[0]).to.include({ x: 100, y: 150, color_hex: "#FF0000" });

    const { rows } = await pool.query(
      "SELECT x, y, color_hex FROM canvas_pixels WHERE x = $1 AND y = $2",
      [100, 150]
    );
    expect(rows).to.have.length(1);
    expect(rows[0].color_hex).to.equal("#FF0000");
  });

  it("Negative: rejects paint request with out-of-bounds coordinates", async () => {
    const paintPayload = {
      x: -1,
      y: 500,
      brushSize: 1,
      mode: "paint",
      color: "#00FF00"
    };

    const res = await chai
      .request(server)
      .post("/api/paint")
      .send(paintPayload);

    expect(res).to.have.status(400);
    expect(res.body).to.have.property("error");
    expect(res.body.error).to.include("out of bounds");

    const { rows } = await pool.query("SELECT COUNT(*) as count FROM canvas_pixels WHERE x = -1");
    expect(rows[0].count).to.equal("0");
  });
});