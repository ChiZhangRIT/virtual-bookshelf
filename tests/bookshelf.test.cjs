const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const section = (start, end) => {
  const a = script.indexOf(start), b = script.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source section: ${start}`);
  return script.slice(a, b);
};
function core() {
  const context = vm.createContext({ TextEncoder, TextDecoder, btoa, atob, console });
  vm.runInContext([
    section('const LAYOUT =', '/* ---------- 设备 ---------- */'),
    section('const clamp =', 'function luminance('),
    section('function blank()', 'function loadState()'),
    section('function parseCSV(', 'function importCsv('),
    section('function mergeStates(', 'async function gh('),
  ].join('\n'), context);
  return { context, run: code => vm.runInContext(code, context) };
}

test('inline script and service worker compile', () => {
  new vm.Script(script);
  new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'));
});

test('updated BookBuddy genre and tag names have all three display languages', () => {
  const { context, run } = core();
  const cases = [
    ['Audio Recordings', '录音', '錄音', 'Audio Recordings'],
    ['Literature', '文学', '文學', 'Literature'],
    ['Religion & Mythology', '宗教与神话', '宗教與神話', 'Religion & Mythology'],
    ['Psychology & Growth', '心理与成长', '心理與成長', 'Psychology & Growth'],
    ['Philosophy & Society', '哲学与社会', '哲學與社會', 'Philosophy & Society'],
    ['Art & Design', '艺术与设计', '藝術與設計', 'Art & Design'],
    ['中國文史', '中国文史', '中國文史', 'Chinese Literature & History'],
    ['古典文學', '古典文学', '古典文學', 'Classical Literature'],
    ['歷史＆考古', '历史与考古', '歷史與考古', 'History & Archaeology'],
    ['語言文字學', '语言文字学', '語言文字學', 'Language & Philology'],
    ['古代哲學思想', '古代哲学思想', '古代哲學思想', 'Ancient Philosophy'],
    ['文學研究', '文学研究', '文學研究', 'Literary Studies'],
    ['書法＆篆刻', '书法与篆刻', '書法與篆刻', 'Calligraphy & Seal Carving'],
  ];
  for (const [raw, ...expected] of cases) {
    context.raw = raw;
    for (let i = 0; i < 3; i++) {
      context.lang = ['zh-Hans', 'zh-Hant', 'en'][i];
      assert.equal(run('genreName(raw, lang)'), expected[i], `${raw}: ${context.lang}`);
    }
    assert.equal(run('genreEnglish(raw)'), expected[2]);
  }
  assert.equal(run(`genreName('My custom category', 'zh-Hans')`), 'My custom category');
});

test('translations have matching keys in all languages', () => {
  const { run } = core();
  assert.equal(run(`LANGS.every(l => canon(Object.keys(MSG[l]).sort()) === canon(Object.keys(MSG['zh-Hans']).sort()))`), true);
});

test('CSV parser preserves multiline fields, commas and escaped quotes', () => {
  const { context, run } = core();
  context.csv = 'Title,Physical Location,Tags,Notes\r\n"A, B",A1,古典文學,"one\ntwo"\r\n"say ""hi""",C1,,end';
  assert.equal(run('parseCSV(csv)[1][0]'), 'A, B');
  assert.equal(run('parseCSV(csv)[1][3]'), 'one\ntwo');
  assert.equal(run('parseCSV(csv)[2][0]'), 'say "hi"');
});

function catalog() {
  const api = core();
  api.run(`
    var S = blank(), BOOK = new Map(), D, selectedK = null, L = { sync: null };
    const COLL = new Intl.Collator(['zh-Hans-CN-u-co-pinyin', 'en'], { numeric: true, sensitivity: 'base' });
    const confirm = () => true;
    const toast = () => {}, save = () => {}, render = () => derive(), fit = () => {}, requestPersist = () => {};
    ${section('const isGap =', '/* ---------- CSV ---------- */')}
    ${section('function importCsv(', '/* ---------- 备份 ---------- */')}
    ${section('function restore(', 'async function importFile(')}
    ${section('function prep(', '/* ---------- 画书架 ---------- */')}
    ${section('function geometry()', '/* 书脊上的字：')}
    ${section('function matches(', 'function setQuery(')}
    var genreOn = new Set(), tagOn = new Set(), terms = [];
    ${section('function sizePercent(', 'function startSizeDrag(')}
  `);
  return api;
}

test('CSV reimport preserves raw tags and manual ordering, and filters genres AND tags', () => {
  const { context, run } = catalog();
  context.csv = 'Title,Physical Location,Genre,Tags,Date Added\nFirst,A1,中國文史,"古典文學,文學研究,古典文學",1\nSecond,A1,Literature,古典文學,2\nThird,C1,中國文史,歷史＆考古,3';
  run(`importCsv(csv, 'test.csv'); S.orders.A1 = S.books.slice(0, 2).map(b => b.k).reverse(); S.orderAt.A1=1; importCsv(csv, 'test.csv'); derive();`);
  assert.equal(run('S.books.length'), 3);
  assert.equal(run('S.books[0].tags'), '古典文學,文學研究,古典文學');
  assert.equal(run(`tagCounts().get('古典文學')`), 2);
  assert.equal(run(`normalizeState(S).books[0].tags`), '古典文學,文學研究,古典文學');
  assert.equal(run('D.byShelf.get("A1")[0].title'), 'Second');
  run(`genreOn.add('中國文史'); tagOn.add('古典文學')`);
  assert.equal(run('S.books.filter(b => matches(b)).length'), 1);
  assert.equal(run('S.books.filter(b => matches(b))[0].title'), 'First');
  run(`tagOn.add('歷史＆考古')`);
  assert.equal(run('S.books.filter(b => matches(b)).length'), 2);
  assert.equal(run('S.books.filter(b => matches(b, true)).length'), 3);
});

test('cabinet width changes every shelf together and leaves other cabinets unchanged', () => {
  const { run } = catalog();
  run(`S.books=normalizeState({books:[{k:'one',title:'One',loc:'A1',pages:'300'}]}).books;rebuildIndex();derive();var before=geometry();setShelfSize('A2','width',150);var after=geometry();`);
  assert.equal(run('after.cols.A.shelves.A2'), run('Math.round(before.cols.A.shelves.A2 * 1.5)'));
  assert.equal(run('new Set(Object.values(after.cols.A.shelves)).size'),1);
  assert.equal(run('after.cols.B.w'),run('before.cols.B.w'));
  assert.equal(run('after.cols.C.w'),run('before.cols.C.w'));
  run(`setShelfSize('B1','width',70);resetSizes()`);
  assert.equal(run('geometry().cols.A.w'),run('before.cols.A.w'));
  assert.equal(run('normalizeState(S).settings.widths.B'),100);
  assert.equal(run('S.books[0].k'),'one');
});

test('width changes on different cabinets merge independently and resets propagate', () => {
  const { run } = core();
  run(`var a=blank(),b=blank();a.settings.widths.A=150;a.settings.widthAt.A=100;b.settings.widths.B=75;b.settings.widthAt.B=200;var merged=mergeStates(a,b);`);
  assert.equal(run('merged.settings.widths.A'),150);
  assert.equal(run('merged.settings.widths.B'),75);
  run(`b.settings.widths.A=100;b.settings.widthAt.A=300;merged=mergeStates(a,b)`);
  assert.equal(run('merged.settings.widths.A'),100);
  assert.equal(run('canon(mergeStates(a,b))===canon(mergeStates(b,a))'),true);
});

test('a newer CSV location overrides a pending move based on the old location', () => {
  const { run } = core();
  run(`var a=blank(),b=blank(),now=Date.now();a.books=[{k:'book',title:'Test',loc:'A1'}];a.meta={at:now-300};b.books=[{k:'book',title:'Test',loc:'C1'}];b.meta={at:now-100};a.moves.book={to:'A2',from:'A1',at:now-200};var merged=mergeStates(a,b);`);
  assert.equal(run('merged.books[0].loc'), 'C1');
  assert.equal(run('merged.moves.book'), undefined);
  assert.equal(run('merged.gone.book'), run('b.meta.at'));
  assert.equal(run('canon(mergeStates(a,b)) === canon(mergeStates(b,a))'), true);
  assert.equal(run('mergeStates(merged,a).moves.book'), undefined);
});

test('moves already applied in CSV or removed from the catalog do not reappear', () => {
  const { run } = core();
  run(`var a=blank(),b=blank(),now=Date.now();a.meta={at:now-300};b.meta={at:now-100};a.books=[{k:'done',title:'Done',loc:'A1'},{k:'deleted',title:'Deleted',loc:'A1'}];b.books=[{k:'done',title:'Done',loc:'C1'}];a.moves.done={to:'C1',from:'A1',at:now-200};a.moves.deleted={to:'A2',from:'A1',at:now-200};var merged=mergeStates(a,b);`);
  assert.equal(run('Object.keys(merged.moves).length'), 0);
});

test('valid pending moves survive unchanged CSV locations, invalid locations and newer moves', () => {
  const { run } = core();
  run(`var a=blank(),b=blank(),now=Date.now();a.meta={at:now-300};b.meta={at:now-100};a.books=[{k:'book',title:'Test',loc:'A1'}];b.books=[{k:'book',title:'Test',loc:'A1'}];a.moves.book={to:'A2',from:'A1',at:now-200};`);
  assert.equal(run('mergeStates(a,b).moves.book.to'), 'A2');
  run(`b.books[0].loc='C55'`);
  assert.equal(run('mergeStates(a,b).moves.book.to'), 'A2');
  run(`b.books[0].loc='C1';b.moves.book={to:'B1',from:'C1',at:now};`);
  assert.equal(run('mergeStates(a,b).moves.book.to'), 'B1');
});

test('edits made during upload stay dirty and are uploaded by the next sync', async () => {
  const { context, run } = core();
  let release, uploaded;
  context.DEVICE = 'Test';
  context.filePath = () => '/fake';
  context.ghError = () => new Error('fake HTTP error');
  context.syncError = () => new Error('fake sync error');
  context.applyState = () => { throw new Error('Unexpected remote state change'); };
  let scheduled = 0;
  context.schedulePush = () => scheduled++;
  context.gh = async (method, url, { body } = {}) => {
    if (method === 'PUT') {
      uploaded = JSON.parse(Buffer.from(body.content, 'base64').toString());
      if (!release) await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => ({ content: { sha: 'v1' } }) };
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ sha: 'v1' }) };
  };
  run(`
    ${section('const replacer =', "let saveError =")}
    ${section('async function pullOnce(', 'function applyState(')}
    var S=blank(),c={dirty:true,sha:null,etag:null},L={sync:c};S.books=[{k:'book',title:'Test',loc:'A1'}];S.meta={at:Date.now()};
  `);
  const pending = run('pushOnce(c)');
  run(`S.moves.book={to:'C1',from:'A1',at:Date.now()};c.dirty=true`);
  release();
  await pending;
  assert.equal(Object.keys(uploaded.state.moves).length, 0);
  assert.equal(run('c.dirty'), true);
  assert.equal(scheduled, 1);
  await run('pullOnce(c)');
  assert.equal(run('c.dirty'), true);
  await run('pushOnce(c)');
  assert.equal(uploaded.state.moves.book.to, 'C1');
  assert.equal(run('c.dirty'), false);
});

test('backup restoration preserves tags and cabinet widths and marks restored widths as newer', () => {
  const { context, run } = catalog();
  context.backupText = JSON.stringify({ app:'vshelf',state:{books:[{k:'test',title:'Test',loc:'A1',tags:'古典文學'}],settings:{widths:{A:75}}}});
  run('restore(backupText)');
  assert.equal(run('S.books[0].tags'),'古典文學');
  assert.equal(run('S.settings.widths.A'),75);
  assert.equal(run('S.settings.widthAt.A'),run('S.meta.at'));
  context.backupText=JSON.stringify({app:'vshelf',state:{books:[{k:'test',title:'Old backup',loc:'A1'}]}});
  run('restore(backupText)');
  assert.equal(run('S.settings.widths.A'),75);
  assert.equal(run('S.books[0].tags'),'');
});

test('moving a divider changes only its two neighboring layers and keeps all cabinet heights fixed', () => {
  const { run } = catalog();
  run(`derive();var before=geometry();setShelfSize('A2','height',150);var after=geometry();`);
  assert.equal(run('after.levels.get("A2").h'),1.5);
  assert.equal(run('after.levels.get("A3").h'),0.5);
  assert.equal(run('after.levels.get("A2").y'),run('before.levels.get("A2").y'));
  assert.equal(run('after.levels.get("A3").y'),2.5);
  for (const id of ['A1','A4','A5','A6','A7','B5','C3']) {
    assert.equal(run(`after.levels.get('${id}').y`),run(`before.levels.get('${id}').y`),id);
    assert.equal(run(`after.levels.get('${id}').h`),run(`before.levels.get('${id}').h`),id);
  }
  assert.equal(run('after.floorY'),run('before.floorY'));
  assert.equal(run('[...after.levels.values()].filter(s=>s.col==="A").every((s,i,all)=>!i || Math.abs(s.y-all[i-1].y-all[i-1].h)<1e-9)'),true);
});

test('drag percentage accounts for zoom and clamps both dimensions', () => {
  const { run } = catalog();
  assert.equal(run('sizePercent(100,100,1000,0.5)'), 120);
  assert.equal(run('sizePercent(150,-50,150,1)'), 117);
  assert.equal(run('sizePercent(100,-1000,150,0.5)'), 50);
  assert.equal(run('sizePercent(100,1000,150,0.5)'), 200);
});

test('divider layouts merge per cabinet and survive backups without changing outer heights', () => {
  const { context, run } = catalog();
  run(`var a=blank(),b=blank();setShelfSize('A2','height',150);a=normalizeState(S);setShelfSize('B1','height',120);b=normalizeState(S);delete b.settings.boards.A;delete b.settings.boardAt.A;var merged=mergeStates(a,b);`);
  assert.equal(run('merged.settings.boards.A.A2'),2.5);
  assert.equal(run('merged.settings.boards.B.B1'),0.9);
  assert.equal(run('canon(mergeStates(a,b))===canon(mergeStates(b,a))'),true);
  context.backupText=JSON.stringify({app:'vshelf',state:{books:[],settings:{boards:{A:{A2:2.25}}}}});
  run('restore(backupText)');
  assert.equal(run('S.settings.boards.A.A2'),2.25);
  assert.equal(run('S.settings.boardAt.A'),run('S.meta.at'));
  context.backupText=JSON.stringify({app:'vshelf',state:{books:[]}});
  run('restore(backupText)');
  assert.equal(run('S.settings.boards.A.A2'),2.25);
  assert.equal(run('cabinetLevels("A",S.settings).find(s=>s.id==="A7").y'),6);
});

test('size drag previews do not change saved state until release and cancellation discards them', () => {
  const { context, run } = catalog();
  context.performance = { now: () => 1234 };
  context.stage = { hasPointerCapture: () => false };
  context.document = { body: { classList: { remove() {} } } };
  context.schedulePush = () => {};
  run(`
    var sizeDrag, syncDeferred=false, suppressUntil=0;
    ${section('function updateSizeDrag(', "stage.addEventListener('keydown'")}
    function fakeDrag() {return {id:'A2',axis:'width',start:100,value:100,x:10,y:20,z:0.5,base:1000,pointerId:1,frame:{style:{},remove(){}},label:{}};}
    sizeDrag=fakeDrag();updateSizeDrag({clientX:110,clientY:20});
  `);
  assert.equal(run('sizeDrag.value'),120);
  assert.equal(run('S.settings.widths.A'),undefined);
  run('endSizeDrag(false)');
  assert.equal(run('S.settings.widths.A'),undefined);
  run('sizeDrag=fakeDrag();updateSizeDrag({clientX:110,clientY:20});endSizeDrag(true)');
  assert.equal(run('S.settings.widths.A'),120);
  assert.equal(run('sizeDrag'),null);
});

test('cloud sync waits while a shelf dimension is being dragged', async () => {
  const { run } = core();
  run(`var L={sync:{}},drag=null,sizeDrag={},syncDeferred=false;${section('async function doSync()', '// 同一时间只跑一个同步')}`);
  assert.equal(await run('doSync()'),'');
  assert.equal(run('syncDeferred'),true);
});

test('legacy per-layer widths migrate to the widest layer and height totals return to the fixed cabinet size', () => {
  const { run } = catalog();
  run(`S=normalizeState({books:[],settings:{widths:{A1:75,A2:125,B1:75,C1:50,C2:50,C3:50,C4:50,C5:50,C6:50,C7:50},widthAt:{A2:123},heights:{A2:150,A7:200,B5:175}}});derive();var g=geometry();`);
  assert.equal(run('S.settings.widths.A'),125);
  assert.equal(run('S.settings.widths.B'),100);
  assert.equal(run('S.settings.widths.C'),50);
  assert.equal(run('S.settings.widthAt.A'),123);
  assert.equal(run('Object.keys(S.settings.widths).length'),3);
  for (const col of ['A','B','C']) {
    assert.equal(run(`new Set(Object.values(g.cols.${col}.shelves)).size`),1);
    assert.ok(Math.abs(run(`cabinetLevels('${col}',S.settings).filter(s=>!s.top).reduce((n,s)=>n+s.h,0)`)-6)<1e-9);
  }
  assert.equal(run('g.levels.get("A7").y'),6);
  assert.equal(run('g.levels.get("A7").h'),1);
  assert.equal(run('canon(normalizeState(S))===canon(S)'),true);
});

test('dividers cannot cross their neighbors and the outer panels cannot be resized', () => {
  const { run } = catalog();
  run(`setShelfSize('A2','height',10000)`);
  assert.equal(run('shelfSize("A2","height")'),150);
  assert.equal(run('shelfSize("A3","height")'),50);
  run(`setShelfSize('A2','height',-10000)`);
  assert.equal(run('shelfSize("A2","height")'),50);
  run(`var before=canon(S.settings.boards);setShelfSize('A6','height',150);setShelfSize('A7','height',150);setShelfSize('B6','height',150)`);
  assert.equal(run('canon(S.settings.boards)'),run('before'));
  assert.equal(run('cabinetLevels("A",S.settings).find(s=>s.id==="A7").y'),6);
});

test('conflicting adjacent divider changes synchronize as one valid cabinet layout', () => {
  const { run } = catalog();
  run(`setShelfSize('A2','height',150);var a=normalizeState(S);S=blank();setShelfSize('A3','height',50);var b=normalizeState(S);b.settings.boardAt.A=a.settings.boardAt.A+1;var merged=mergeStates(a,b);`);
  assert.equal(run('canon(merged.settings.boards.A)'),run('canon(b.settings.boards.A)'));
  assert.equal(run('canon(mergeStates(a,b))===canon(mergeStates(b,a))'),true);
  assert.equal(run('cabinetLevels("A",merged.settings).find(s=>s.id==="A7").y'),6);
});

test('same CSV import recovers tags stripped by an older device, in either merge direction', () => {
  const { run } = core();
  run(`var old=normalizeState({books:[{k:'one',title:'One',loc:'A1'}],meta:{at:100}});var fresh=normalizeState({books:[{k:'one',title:'One',loc:'A1',tags:'古典文學'}],meta:{at:100}});`);
  assert.equal(run('mergeStates(old,fresh).books[0].tags'),'古典文學');
  assert.equal(run('mergeStates(fresh,old).books[0].tags'),'古典文學');
  assert.equal(run('canon(mergeStates(old,fresh))===canon(mergeStates(fresh,old))'),true);
  assert.equal(run('old.books[0].tags'),'');
});

test('newer CSV removal of a tag is not undone by an older tagged copy', () => {
  const { run } = core();
  run(`var fresh=normalizeState({books:[{k:'one',title:'One',loc:'A1',tags:''}],meta:{at:200}});var old=normalizeState({books:[{k:'one',title:'One',loc:'A1',tags:'古典文學'}],meta:{at:100}});`);
  assert.equal(run('mergeStates(old,fresh).books[0].tags'),'');
  assert.equal(run('mergeStates(fresh,old).books[0].tags'),'');
});

test('upgrade drops old cached SHA and ETag so cloud fields can be downloaded again', () => {
  const { context, run } = core();
  const stored={sync:{repo:'owner/test',token:'test-only',sha:'old-sha',etag:'old-etag',dirty:true}};
  context.localStorage={getItem:()=>JSON.stringify(stored)};
  run(section('function loadLocal()', 'function saveLocal()'));
  assert.equal(run('loadLocal().sync.sha'),null);
  assert.equal(run('loadLocal().sync.etag'),null);
  assert.equal(run('loadLocal().sync.dirty'),true);
  assert.equal(run('loadLocal().sync.cacheVersion'),run('SYNC_CACHE_VERSION'));
  stored.sync.cacheVersion=run('SYNC_CACHE_VERSION');
  assert.equal(run('loadLocal().sync.sha'),'old-sha');
  assert.equal(run('loadLocal().sync.etag'),'old-etag');
});

test('upgraded client downloads identical cloud SHA and applies missing tags from the same CSV', async () => {
  const { context, run } = core();
  const stored={sync:{repo:'owner/test',token:'test-only',sha:'same-sha',etag:'old-etag'}};
  context.localStorage={getItem:()=>JSON.stringify(stored)};
  context.filePath=()=>'/fake';context.syncError=()=>new Error('fake');context.ghError=()=>new Error('fake');
  let applied=false,conditional;
  context.applyState=next=>{context.recovered=next;applied=true;};
  const remote={app:'vshelf',state:{books:[{k:'one',title:'One',loc:'A1',tags:'古典文學'}],meta:{at:100}}};
  context.gh=async(method,url,options)=>{conditional=options.etag;return {status:200,ok:true,headers:{get:()=>null},json:async()=>({sha:'same-sha',encoding:'base64',content:Buffer.from(JSON.stringify(remote)).toString('base64')})};};
  run(`${section('function loadLocal()', 'function saveLocal()')} ${section('async function pullOnce(', '// 上传本机数据；')} var S=normalizeState({books:[{k:'one',title:'One',loc:'A1'}],meta:{at:100}});var c=loadLocal().sync;`);
  await run('pullOnce(c)');
  assert.equal(conditional,null);
  assert.equal(applied,true);
  assert.equal(context.recovered.books[0].tags,'古典文學');
  assert.equal(run('c.sha'),'same-sha');
  assert.equal(run('c.dirty'),false);
});
