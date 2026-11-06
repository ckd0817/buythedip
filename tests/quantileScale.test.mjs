import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../src/quantileScale.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {keyPercentiles,quantileScalePosition}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('each key percentile aligns with its corresponding value column',()=>{
 keyPercentiles.forEach((value,i)=>assert.ok(Math.abs(quantileScalePosition(value)-(i+.5)/7*100)<1e-10));
});
test('intermediate scores stay between their labelled stops and endpoints clamp',()=>{
 assert.equal(quantileScalePosition(-1),0);
 assert.equal(quantileScalePosition(101),100);
 assert.ok(quantileScalePosition(97.5)>quantileScalePosition(95));
 assert.ok(quantileScalePosition(97.5)<quantileScalePosition(99));
 const positions=Array.from({length:1001},(_,i)=>quantileScalePosition(i/10));
 assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
});
