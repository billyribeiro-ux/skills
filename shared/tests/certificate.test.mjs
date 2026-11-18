import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {computeStageDigest} from '../pipeline-gate.mjs';

test('certificate includes public build assets, raw maps and large media',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stage-digest-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const digest=()=>computeStageDigest(0,dir).digest;
  for(const name of ['build/main.js','__sourcemaps__/original.map','media/animation.bin']){
    const prev=digest();
    const file=path.join(dir,name);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,Buffer.alloc(name.endsWith('.bin')?2*1024*1024:16,1));
    assert.notEqual(digest(),prev);
    const added=digest();
    fs.appendFileSync(file,Buffer.from([2]));
    assert.notEqual(digest(),added);
  }
});
