#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertJsxSourceToSvelte } from "./ast-jsx-to-svelte.mjs";
import { assertStageCertified } from "../../shared/pipeline-gate.mjs";

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const fileArg = getArg("--file", null);
const batchArg = getArg("--batch", null);
const sourceDir = path.resolve(getArg("--source", "./01-native"));
const targetDir = path.resolve(getArg("--target", "./02-svelte5"));
const planFile = path.resolve(
  getArg("--plan", path.join(targetDir, "conversion-batches.json")),
);
const stdoutMode = args.includes("--stdout");

let cachedDims = null;
function loadDimensionsMap() {
  if (cachedDims) return cachedDims;
  cachedDims = {};
  const candidates = [
    path.join(targetDir, "forensics", "image-dimensions.json"),
    path.join(sourceDir, "forensics", "image-dimensions.json"),
    path.join(
      path.dirname(sourceDir),
      "00-mirror",
      "forensics",
      "image-dimensions.json",
    ),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        cachedDims = JSON.parse(fs.readFileSync(c, "utf8"));
        break;
      } catch {}
    }
  }
  return cachedDims;
}

export function convertJsxToSvelte(sourceCode, options = {}) {
  const imgDims = loadDimensionsMap();
  const astResult = convertJsxSourceToSvelte(sourceCode, {
    ...options,
    imgDims,
  });
  if (astResult) return astResult;

  throw new Error(
    `Unsupported component structure in ${options.name ?? "input"}. Preserve the source for explicit conversion.`,
  );
}

if (
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    (fs.existsSync(process.argv[1]) &&
      fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])))
) {
  if (fileArg) {
    const filePath = path.resolve(fileArg);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, "utf8");
    const base = path.basename(filePath);
    const compName = base.replace(/\.[^.]+$/, "");
    const converted = convertJsxToSvelte(content, { name: compName });

    if (stdoutMode) {
      process.stdout.write(converted);
    } else {
      const outPath = path.join(path.dirname(filePath), `${compName}.svelte`);
      fs.writeFileSync(outPath, converted, "utf8");
      console.log(`✅ AST Pre-Converted ${filePath} -> ${outPath}`);
    }
  } else if (batchArg || args.includes("--all")) {
    if (batchArg && args.includes("--all"))
      throw new Error("Select one batch or --all.");
    assertStageCertified({
      requiredStage: 1,
      dir: sourceDir,
      callerName: "preconvert-jsx-markup.mjs",
    });
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const selected = batchArg
      ? plan.batches.filter((b) => b.batchIndex === Number(batchArg))
      : plan.batches;
    if (batchArg && selected.length !== 1)
      throw new Error("Unknown batch: " + batchArg);
    const sources = new Map();
    const outputs = new Set();
    for (const batch of plan.batches) {
      for (const file of batch.files) {
        const sourcePath = path.resolve(sourceDir, file.sourcePath);
        const outputPath = path.resolve(targetDir, file.targetSubpath);
        if (
          !sourcePath.startsWith(sourceDir + path.sep) ||
          !outputPath.startsWith(targetDir + path.sep)
        ) {
          throw new Error(
            "Plan path outside the selected directories: " + file.sourcePath,
          );
        }
        if (outputs.has(outputPath))
          throw new Error("Duplicate conversion target: " + outputPath);
        outputs.add(outputPath);
        sources.set(path.normalize(file.sourcePath), file);
      }
    }
    const extensions = [".js", ".jsx", ".ts", ".tsx"];
    for (const batch of selected) {
      const writes = [];
      for (const file of batch.files) {
        const content = fs.readFileSync(
          path.resolve(sourceDir, file.sourcePath),
        );
        const output = path.resolve(targetDir, file.targetSubpath);
        if (!output.endsWith(".svelte")) {
          writes.push([output, content]);
          continue;
        }
        const converted = convertJsxToSvelte(content.toString("utf8"), {
          name: path.parse(file.fileName).name,
          resolveImport(specifier) {
            if (!specifier.startsWith(".")) return specifier;
            const base = path.join(path.dirname(file.sourcePath), specifier);
            const possibilities = [
              base,
              ...extensions.map((ext) => base + ext),
              ...extensions.map((ext) => path.join(base, "index" + ext)),
            ];
            const match = possibilities
              .map((key) => sources.get(key))
              .find(Boolean);
            if (!match) return specifier;
            const rel = path
              .relative(path.dirname(file.targetSubpath), match.targetSubpath)
              .split(path.sep)
              .join("/");
            return rel.startsWith(".") ? rel : "./" + rel;
          },
        });
        writes.push([output, converted]);
      }
      for (const [output, content] of writes) {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, content);
      }
      console.log(
        "Converted batch " +
          batch.batchIndex +
          " (" +
          writes.length +
          " files).",
      );
    }
  } else {
    console.error(
      `Usage: node preconvert-jsx-markup.mjs --all | --batch <N> | --file <Component.jsx>`,
    );
    process.exit(1);
  }
}
