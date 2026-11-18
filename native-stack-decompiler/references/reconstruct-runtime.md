# Continue from a partial native project

A decoder can recover the rendered document and identify a runtime module while its original file is unavailable. For each captured route, author new browser source that implements the behavior observed in the mirror and its interaction, shader and animation evidence. A minimal working candidate can cover one feature at a time during development. The continuation command requires an entry for every captured route before it assembles the verification candidate.

Keep the authored input in a separate local folder. Use relative imports for its complete JS, TS and GLSL source graph. Every file listed for an entry must participate in that entry's build. Describe the mapping in a versioned JSON file.

```json
{
  "version": 1,
  "routes": [
    {
      "route": "/",
      "entry": "hero/mount.ts",
      "sources": ["hero/mount.ts", "hero/draw.ts", "hero/fragment.glsl"],
      "evidence": ["forensics/interaction-contracts.json", "forensics/webgl-shaders.json"],
      "replaces": ["assets/hero.min.js"]
    }
  ]
}
```

The optional `replaces` list names unresolved script paths from the partial project's recovery ledger. Only matching script tags can be removed. The command adds a module mount to each existing native document. Captured framework scaffolding, complex dependency graphs or routes that require different markup can require additional source authoring. Verification will surface remaining differences.

```sh
node .agent/skills/native-stack-decompiler/scripts/continue-native.mjs \
  --mirror-dir ./00-mirror --native-dir ./01-native \
  --authored-dir ./native-repairs --manifest ./native-repairs.json \
  --out-dir ./01-native-candidate

node .agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir ./01-native-candidate --port 3011
# With the mirror running at :3010, run in another terminal.
node .agent/skills/native-stack-decompiler/scripts/verify-stage1-native.mjs \
  --mirror-dir ./00-mirror --native-dir ./01-native-candidate
```

Use a fresh output folder for each revision. Read `forensics/source-recovery.json` in the candidate for authored file hashes, the build closure, source evidence and output hashes by route. Its `reconstructed-runtime` status describes the runtime's identity. The original recovery ledger is preserved, including unresolved original files. The independent Stage 1 certificate records the parity result.
