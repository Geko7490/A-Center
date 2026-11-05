const http = require("node:http");

// A stable Studio endpoint; the private desktop API stays on its random port.
async function createRobloxBridge(target, port = 7817) {
  const routes = new Map([["GET /roblox/next-command", "/roblox/next-command"], ["POST /roblox/command-result", "/roblox/command-result"]]);
  routes.set('GET /roblox/panel','/roblox/panel');routes.set('POST /roblox/panel','/roblox/panel');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const route = routes.get(`${req.method} ${url.pathname}`);
    if (req.headers.origin || !route) { res.writeHead(403); res.end(); return; }
    const upstream = http.request(new URL(route + url.search, target), { method: req.method, headers: {
      "content-type": "application/json", "x-vex-token": req.headers["x-vex-token"] || "",
    }, timeout: 15000 }, response => {
      res.writeHead(response.statusCode, {"content-type":"application/json", "cache-control":"no-store"});
      response.pipe(res);
    });
    let size = 0;
    req.on("data", chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) { upstream.destroy(); res.writeHead(413); res.end(); req.destroy(); } });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { port: server.address().port, close: () => server.close() };
}
module.exports = { createRobloxBridge };
