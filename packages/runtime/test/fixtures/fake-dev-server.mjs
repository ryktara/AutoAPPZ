// Stand-in for a project dev server. Flags:
//   --port N         listen on N (default 0)
//   --hang-after MS  stop answering HTTP after MS (health degrades)
//   --crash-after MS exit(1) after MS
//   --host H         bind address (default 127.0.0.1; "::1" mimics dev servers whose localhost is IPv6-only)
//   --fail           print an error and exit(2) immediately
//   --spawn-child    spawn a long-lived child (tree-kill test); prints "child <pid>"
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(opt("--port") ?? 0);
if (args.includes("--fail")) {
  console.error("src/App.tsx(3,5): error TS2322: Type 'number' is not assignable to type 'string'.");
  console.error("ERR_PNPM_FETCH_404 GET https://registry.example/nope: Not Found");
  process.exit(2);
}
let hung = false;
const hangAfter = opt("--hang-after");
if (hangAfter)
  setTimeout(() => {
    hung = true;
  }, Number(hangAfter));
const crashAfter = opt("--crash-after");
if (crashAfter) setTimeout(() => process.exit(1), Number(crashAfter));
if (args.includes("--spawn-child")) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  console.log(`child ${child.pid}`);
}

const server = createServer((req, res) => {
  if (hung) return; // never answers
  if (req.url === "/index.html" || req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      '<!doctype html><html><head><title>fake</title></head><body><div id="root">hello</div></body></html>',
    );
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
const host = opt("--host") ?? "127.0.0.1";
server.listen(port, host, () => {
  const shown = host.includes(":") ? `[${host}]` : host;
  console.log(`  Local:   http://${shown}:${server.address().port}/`);
});
