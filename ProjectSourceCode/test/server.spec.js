const chai = require("chai");
const chaiHttp = require("chai-http");
const { startServer } = require("../server");
const { pool } = require("../src/db/pool");

chai.use(chaiHttp);
const { expect } = chai;

let globalServer = null;

// Before all tests: start server once
before(async function () {
  this.timeout(10000);
  const started = await startServer(0);
  globalServer = started.server;
});

// After all tests: close server once
after(async function () {
  if (globalServer) {
    globalServer.close();
  }
  await pool.end();
});

describe("Auth registration API", function () {
  this.timeout(10000);

  it("Positive: registers a new user and inserts into users table", async function () {
    this.timeout(5000);
    
    const email = `testuser_${Date.now()}@example.com`;
    const password = "validpass123";

    const res = await chai
      .request(globalServer)
      .post("/auth/register")
      .type("form")
      .send({ email, password });

    // chai-http follows redirects by default, so final status is 200 (home page)
    expect(res).to.have.status(200);

    const { rows } = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    expect(rows).to.have.length(1);
    expect(rows[0].email).to.equal(email);
  });

  it("Negative: rejects registration when password is too short", async function () {
    this.timeout(5000);
    
    const email = `shortpass_${Date.now()}@example.com`;
    const password = "short";

    const res = await chai
      .request(globalServer)
      .post("/auth/register")
      .type("form")
      .send({ email, password });

    expect(res).to.have.status(400);

    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    expect(rows).to.have.length(0);
  });
});

describe("Paint API", function () {
  this.timeout(10000);

  it("Positive: successfully paints a pixel with valid coordinates and color", async function () {
    this.timeout(5000);
    
    const paintPayload = {
      x: 100,
      y: 150,
      brushSize: 1,
      mode: "paint",
      color: "#FF0000"
    };

    const res = await chai
      .request(globalServer)
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

  it("Negative: rejects paint request with out-of-bounds coordinates", async function () {
    this.timeout(5000);
    
    const paintPayload = {
      x: -1,
      y: 500,
      brushSize: 1,
      mode: "paint",
      color: "#00FF00"
    };

    const res = await chai
      .request(globalServer)
      .post("/api/paint")
      .send(paintPayload);

    expect(res).to.have.status(400);
    expect(res.body).to.have.property("error");
    expect(res.body.error).to.include("out of bounds");

    const { rows } = await pool.query("SELECT COUNT(*) as count FROM canvas_pixels WHERE x = -1");
    expect(rows[0].count).to.equal("0");
  });
});