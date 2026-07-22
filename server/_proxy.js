const http = require("http");
http.createServer((req, res) => {
  const p = http.request({ host:"localhost", port:3002, path:req.url, method:req.method,
    headers:{...req.headers, "x-forwarded-proto":"https"} },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p); p.on("error", () => { res.writeHead(502); res.end(); });
}).listen(3003);
