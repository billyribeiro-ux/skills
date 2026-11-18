import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export async function buildEntry(dir, job) {
  dir = fs.realpathSync(dir);
  const allowed = new Set(job.sources.map((file) => path.resolve(dir, file)));
  const output = path.resolve(dir, job.output);
  if (
    !output.startsWith(dir + path.sep) ||
    [...allowed].some((f) => !f.startsWith(dir + path.sep))
  )
    throw new Error("Invalid build path");
  const outputOptions = job.splitting
    ? {
        entryPoints: [{ in: job.entry, out: path.basename(job.output, ".js") }],
        outdir: path.dirname(job.output),
        chunkNames: "lazy/[name]-[hash]",
        splitting: true,
      }
    : { entryPoints: [job.entry], outfile: job.output };
  const result = await build({
    absWorkingDir: dir,
    ...outputOptions,
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    loader: { ".glsl": "text", ".vert": "text", ".frag": "text" },
    format: "esm",
    plugins: [
      {
        name: "embedded-sources",
        setup(builder) {
          builder.onLoad({ filter: /.*/ }, (args) =>
            allowed.has(args.path)
              ? undefined
              : {
                  errors: [
                    { text: "Import has no embedded source: " + args.path },
                  ],
                },
          );
        },
      },
    ],
    logLevel: "silent",
  });
  const actual = Object.keys(result.metafile.inputs).map((file) =>
    path.resolve(dir, file),
  );
  if (
    actual.length !== allowed.size ||
    actual.some((file) => !allowed.has(file)) ||
    !result.outputFiles.some((f) => f.path === output) ||
    (!job.splitting && result.outputFiles.length !== 1) ||
    Object.values(result.metafile.outputs).some((o) =>
      o.imports.some(
        (i) => i.external || !Object.hasOwn(result.metafile.outputs, i.path),
      ),
    )
  ) {
    throw new Error(
      "Rebuilt browser module graph lacks captured input or output",
    );
  }
  for (const file of result.outputFiles) {
    if (
      !file.path.startsWith(path.dirname(output) + path.sep) ||
      !file.path.endsWith(".js")
    )
      throw new Error("Unexpected build output");
  }
  for (const file of result.outputFiles) {
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.contents);
  }
  return Object.entries(result.metafile.outputs).map(([file, meta]) => ({
    file,
    inputs: Object.keys(meta.inputs),
    imports: meta.imports.map((i) => ({ file: i.path, kind: i.kind })),
  }));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const jobs = JSON.parse(
    fs.readFileSync(path.join(dir, ".native-tools", "entries.json")),
  );
  for (const job of jobs) await buildEntry(dir, job);
}
