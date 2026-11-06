import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const instruments = url(compile('../src/instruments.ts'));
const helpers = await import(url(compile('../src/customAssets.ts').replace("'./instruments'", JSON.stringify(instruments))));
const {fitCustomAssets, visitAsset, readCustomAssets, normalizeTicker, validTicker} = helpers;
const entries = [{symbol:'AAPL',lastViewed:1},{symbol:'NVDA',lastViewed:2},{symbol:'MSFT',lastViewed:3}];
const widths = new Map(entries.map(x=>[x.symbol,80]));

test('explicit fund codes stay distinct from stock codes and saved choices',()=>{
 for(const value of ['基金000001','FUND000001','000001.OF']) {
  assert.equal(normalizeTicker(value),'000001.OF');assert.equal(validTicker(normalizeTicker(value)),true);
 }
 assert.equal(normalizeTicker('000001'),'000001.SZ');
 globalThis.localStorage={getItem:()=>JSON.stringify([{symbol:'000001.OF',lastViewed:1},{symbol:'000001.SZ',lastViewed:2}])};
 assert.deepEqual(readCustomAssets().map(x=>x.symbol),['000001.OF','000001.SZ']);
 delete globalThis.localStorage;
});

test('CN and HK codes normalize without breaking US share classes',()=>{
 for(const [input,expected] of [['600519','600519.SS'],['sh600519','600519.SS'],['600519.SH','600519.SS'],['000001','000001.SZ'],['SZ000001','000001.SZ'],['300750.SZ','300750.SZ'],['0700','0700.HK'],['00700','0700.HK'],['700.HK','0700.HK'],['hk09988','9988.HK'],['brk.b','BRK-B']]) {
  assert.equal(normalizeTicker(input),expected);
  assert.equal(validTicker(expected),true);
 }
 for(const input of ['0000.HK','600519.SZ','000001.SS','../700.HK','9999999']) assert.equal(validTicker(normalizeTicker(input)),false);
});
test('capacity evicts from the left regardless of recent visits, preserving the active asset',()=>{
 assert.deepEqual(fitCustomAssets(entries,widths,164,'AAPL').map(x=>x.symbol),['AAPL','MSFT']);
 const visited=visitAsset(entries,'AAPL',10);
 assert.deepEqual(fitCustomAssets(visited,widths,164,'MSFT').map(x=>x.symbol),['NVDA','MSFT']);
 assert.deepEqual(entries.map(x=>x.lastViewed),[1,2,3]);
});
test('different label widths determine capacity and active tab remains visible',()=>{
 assert.equal(fitCustomAssets(entries,new Map([['AAPL',100],['NVDA',80],['MSFT',70]]),154,'MSFT').length,2);
 assert.deepEqual(fitCustomAssets(entries,widths,0,'NVDA').map(x=>x.symbol),['NVDA']);
});
test('existing query updates recency without duplicate or reorder',()=>{
 assert.deepEqual(visitAsset(entries,'AAPL',10).map(x=>x.symbol),['AAPL','NVDA','MSFT']);
 assert.equal(visitAsset(entries,'TSLA',20).length,4);
});
test('ticker normalization and saved preferences keep all tickers and reject malformed entries',()=>{
 assert.equal(normalizeTicker(' brk.b '),'BRK-B');
 assert.equal(validTicker('BRK-B'),true);
 for(const code of ['SPX','NDX','../bad','^GSPC']) assert.equal(validTicker(code),false);
 globalThis.localStorage={getItem:()=>JSON.stringify([...entries,entries[0],{symbol:'QQQ',lastViewed:4},{symbol:'BAD',lastViewed:null}])};
 assert.deepEqual(readCustomAssets(),[...entries,{symbol:'QQQ',lastViewed:4}]);
 globalThis.localStorage={getItem:()=>'{bad'};
 assert.deepEqual(readCustomAssets().map(x=>x.symbol),['SPY','QQQ','SMH']);
});

test('initial defaults can all be evicted and are not restored from saved preferences',()=>{
 const initial=['SPY','QQQ','SMH'].map((symbol,lastViewed)=>({symbol,lastViewed}));
 let assets=initial;
 for(const [i,symbol] of ['NVDA','AAPL','MSFT'].entries()) {
   assets=visitAsset(assets,symbol,10+i);
   assets=fitCustomAssets(assets,new Map(assets.map(x=>[x.symbol,60])),186,symbol);
 }
 assert.deepEqual(assets.map(x=>x.symbol),['NVDA','AAPL','MSFT']);
 globalThis.localStorage={getItem:()=>JSON.stringify(assets)};
 assert.deepEqual(readCustomAssets(),assets);
});
test('legacy preferences migrate once with initial defaults',()=>{
 globalThis.localStorage={getItem:key=>key==='buythedip.assets.v2'?null:JSON.stringify(entries)};
 assert.deepEqual(readCustomAssets().map(x=>x.symbol),['SPY','QQQ','SMH','AAPL','NVDA','MSFT']);
});
