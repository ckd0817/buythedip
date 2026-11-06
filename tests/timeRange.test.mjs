import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../src/timeRange.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {rangePresets,rangeForMonths,hasFullYears}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('chart presets are always one, three, five and ten years',()=>{
 assert.deepEqual(rangePresets(),[12,36,60,120]);
});

test('each preset selects the requested trailing calendar range',()=>{
 const dates=['2000-01-01','2016-11-03','2016-11-04','2021-11-04','2023-11-03','2023-11-06','2025-11-04','2026-11-04'];
 assert.deepEqual(rangePresets().map(months=>rangeForMonths(dates,months)),[[6,7],[5,7],[3,7],[2,7]]);
 assert.deepEqual(rangeForMonths(['2026-01-01','2026-11-04'],120),[0,1]);
 assert.deepEqual(rangeForMonths([],12),[0,0]);
});

test('availability uses full calendar years including leap days',()=>{
 assert.equal(hasFullYears('2023-03-01','2024-02-29',1),false);
 assert.equal(hasFullYears('2023-02-28','2024-02-29',1),true);
});
