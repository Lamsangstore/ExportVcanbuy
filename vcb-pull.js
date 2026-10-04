// ═══════════════════════════════════════════════════════════
// ดึงข้อมูลจาก VCANBUY → ส่งเข้าแอป VCANBUY Data Processor
// โหลดผ่านปุ่ม bookmark (bookmarklet) ขณะเปิด www.vcanbuy.com ที่ล็อกอินอยู่
//   1) อ่านบิลขนส่ง (TOUT…) จากหน้า "พัสดุของฉัน" › กล่องชำระเงินแล้ว
//   2) ให้เลือกบิล → ดึงหน้ารายละเอียดทุกออเดอร์ในบิลนั้น
//   3) เปิดแอปแล้วส่งข้อมูล (ออเดอร์ + กล่องพัสดุ) ให้ผ่าน postMessage
// ═══════════════════════════════════════════════════════════
(function(){
  // แอปปลายทาง = โดเมนที่โหลดสคริปต์นี้มา (window.__VCB_APP_ORIGIN ใช้ตอนทดสอบในเครื่อง)
  const APP_ORIGIN=window.__VCB_APP_ORIGIN||(()=>{
    try{ return new URL(document.currentScript.src).origin; }catch{ return 'https://vcanbuy.lamsangstore.com'; }
  })();
  if(!/(^|\.)vcanbuy\.com$/.test(location.hostname)){
    alert('กดปุ่มนี้ขณะเปิดเว็บ www.vcanbuy.com (ล็อกอินแล้ว)');
    return;
  }
  if(window.__vcbPullOpen) return;
  window.__vcbPullOpen=true;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // ── UI ──
  const ov=document.createElement('div');
  ov.id='vcb-pull';
  ov.innerHTML=`<style>
    #vcb-pull{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;font:14px/1.5 'Noto Sans Thai',system-ui,-apple-system,sans-serif;}
    #vcb-pull .box{background:#fff;color:#0f172a;border-radius:14px;width:min(620px,94vw);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);}
    #vcb-pull .hd{padding:16px 20px;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:16px;display:flex;justify-content:space-between;align-items:center;}
    #vcb-pull .bd{padding:12px 20px;overflow:auto;flex:1;}
    #vcb-pull .ft{padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;gap:8px;align-items:center;}
    #vcb-pull label.bill{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;cursor:pointer;}
    #vcb-pull label.bill:hover{background:#f1f5f9;}
    #vcb-pull .mono{font-family:ui-monospace,Menlo,monospace;font-weight:700;}
    #vcb-pull small{color:#64748b;}
    #vcb-pull button{border:0;border-radius:8px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer;}
    #vcb-pull .go{background:#a8853f;color:#fff;}
    #vcb-pull .go:disabled{opacity:.5;cursor:default;}
    #vcb-pull .sec{background:#f1f5f9;color:#334155;}
    #vcb-pull .x{background:none;font-size:20px;padding:0 4px;color:#64748b;}
    #vcb-pull .msg{color:#64748b;font-size:13px;flex:1;}
    #vcb-pull .err{color:#dc2626;}
  </style>
  <div class="box">
    <div class="hd"><span>📦 ดึงข้อมูลเข้าแอป VCANBUY</span><button class="x" data-act="close">✕</button></div>
    <div class="bd"><div class="msg">กำลังโหลดรายการบิลขนส่ง…</div></div>
    <div class="ft"><span class="msg" id="vcb-pull-msg"></span>
      <button class="sec" data-act="more" style="display:none;">โหลดหน้าถัดไป</button>
      <button class="go" data-act="go" disabled>ดึงข้อมูล → เปิดแอป</button></div>
  </div>`;
  document.body.appendChild(ov);
  const bd=ov.querySelector('.bd'), msg=ov.querySelector('#vcb-pull-msg');
  const btnGo=ov.querySelector('[data-act=go]'), btnMore=ov.querySelector('[data-act=more]');
  const close=()=>{ ov.remove(); frame?.remove(); window.__vcbPullOpen=false; };
  const setMsg=(t,err)=>{ msg.textContent=t; msg.className='msg'+(err?' err':''); };

  // ── อ่านหน้า "พัสดุของฉัน" › กล่องชำระเงินแล้ว ใน iframe ที่มองไม่เห็น (โหลดด้วย ajax ของเว็บเอง) ──
  let frame=null, page=1;
  const bills=[];          // [{bill,date,total,orders:[],text}]
  async function loadFrame(){
    frame=document.createElement('iframe');
    frame.style.cssText='position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;';
    frame.src='/warehouse.php';
    document.body.appendChild(frame);
    await new Promise((res,rej)=>{ frame.onload=res; setTimeout(()=>rej(new Error('โหลดหน้าพัสดุไม่สำเร็จ')),30000); });
    const doc=frame.contentDocument;
    const tab=doc.querySelector('a[href="#menu3"]');
    if(!tab) throw new Error('ไม่พบแท็บ "กล่องชำระเงินแล้ว" — ล็อกอิน Vcanbuy แล้วหรือยัง?');
    tab.click();
    await waitBills('');
  }
  const pane=()=>frame.contentDocument.querySelector('#menu3');
  async function waitBills(prevFirst){
    for(let i=0;i<60;i++){
      await sleep(500);
      const t=pane()?.innerText||'';
      const first=(t.match(/TOUT[A-Z0-9]+/)||[])[0]||'';
      if(first&&first!==prevFirst) return;
      if(i>6&&/ไม่พบข้อมูล/.test(t)) return;
    }
    throw new Error('รอข้อมูลบิลนานเกินไป');
  }
  function readBills(){
    const t=pane().innerText;
    const blocks=t.split(/(?=เลขบิลขนส่ง[:\s]*TOUT)/).filter(b=>/^เลขบิลขนส่ง/.test(b));
    let added=0;
    for(const blk of blocks){
      const bill=(blk.match(/TOUT[A-Z0-9]+/)||[])[0];
      if(!bill||bills.some(b=>b.bill===bill)) continue;
      const date=(blk.match(/วันที่เปิดออเดอร์[:\s]*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/)||[])[1]||'';
      const tot=(blk.match(/ทั้งหมด\s*:\s*฿\s*([\d,]+\.?\d*)/)||[])[1]||'';
      const orders=[...new Set([...blk.matchAll(/ออเดอร์\s+(XLY[A-Z0-9]+)/g)].map(m=>m[1]))];
      const boxIds=[...new Set([...blk.matchAll(/กล่อง\s+(CX[A-Z0-9]+)/g)].map(m=>m[1]))];
      // ตัดที่อยู่จัดส่งออก — ไม่ต้องส่งเข้าแอป
      const text=blk.replace(/^ที่อยู่จัดส่ง.*$/m,'').trim();
      bills.push({bill,date,total:tot,orders,boxIds,text});
      added++;
    }
    return added;
  }
  function renderList(){
    bd.innerHTML=bills.length?bills.map((b,i)=>`<label class="bill">
        <input type="checkbox" value="${i}" ${i===0?'checked':''}>
        <div><div class="mono">${esc(b.bill)}</div>
        <small>เปิดบิล ${esc(b.date)} · ${b.orders.length} ออเดอร์ · ยอดบิล ฿${esc(b.total)}</small><br>
        <small>${b.orders.map(esc).join(', ')}</small></div></label>`).join('')
      :'<div class="msg">ไม่พบบิลขนส่งที่ชำระเงินแล้ว</div>';
    btnGo.disabled=!bills.length;
    const pages=[...pane().querySelectorAll('a')].map(a=>a.textContent.trim()).filter(t=>/^\d+$/.test(t)).map(Number);
    btnMore.style.display=pages.some(p=>p>page)?'':'none';
    setMsg(`${bills.length} บิล (หน้า 1–${page}) — เลือกบิลที่ต้องการ`);
  }
  // โหลดหน้าถัดไปของรายการบิล — false = ไม่มีหน้าถัดไปแล้ว
  async function loadNextPage(){
    const next=[...pane().querySelectorAll('a')].find(a=>a.textContent.trim()===String(page+1));
    if(!next) return false;
    const prevFirst=(pane().innerText.match(/TOUT[A-Z0-9]+/)||[])[0]||'';
    next.click();
    await waitBills(prevFirst);
    page++;
    readBills();
    return true;
  }
  async function loadMore(){
    btnMore.disabled=true; setMsg('กำลังโหลดหน้าถัดไป…');
    try{ await loadNextPage(); }catch(e){ setMsg(e.message,true); }
    const checked=[...bd.querySelectorAll('input:checked')].map(x=>x.value);
    renderList();
    bd.querySelectorAll('input').forEach(x=>{ x.checked=checked.includes(x.value); });
    btnMore.disabled=false;
  }

  // ── ดึงหน้ารายละเอียดออเดอร์ (ข้อความเหมือน copy จากหน้าเว็บ) ──
  // หน้ารายการคำสั่งซื้อ (ค้นด้วยเลขออเดอร์) → id หน้ารายละเอียด + ชื่อสินค้าแต่ละรายการ
  async function listInfo(orderNo){
    const h=await fetch('/order.php?sdocno='+encodeURIComponent(orderNo),{credentials:'include'}).then(r=>r.text());
    const m=h.match(/order_detail\.php\?id=(\d+)/);
    if(!m) throw new Error('ไม่พบออเดอร์ '+orderNo);
    const d=new DOMParser().parseFromString(h,'text/html');
    const rows=[...d.querySelectorAll('tr')].filter(tr=>tr.querySelector('.order-sku'));
    const items=rows.map(tr=>({
      title:(tr.querySelector('.order-name')?.textContent||'').trim(),
      spec:(tr.querySelector('.order-sku')?.textContent||'').trim()
    }));
    return {id:m[1],items};
  }
  const normSpec=s=>String(s||'').replace(/\s+/g,'').replace(/,+$/,'');
  // ลิงก์สินค้าต้นทาง → รหัสสินค้า (1688 offer / taobao / tmall id)
  function offerOf(href){
    try{
      const u=new URL(href,location.href);
      const m=u.pathname.match(/\/offer\/(\d+)/);
      if(/1688\.com$/.test(u.hostname)&&m) return m[1];
      const id=u.searchParams.get('id');
      if(/(taobao|tmall)\.com$/.test(u.hostname)&&id) return (u.hostname.includes('tmall')?'tm':'tb')+id;
    }catch{}
    return '';
  }
  // ดึงหน้ารายละเอียดออเดอร์ (ข้อความเหมือน copy จากหน้าเว็บ) + แทรกบรรทัด @vcb ข้อมูลสินค้าหลัง "1." "2." …
  async function orderText(orderNo){
    const L=await listInfo(orderNo);
    const h=await fetch('/order_detail.php?id='+L.id,{credentials:'include'}).then(r=>r.text());
    const d=new DOMParser().parseFromString(h,'text/html');
    const main=d.querySelector('main')||d.body;
    main.querySelectorAll('script,style,noscript,svg').forEach(e=>e.remove());
    // render นอกจอเพื่อให้ innerText ได้ tab/ขึ้นบรรทัดเหมือน copy จากหน้าเว็บจริง
    const holder=document.createElement('div');
    holder.style.cssText='position:fixed;left:-20000px;top:0;width:1280px;';
    holder.appendChild(document.importNode(main,true));
    document.body.appendChild(holder);
    // ข้อมูลสินค้าต่อรายการ: ลิงก์ 1688 + รูป (อยู่ในแถวเดียวกับเลขรายการ "N.")
    const metas={};
    holder.querySelectorAll('a[href]').forEach(a=>{
      const offer=offerOf(a.getAttribute('href'));
      if(!offer) return;
      let row=a;
      for(let k=0;k<10&&row;k++){ row=row.parentElement; if(row&&/^\s*\d+\.\s*$/m.test(row.innerText)) break; }
      const num=(row?.innerText.match(/^\s*(\d+)\.\s*$/m)||[])[1];
      if(!num||metas[num]) return;
      const img=a.querySelector('img')||row.querySelector('img');
      let src='';
      try{ const u=new URL(img?.getAttribute('src')||'',location.href); if(/^https?:$/.test(u.protocol)&&!/vcanbuy\.com$/.test(u.hostname)) src=u.origin+u.pathname; }catch{}
      metas[num]={offer,img:src};
    });
    let t=holder.innerText;
    holder.remove();
    const i=t.indexOf('เลขที่ออเดอร์:');
    if(i<0) throw new Error('อ่านรายละเอียดออเดอร์ '+orderNo+' ไม่ได้');
    t=t.slice(i).replace(/[  ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    if(!t.includes(orderNo)) throw new Error('ข้อมูลออเดอร์ไม่ตรง '+orderNo);
    // ชื่อสินค้าจากหน้ารายการ — จับคู่ตามลำดับ ตรวจด้วยสเปก (ถ้าไม่ตรงลำดับ หาจากสเปก)
    const lines=t.split('\n');
    const out=[];
    for(let k=0;k<lines.length;k++){
      out.push(lines[k]);
      const mNum=lines[k].trim().match(/^(\d+)\.$/);
      if(!mNum) continue;
      const n=+mNum[1];
      const spec=(lines.slice(k+1).find(x=>x.trim())||'').trim();
      let li=L.items[n-1];
      if(!li||normSpec(li.spec)!==normSpec(spec)) li=L.items.find(x=>normSpec(x.spec)===normSpec(spec))||li;
      const meta={offer:metas[n]?.offer||'',title:li?.title||'',img:metas[n]?.img||''};
      if(meta.offer||meta.title) out.push('@vcb '+JSON.stringify(meta));
    }
    t=out.join('\n');
    const boxLine=(t.match(/เลขกล่องพัสดุ[^\n]*/)||[''])[0];
    return {text:t,boxIds:[...new Set([...boxLine.matchAll(/\b(CX[A-Z0-9]+)/g)].map(m=>m[1]))]};
  }

  async function go(){
    let sel=[...bd.querySelectorAll('input:checked')].map(x=>bills[+x.value]);
    if(!sel.length){ setMsg('เลือกอย่างน้อย 1 บิล',true); return; }
    btnGo.disabled=true; btnMore.disabled=true;
    // เปิดแอปทันที (ต้องอยู่ใน click handler ไม่งั้น popup ถูกบล็อก)
    const app=window.open(APP_ORIGIN+'/#vcb-import','vcb_app');
    if(!app){ setMsg('Browser บล็อก popup — อนุญาต popup ของ vcanbuy.com แล้วกดใหม่',true); btnGo.disabled=false; return; }
    try{
      // ออเดอร์เดียวอาจมีกล่อง CX มาหลายรอบ (คนละบิล) → ดึงบิลที่เกี่ยวข้องมาด้วยให้ครบ
      const picked=new Set(sel);
      const details=new Map();       // orderNo → {text, boxIds}
      let extraPages=0;
      for(;;){
        // 1) บิลที่มีออเดอร์เดียวกับบิลที่เลือก
        for(let grew=true;grew;){
          grew=false;
          const ords=new Set([...picked].flatMap(b=>b.orders));
          for(const b of bills) if(!picked.has(b)&&b.orders.some(o=>ords.has(o))){ picked.add(b); grew=true; }
        }
        // 2) ดึงรายละเอียดออเดอร์ที่ยังไม่มี
        const orderNos=[...new Set([...picked].flatMap(b=>b.orders))];
        for(const o of orderNos){
          if(details.has(o)) continue;
          setMsg(`กำลังดึงออเดอร์ ${details.size+1}/${orderNos.length} — ${o}`);
          details.set(o,await orderText(o));
        }
        // 3) กล่องที่หน้าออเดอร์บอกว่ามี แต่ยังไม่อยู่ในบิลที่เลือก
        const inPicked=new Set([...picked].flatMap(b=>b.boxIds));
        const missing=[...details.values()].flatMap(d=>d.boxIds).filter(cx=>!inPicked.has(cx));
        if(!missing.length) break;
        const more=bills.filter(b=>!picked.has(b)&&b.boxIds.some(cx=>missing.includes(cx)));
        if(more.length){ more.forEach(b=>picked.add(b)); continue; }
        // ยังไม่เจอ → ค้นหน้าบิลที่เก่ากว่า (สูงสุด 5 หน้า) · ถ้ายังไม่เจอ = กล่องยังไม่ถึงไทย แอปจะเตือนเอง
        if(extraPages>=5) break;
        setMsg(`หากล่องที่เหลือ (${missing.length} กล่อง) ในหน้าถัดไป…`);
        if(!await loadNextPage()) break;
        extraPages++;
      }
      sel=[...picked].sort((a,b)=>a.date.localeCompare(b.date));
      const orderNos=[...details.keys()];
      const texts=orderNos.map(o=>details.get(o).text);
      const payload={
        type:'vcb-import', v:1,
        bills:sel.map(b=>({bill:b.bill,date:b.date,total:b.total,orders:b.orders})),
        orders:texts.join('\n\n'),
        boxes:sel.map(b=>b.text).join('\n\n')
      };
      setMsg('กำลังส่งเข้าแอป…');
      await sendToApp(app,payload);
      setMsg(`✅ ส่ง ${sel.length} บิล / ${orderNos.length} ออเดอร์ เข้าแอปแล้ว`);
      setTimeout(close,1500);
    }catch(e){
      setMsg('❌ '+e.message,true);
      btnGo.disabled=false; btnMore.disabled=false;
    }
  }
  // รอแอปพร้อม (แอปส่ง vcb-ready มา) แล้วส่งข้อมูล — รอ ack กลับ
  function sendToApp(app,payload){
    return new Promise((res,rej)=>{
      let done=false;
      const onMsg=e=>{
        if(e.origin!==APP_ORIGIN||e.source!==app) return;
        if(e.data?.type==='vcb-ready') app.postMessage(payload,APP_ORIGIN);
        if(e.data?.type==='vcb-import-ok'){ done=true; window.removeEventListener('message',onMsg); res(); }
        if(e.data?.type==='vcb-import-cancel'){ done=true; window.removeEventListener('message',onMsg); rej(new Error('ยกเลิกในแอป')); }
      };
      window.addEventListener('message',onMsg);
      // เผื่อแอปพร้อมก่อนเราฟัง — ถามซ้ำเป็นระยะ
      const ping=setInterval(()=>{ if(done) return clearInterval(ping); try{ app.postMessage({type:'vcb-ping'},APP_ORIGIN); }catch{} },700);
      setTimeout(()=>{ if(!done){ clearInterval(ping); window.removeEventListener('message',onMsg); rej(new Error('แอปไม่ตอบกลับ — ลองใหม่อีกครั้ง')); } },120000);
    });
  }

  ov.addEventListener('click',e=>{
    const act=e.target.closest('[data-act]')?.dataset.act;
    if(act==='close') close();
    if(act==='go') go();
    if(act==='more') loadMore();
  });

  (async()=>{
    try{
      await loadFrame();
      readBills();
      renderList();
    }catch(e){
      bd.innerHTML=`<div class="msg err">❌ ${esc(e.message)}</div>`;
    }
  })();
})();
