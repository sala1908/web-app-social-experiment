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
    const username = `tester_${Date.now()}`;
    const password = "validpass123";

    const res = await chai
      .request(globalServer)
      .post("/auth/register")
      .type("form")
      .send({ email, username, password });

    // chai-http follows redirects by default, so final status is 200 (home page)
    expect(res).to.have.status(200);

    const { rows } = await pool.query("SELECT id, email, username FROM users WHERE email = $1", [email]);
    expect(rows).to.have.length(1);
    expect(rows[0].email).to.equal(email);
    expect(rows[0].username).to.equal(username);
  });

  it("Negative: rejects registration when password is too short", async function () {
    this.timeout(5000);
    
    const email = `shortpass_${Date.now()}@example.com`;
    const username = `short_${Date.now()}`;
    const password = "short";

    const res = await chai
      .request(globalServer)
      .post("/auth/register")
      .type("form")
      .send({ email, username, password });

    expect(res).to.have.status(400);

    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    expect(rows).to.have.length(0);
  });

  it("Positive: returns user xp and level from /api/me on initial logged-in load", async function () {
    this.timeout(7000);

    const email = `me_state_${Date.now()}@example.com`;
    const username = `me_state_${Date.now()}`;
    const password = "validpass123";
    const agent = chai.request.agent(globalServer);

    await agent
      .post("/auth/register")
      .type("form")
      .send({ email, username, password });

    const { rows: userRows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    const userId = userRows[0].id;
    await pool.query("UPDATE users SET xp = 245, level = 2 WHERE id = $1", [userId]);

    const meRes = await agent.get("/api/me");
    expect(meRes).to.have.status(200);
    expect(meRes.body).to.have.property("authenticated", true);
    expect(meRes.body).to.have.property("user");
    expect(meRes.body.user).to.include({ xp: 245, level: 2 });

    agent.close();
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
    expect(res.body.modifiedPixels[0]).to.have.property("owner_tag");

    const { rows } = await pool.query(
      "SELECT x, y, color_hex, owner_tag FROM canvas_pixels WHERE x = $1 AND y = $2",
      [100, 150]
    );
    expect(rows).to.have.length(1);
    expect(rows[0].color_hex).to.equal("#FF0000");
    expect(rows[0].owner_tag).to.be.a("string");
  });

  it("Positive: awards 1 XP per painted pixel and levels up from level 0", async function () {
    this.timeout(7000);

    const email = `xp_user_${Date.now()}@example.com`;
    const username = `xp_user_${Date.now()}`;
    const password = "validpass123";
    const agent = chai.request.agent(globalServer);

    await agent
      .post("/auth/register")
      .type("form")
      .send({ email, username, password });

    const userRow = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    const userId = userRow.rows[0].id;

    await pool.query("UPDATE users SET xp = 99, level = 0 WHERE id = $1", [userId]);

    const res = await agent
      .post("/api/paint")
      .send({
        x: 210,
        y: 211,
        brushSize: 1,
        mode: "paint",
        color: "#00FF00"
      });

    expect(res).to.have.status(200);
    expect(res.body).to.include({ xpGained: 1, xp: 100, level: 1 });

    const { rows } = await pool.query("SELECT xp, level FROM users WHERE id = $1", [userId]);
    expect(rows).to.have.length(1);
    expect(rows[0].xp).to.equal(100);
    expect(rows[0].level).to.equal(1);

    agent.close();
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

describe("Social interactions", function () {
  this.timeout(15000);

  it("blocks protected painting and enforces role-specific interaction actions", async function () {
    this.timeout(10000);

    const ownerEmail = `owner_${Date.now()}@example.com`;
    const challengerEmail = `challenger_${Date.now()}@example.com`;
    const ownerUsername = `owner_${Date.now()}`;
    const challengerUsername = `challenger_${Date.now()}`;
    const password = "validpass123";

    const ownerAgent = chai.request.agent(globalServer);
    const challengerAgent = chai.request.agent(globalServer);

    await ownerAgent.post("/auth/register").type("form").send({ email: ownerEmail, username: ownerUsername, password });
    await challengerAgent.post("/auth/register").type("form").send({ email: challengerEmail, username: challengerUsername, password });

    const ownerRow = await pool.query("SELECT id, username FROM users WHERE email = $1", [ownerEmail]);
    const challengerRow = await pool.query("SELECT id, username FROM users WHERE email = $1", [challengerEmail]);

    const protectedPixels = [
      { x: 640, y: 640 },
      { x: 641, y: 640 },
      { x: 642, y: 640 }
    ];

    for (const pixel of protectedPixels) {
      const paintResponse = await challengerAgent
        .post("/api/paint")
        .send({
          x: pixel.x,
          y: pixel.y,
          brushSize: 1,
          mode: "paint",
          color: "#00FF00"
        });

      expect(paintResponse).to.have.status(200);
    }

    const paintedPixel = await pool.query("SELECT owner_tag FROM canvas_pixels WHERE x = $1 AND y = $2", [640, 640]);
    expect(paintedPixel.rows[0].owner_tag).to.equal(challengerUsername);

    const protectedGroupPaint = await ownerAgent
      .post("/api/paint")
      .send({
        x: 641,
        y: 641,
        brushSize: 1,
        mode: "paint",
        color: "#FF0000"
      });

    expect(protectedGroupPaint).to.have.status(403);
    expect(protectedGroupPaint.body).to.have.property("error");
    expect(protectedGroupPaint.body.error).to.include("Protected space");

    const likeResponse = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "like",
        targetUserId: challengerRow.rows[0].id,
        targetOwnerTag: challengerUsername,
        groupX: 640,
        groupY: 640
      });

    expect(likeResponse).to.have.status(200);
    expect(likeResponse.body).to.have.property("ok").that.is.true;

    const reportResponse = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "report",
        targetUserId: challengerRow.rows[0].id,
        targetOwnerTag: challengerUsername,
        groupX: 640,
        groupY: 640
      });

    expect(reportResponse).to.have.status(200);

    const friendResponse = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "friend",
        targetUserId: challengerRow.rows[0].id,
        targetOwnerTag: challengerUsername,
        groupX: 640,
        groupY: 640
      });

    expect(friendResponse).to.have.status(200);

    const invalidBanForUserTarget = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "ban",
        targetUserId: challengerRow.rows[0].id,
        targetOwnerTag: challengerUsername,
        groupX: 640,
        groupY: 640
      });

    expect(invalidBanForUserTarget).to.have.status(400);

    const invalidLoveForUserTarget = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "love",
        targetUserId: challengerRow.rows[0].id,
        targetOwnerTag: challengerUsername,
        groupX: 640,
        groupY: 640
      });

    expect(invalidLoveForUserTarget).to.have.status(400);

    const adminLove = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "love",
        targetUserId: null,
        targetOwnerTag: "Admin",
        groupX: 640,
        groupY: 640
      });

    expect(adminLove).to.have.status(200);

    const adminRemove = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "remove",
        targetUserId: null,
        targetOwnerTag: "Admin",
        groupX: 640,
        groupY: 640
      });

    expect(adminRemove).to.have.status(200);

    const adminBan = await ownerAgent
      .post("/api/interactions")
      .send({
        interactionType: "ban",
        targetUserId: null,
        targetOwnerTag: "Admin",
        groupX: 640,
        groupY: 640
      });

    expect(adminBan).to.have.status(200);

    const { rows } = await pool.query(
      "SELECT actor_user_id, target_user_id, target_owner_tag, target_group_x, target_group_y, interaction_type FROM canvas_interactions WHERE actor_user_id = $1 AND interaction_type IN ('like', 'report', 'friend', 'love', 'remove', 'ban') ORDER BY created_at ASC",
      [ownerRow.rows[0].id]
    );

    expect(rows.map((row) => row.interaction_type)).to.include.members(["like", "report", "friend", "love", "remove", "ban"]);
  });
});