// End-to-end test for the handbook's demo-media behaviour, in a real browser.
//
// Guards the three things that are easy to regress and invisible in review:
//   1. a demo tile loads its POSTER, never the multi-megabyte original;
//   2. the animation is fetched only once the tile is genuinely on screen —
//      pages are pre-built one either side of the current one, so "built" must
//      not mean "downloaded";
//   3. tapping a tile opens the fullscreen viewer, and the page-turn gestures
//      still work afterwards.
//
// (3) exists because the stage used to call setPointerCapture on every
// pointerdown, which retargets the follow-up click to the stage itself and
// silently killed every button and link inside a program page. Only a real
// pointer click reproduces it — a synthetic .click() passes regardless — so
// this test drives the mouse rather than dispatching events.
//
//   cd tools && npm install && node test-handbook-media.js
const fs=require("fs"),path=require("path"),http=require("http");
const puppeteer=require("puppeteer-core");
const ROOT=path.join(__dirname,"..");
// Chrome comes from the puppeteer cache rather than being downloaded here;
// puppeteer-core deliberately ships no browser.
const CHROME=process.env.CHROME_PATH||(function(){
  const base=path.join(process.env.HOME||"/root",".cache/puppeteer/chrome");
  const dirs=fs.existsSync(base)?fs.readdirSync(base).sort():[];
  if(!dirs.length)throw new Error("No Chrome in "+base+" — set CHROME_PATH.");
  return path.join(base,dirs[dirs.length-1],"chrome-linux64","chrome");})();
const PIXEL=Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64");
const reqs=[];
const PAYLOAD={name:"T",trainingContent:{weeks:[{title:"W1",days:[{title:"D1",exercises:[
 {name:"Goblet Squat",mediaUrl:"/api/library/media/p1/demo-a.gif",mediaType:"image"},
 {name:"Deadlift",mediaUrl:"/api/library/media/p1/demo-b.gif",mediaType:"image"}]}]}]}};
const HARNESS=`<!doctype html><html><head>
<link rel="stylesheet" href="/assets/css/program-viewer.css">
<link rel="stylesheet" href="/assets/css/program-media.css"></head><body>
<script src="/assets/js/program-media.js"></script>
<script src="/assets/js/program-viewer.js"></script>
<script>window.__P=${JSON.stringify(PAYLOAD)};window.ProgramViewer.open(window.__P,{});</script></body></html>`;
const server=http.createServer((req,res)=>{const u=req.url.split("?")[0];
  if(u.startsWith("/api/library/media/")){reqs.push(req.url);
    res.writeHead(200,{"Content-Type":"image/gif"});return res.end(PIXEL);}
  const l=path.join(ROOT,u);
  if(u!=="/"&&fs.existsSync(l)){const e=path.extname(l);
    res.writeHead(200,{"Content-Type":e===".js"?"text/javascript; charset=utf-8":e===".css"?"text/css; charset=utf-8":"text/html; charset=utf-8"});
    return res.end(fs.readFileSync(l));}
  res.writeHead(200,{"Content-Type":"text/html"});res.end(HARNESS);});
const results=[];
function check(name,pass,detail){results.push({name,pass,detail});}
(async()=>{
await new Promise(r=>server.listen(3402,r));
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const p=await b.newPage();
await p.emulateMediaFeatures([{name:"prefers-reduced-motion",value:"no-preference"}]);
await p.setViewport({width:900,height:800});
const errs=[];p.on("pageerror",e=>errs.push(String(e)));
await p.goto("http://localhost:3402/",{waitUntil:"networkidle0"});
await new Promise(r=>setTimeout(r,500));

check("no JS errors",errs.length===0,errs);
check("original full-size GIF never requested",!reqs.some(r=>!/variant=/.test(r)),reqs.filter(r=>!/variant=/.test(r)));
check("posters requested on load",reqs.filter(r=>/variant=poster/.test(r)).length===2,reqs.slice());
check("animation NOT fetched while page off-screen",!reqs.some(r=>/variant=anim/.test(r)),reqs.slice());

// Navigate until the first demo tile is fully inside the viewport.
for(let i=0;i<8;i++){
  const on=await p.evaluate(()=>{const b=document.querySelector("[data-pv-media]");if(!b)return false;
    const r=b.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=window.innerWidth;});
  if(on)break; await p.click("[data-pv-next]"); await new Promise(r=>setTimeout(r,450));
}
await p.waitForFunction(()=>/variant=anim/.test(document.querySelector("[data-pv-media] img").getAttribute("src")),{timeout:6000}).catch(()=>{});
const src=await p.evaluate(()=>document.querySelector("[data-pv-media] img").getAttribute("src"));
check("swaps to animation once visible",/variant=anim/.test(src),src);

await p.evaluate(()=>{window.__hits=[];
  const btn=document.querySelector("[data-pv-media]");
  btn.addEventListener("click",()=>window.__hits.push("button-click"));
  document.addEventListener("click",e=>window.__hits.push("doc-click target="+e.target.className),true);
  document.addEventListener("pointerup",e=>window.__hits.push("pointerup target="+e.target.className),true);});
await p.click("[data-pv-media]");
await new Promise(r=>setTimeout(r,600));
const lb=await p.evaluate(()=>{const el=document.querySelector(".pm");
  return {open:!!el, slides:el?el.querySelectorAll(".pm-slide").length:0,
          bodyLocked:document.body.classList.contains("pm-open")};});
check("click opens fullscreen viewer",lb.open,lb);
check("viewer holds the whole day as a gallery",lb.slides===2,lb);
check("body scroll locked while open",lb.bodyLocked,lb);

// Arrows must drive the media gallery, NOT the handbook page behind it.
const pageBefore=await p.evaluate(()=>document.querySelector("[data-pv-count]").textContent);
await p.keyboard.press("ArrowRight"); await new Promise(r=>setTimeout(r,350));
const afterArrow=await p.evaluate(()=>({page:document.querySelector("[data-pv-count]").textContent,
  pmOpen:!!document.querySelector(".pm")}));
check("arrows don't turn the page behind the viewer",afterArrow.page===pageBefore,{pageBefore,afterArrow});

await p.keyboard.press("Escape"); await new Promise(r=>setTimeout(r,450));
const afterEsc=await p.evaluate(()=>({pm:!!document.querySelector(".pm"),pv:!!document.querySelector(".pv")}));
check("Escape closes the media viewer",!afterEsc.pm,afterEsc);
check("Escape leaves the handbook open underneath",afterEsc.pv,afterEsc);

// --- regression: the page-turn gesture itself must still work ---
await new Promise(r=>setTimeout(r,300));
for(let i=0;i<8;i++){
  const on=await p.evaluate(()=>{const b=document.querySelector("[data-pv-media]");if(!b)return false;
    const r=b.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=window.innerWidth;});
  if(on)break; await p.click("[data-pv-next]"); await new Promise(r=>setTimeout(r,450));}
const idxBefore=await p.evaluate(()=>document.querySelector("[data-pv-count]").textContent);
// Drag right-to-left well clear of any tile -> next page.
const st=await p.evaluate(()=>{const r=document.querySelector(".pv__stage").getBoundingClientRect();
  return {cy:r.y+r.height-60,x1:r.x+80,x2:r.x+r.width-80};});
await p.mouse.move(st.x1,st.cy); await p.mouse.down();
for(let i=1;i<=10;i++){await p.mouse.move(st.x1+(st.x2-st.x1)*i/10,st.cy);await new Promise(r=>setTimeout(r,16));}
await p.mouse.up(); await new Promise(r=>setTimeout(r,700));
const idxAfter=await p.evaluate(()=>document.querySelector("[data-pv-count]").textContent);
check("swipe (backward) still turns the page",idxBefore!==idxAfter,{before:idxBefore,after:idxAfter});

// Tap in the right-hand quarter (non-interactive) -> next page.
const before2=await p.evaluate(()=>document.querySelector("[data-pv-count]").textContent);
const st2=await p.evaluate(()=>{const r=document.querySelector(".pv__stage").getBoundingClientRect();
  return {x:r.x+r.width*0.92,y:r.y+r.height-50};});
await p.mouse.click(st2.x,st2.y); await new Promise(r=>setTimeout(r,700));
const after2=await p.evaluate(()=>document.querySelector("[data-pv-count]").textContent);
check("tap-to-turn (right quarter) still works",before2!==after2,{before:before2,after:after2});

let bad=0;
for(const r of results){ if(!r.pass)bad++;
  console.log((r.pass?"  PASS  ":"  FAIL  ")+r.name+(r.pass?"":"  -> "+JSON.stringify(r.detail))); }
console.log("\nrequests made: "+reqs.length);reqs.forEach(r=>console.log("  "+r));
console.log(bad?`\n${bad} FAILED`:"\nALL PASSED");
await b.close();server.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
