// Copies the Tesseract.js worker, WebAssembly core and Hebrew/English language
// data from node_modules into public/tesseract, so the browser loads them from
// this site instead of a third-party CDN. Runs before `dev` and `build`.
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, "public", "tesseract");
const nm = path.join(root, "node_modules");

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.rmSync(out, { recursive: true, force: true });
copy(path.join(nm, "tesseract.js/dist/worker.min.js"), path.join(out, "worker.min.js"));
for (const f of fs.readdirSync(path.join(nm, "tesseract.js-core"))) {
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f)) copy(path.join(nm, "tesseract.js-core", f), path.join(out, "core", f));
}
for (const lang of ["heb", "eng"]) {
  copy(path.join(nm, `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), path.join(out, "lang", `${lang}.traineddata.gz`));
}
console.log("Tesseract assets copied to public/tesseract");
