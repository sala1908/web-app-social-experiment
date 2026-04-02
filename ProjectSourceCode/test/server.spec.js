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
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") return reject(error);
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