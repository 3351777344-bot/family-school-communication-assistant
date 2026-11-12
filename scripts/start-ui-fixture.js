// Local-only synthetic UI fixture: success -> failure -> slow success. No model requests.
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { outputFixture } = require("../tests/fixtures/prepare-output");
let calls = 0;
const fake = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    calls++;
    if (calls === 2) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    const reply = () => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(outputFixture()),
              },
            },
          ],
        }),
      );
    };
    if (calls > 2) setTimeout(reply, 3000);
    else reply();
  });
});
fake.listen(0, "127.0.0.1", () => {
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, "../app/server.js")],
    {
      env: {
        ...process.env,
        PORT: "8790",
        MOCK: "0",
        AI_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "synthetic-local-only",
        API_BASE: `http://127.0.0.1:${fake.address().port}`,
        MODEL: "local-ui-fixture",
      },
      stdio: "inherit",
    },
  );
  function stop() {
    child.kill();
    fake.close();
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", () => fake.close());
});
