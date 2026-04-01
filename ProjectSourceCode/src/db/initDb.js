const fs = require("fs/promises");
const path = require("path");
const { pool } = require("./pool");

async function initDb() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
}

module.exports = { initDb };

if (require.main === module) {
  initDb()
    .then(() => {
      console.log("Database initialized.");
      return pool.end();
    })
    .catch((error) => {
      console.error("Database initialization failed", error);
      process.exit(1);
    });
}
