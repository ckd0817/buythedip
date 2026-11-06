import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../src/shareQuotes.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {shareQuotes,quoteGroup,createQuotePicker,cleanQuote,layoutQuote,shareLink}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('27 approved quotes with exact boundaries and four zero-score quotes',()=>{
 assert.equal(shareQuotes.length,27);
 assert.equal(new Set(shareQuotes.map(x=>x.id)).size,27);
 assert.deepEqual([0,.1,50,50.1,99.9].map(quoteGroup),['zero','low','low','high','high']);
 assert.deepEqual(shareQuotes.filter(x=>x.group==='zero').map(x=>x.id),['bull-back','bright-future','baby-bull','too-little']);
 assert.ok(!shareQuotes.some(x=>x.zh==='别人恐惧，我贪婪。'||x.zh==='牛来，豹拉！'));
 for(const x of shareQuotes) assert.ok(Array.from(x.zh).length<=28);
});
test('shuffle bags exhaust each group once per round without boundary repeats',()=>{
 for(const score of [0,.1,50,50.1,99.9]) for(const random of [0,.2,.9,.99999]) {
  const pick=createQuotePicker(undefined,()=>random);
  const size=shareQuotes.filter(x=>x.group===quoteGroup(score)).length;
  let previous;
  for(let round=0;round<10;round++) {
   const seen=new Set();
   for(let i=0;i<size;i++) {
    const quote=pick(score);
    assert.equal(quote.group,quoteGroup(score));
    assert.notEqual(quote.id,previous);
    assert.ok(!seen.has(quote.id));seen.add(quote.id);previous=quote.id;
   }
   assert.equal(seen.size,size);
  }
 }
});

test('bags persist across picker recreation and groups advance independently',()=>{
 const values=new Map();
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const seen=new Set();
 const size=shareQuotes.filter(x=>x.group==='high').length;
 for(let i=0;i<size;i++) {
  const pick=createQuotePicker(storage,()=>.5);
  const quote=pick(70);assert.ok(!seen.has(quote.id));seen.add(quote.id);
  pick(0);pick(20);
 }
 assert.equal(seen.size,size);
});

test('broken or blocked storage falls back to valid non-repeating draws',()=>{
 for(const storage of [
  {getItem:()=>'{broken',setItem:()=>{throw Error('blocked')}},
  {getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}},
  {getItem:()=>JSON.stringify({high:{pool:'outdated',remaining:['missing']}}),setItem:()=>{}},
 ]) {
  const pick=createQuotePicker(storage,()=>0);
  assert.equal(pick(99).group,'high');
 }
 const pick=createQuotePicker({getItem:()=>{throw Error()},setItem:()=>{throw Error()}},()=>0);
 const size=shareQuotes.filter(x=>x.group==='low').length;
 assert.equal(new Set(Array.from({length:size},()=>pick(20).id)).size,size);
});

test('custom text normalizes control characters and limits Unicode code points',()=>{
 assert.equal(cleanQuote('甲\n乙\u202e丙',28),'甲 乙 丙');
 assert.equal(cleanQuote('😀'.repeat(30),28),'😀'.repeat(28));
 assert.equal(cleanQuote('a'.repeat(100),80).length,80);
});
const measure=(line,size)=>Array.from(line).reduce((sum,glyph)=>sum+(glyph.codePointAt(0)>255?1:.6)*size,0);
test('every preset and worst-case custom quote fits the fixed poster region',()=>{
 for(const value of [...shareQuotes.flatMap(x=>[x.zh,x.en]),'赢'.repeat(28),'W'.repeat(80),'赢'.repeat(80),'😄'.repeat(28)]){
  const result=layoutQuote(value,measure);
  assert.ok(result.lines.length*result.size*1.16<=410);
  for(const line of result.lines) assert.ok(measure(line,result.size)<=968);
 }
 assert.throws(()=>layoutQuote('  ',measure),/empty_quote/);
});
test('link preserves ticker suffix and drops obsolete lookbacks and other parameters',()=>{
 assert.equal(shareLink('https://buythedip.kaida.sbs/?years=3&secret=bad#other','BRK-B'),'https://buythedip.kaida.sbs/?etf=BRK-B');
 assert.equal(shareLink('https://buythedip.kaida.sbs/','000001.OF'),'https://buythedip.kaida.sbs/?etf=000001.OF');
});
