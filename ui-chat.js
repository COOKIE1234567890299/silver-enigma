// ===== ui-chat.js =====
// 表情包/颜文字 / 特殊消息渲染(语音条/卡片/转账) / 气泡渲染 / 消息选择模式 / 聊天线程渲染 / 导出长图
// =======================

const icoSpeak='<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
const icoRedo='<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>';
const icoCopy='<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const icoEdit='<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
const icoDel='<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/></svg>';
function avEl(kind){const r=curRole(),u=curUser();const e=document.createElement('div');e.className='m-av'+(kind==='user'?' ume':'');const src=kind==='ai'?(r?r.avatar:''):u.avatar,fb=kind==='ai'?(r?r.roleName:'?'):u.userName;if(src){e.style.backgroundImage=`url(${src})`;e.style.backgroundSize='cover';e.style.backgroundPosition='center';e.style.backgroundRepeat='no-repeat'}else e.textContent=(fb||'?').charAt(0).toUpperCase();const shape=kind==='ai'?(r&&r.avShape):(u&&u.avShape);e.style.borderRadius=shape==='square'?'13px':'50%';return e}
function makeAct(label,ico,fn){const b=document.createElement('button');b.className='act';b.innerHTML=ico+label;b.onclick=fn;return b}

function greetingList(){const r=curRole();if(!r)return[];if(Array.isArray(r.greetings))return r.greetings.map(s=>(s||'').trim()).filter(Boolean);if(r.greeting)return r.greeting.split(/\n+/).map(s=>s.trim()).filter(Boolean);return[]}
function ensureGreeting(){
  const c=chat();if(c.length)return;
  const gs=greetingList();if(!gs.length)return;
  if(gs.length===1){c.push({role:'assistant',content:gs[0],greet:true,t:Date.now()});save()}
  else{openGreetPicker(gs)}
}
function openGreetPicker(gs, replaceIdx = null){
  const box=$('greetList');box.innerHTML='';
  gs.forEach(g=>{const it=document.createElement('div');it.className='pick-item';it.textContent=g;it.onclick=()=>{
    if(replaceIdx !== null && replaceIdx >= 0 && replaceIdx < chat().length){
      chat()[replaceIdx].content=g;chat()[replaceIdx].t=Date.now();
    } else {
      chat().push({role:'assistant',content:g,greet:true,t:Date.now()});
    }
    save();closeGreet();renderThread()
  };box.append(it)});
  $('pickScrim').classList.add('show');$('greetPicker').classList.add('show');
}
function closeGreet(){$('greetPicker').classList.remove('show');$('pickScrim').classList.remove('show')}
$('greetClose').onclick=closeGreet;

const voiceCache={};
const voiceCacheKeys=[]; // 内存泄漏修复：记录最多 20 条，超出的清理

function isSpecialPart(p){return /^\{\{(voice|card|img|transfer|transfer_accept|transfer_refund|location|gift):/.test(p.trim())||/\u0003PAT:/.test(p)||/^\u0004NARR:/.test(p)}
function renderVoiceBar(container,phrase,side){
  const bar=document.createElement('div');bar.className='voicebar';
  const ico=document.createElement('div');ico.className='vico';ico.innerHTML=icoSpeak;
  const bars=document.createElement('div');bars.className='vbars';
  const dur=Math.max(1,Math.min(60,Math.round(phrase.length/3)));
  for(let i=0;i<10;i++){const ii=document.createElement('i');ii.style.height=(5+Math.abs(Math.sin(i*1.3))*11)+'px';bars.append(ii)}
  const d=document.createElement('span');d.className='vdur';d.textContent=dur+'″';
  bar.append(ico,bars,d);
  bar.onclick=()=>playVoiceBar(phrase,bar);
  container.append(bar);
}
async function playVoiceBar(phrase,bar){
  const v=curVoice();
  if(!v.key||!v.voice){toast('未配置语音引擎，去设置→语音填好',true);return}
  // 非 ElevenLabs v3 引擎会把 [语气] 逐字读出来，这里去掉
  const say=((v.engine||'')!=='elevenlabs')?String(phrase||'').replace(/\[[^\]]*\]/g,'').trim():phrase;
  if(voiceCache[say]){const au=new Audio(voiceCache[say]);bar.classList.add('playing');au.onended=()=>bar.classList.remove('playing');au.play();return}
  bar.classList.add('playing');
  try{
    let res;
    if(v.engine==='elevenlabs'){res=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}`,{method:'POST',headers:{'xi-api-key':v.key,'Content-Type':'application/json','Accept':'audio/mpeg'},body:JSON.stringify({text:say,model_id:v.model||'eleven_v3'})})}
    else{let base=v.engine==='openai'?'https://api.openai.com/v1':(v.base||'').replace(/\/$/,'');if(!base)throw new Error('请填语音 Base URL');res=await fetch(base+'/audio/speech',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+v.key},body:JSON.stringify({model:v.model||'tts-1',voice:v.voice,input:say})})}
    if(!res.ok)throw new Error('HTTP '+res.status);
    const blob=await res.blob();const url=URL.createObjectURL(blob);
    voiceCache[say]=url;
    voiceCacheKeys.push(say);
    // 释放最老的音频缓存内存
    if(voiceCacheKeys.length>20){
      const oldest=voiceCacheKeys.shift();
      if(voiceCache[oldest]){URL.revokeObjectURL(voiceCache[oldest]);delete voiceCache[oldest];}
    }
    const au=new Audio(url);au.onended=()=>bar.classList.remove('playing');au.play();
  }catch(e){bar.classList.remove('playing');toast('语音失败：'+e.message,true)}
}
function renderCardImg(container,content,loc,date){
  const card=document.createElement('div');card.className='memcard';
  if(loc){const l=document.createElement('div');l.className='mc-loc';l.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span></span>';l.querySelector('span').textContent=loc;card.append(l)}
  const body=document.createElement('div');body.className='mc-body';
  const ct=document.createElement('div');ct.className='mc-content';ct.textContent=content||'';
  const line=document.createElement('div');line.className='mc-line';
  body.append(ct,line);card.append(body);
  if(date){const d=document.createElement('div');d.className='mc-date';d.textContent=date;card.append(d)}
  container.append(card);
}
function renderPhotoCard(container,desc){
  const card=document.createElement('div');card.className='photocard';
  const top=document.createElement('div');top.className='pc-top';top.innerHTML='<svg class="pc-ph" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>';
  const cap=document.createElement('div');cap.className='pc-cap';cap.textContent=desc||'一张图片';
  card.append(top,cap);container.append(card);
}
function renderRealImg(container,url,caption){
  const card=document.createElement('div');card.className='photocard';
  const top=document.createElement('div');top.className='pc-top';top.style.padding='0';top.style.minHeight='0';
  const im=document.createElement('img');im.src=url;im.className='pc-real';im.alt='';im.onerror=()=>{top.innerHTML='<svg class="pc-ph" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>'};
  top.append(im);card.append(top);
  if(caption){const cap=document.createElement('div');cap.className='pc-cap';cap.textContent=caption;card.append(cap)}
  container.append(card);
}
function renderSpecialPart(col,p,side,msgIdx){
  let t=p.trim();let m;
  // 旁白
  if (/^\u0004NARR:/.test(p)) {
    const txt = p.slice(1).replace(/^NARR:/,'').replace(/\u0004$/,'').trim();
    const d = document.createElement('div'); d.className='sys-tip narr-tip';
    d.textContent = txt; col.append(d); return;
  }
  // 拍一拍提示（如果与其他消息混排时的兜底渲染）
  const patM=p.match(/\u0003PAT:([^\u0003]+)\u0003/);
  if(patM){
    const div=document.createElement('div');div.className='sys-msg';
    div.innerHTML=`<span class="sys-text">${patM[1].trim()}</span>`;
    col.append(div);return;
  }
  let zh='';const ti=t.indexOf('|||');
  if(ti>=0&&/\}\}\s*\|\|\|/.test(t)){zh=t.slice(ti+3).trim();t=t.slice(0,ti).trim()}
  const addZh=bw=>{if(zh){const z=document.createElement('div');z.className='trans';z.style.marginTop='5px';z.textContent=zh;bw.append(z)}};
  const grab=tag=>{const re=new RegExp('^\\{\\{'+tag+':([\\s\\S]*?)\\}\\}$');const mm=t.match(re);if(mm)return mm[1];const open=new RegExp('^\\{\\{'+tag+':([\\s\\S]*)$');const m2=t.match(open);if(m2)return m2[1].replace(/\}+\s*$/,'');return null};
  let v;
  if((v=grab('voice'))!=null){const phrase=v.trim()||'…';const cap=voiceCaption(phrase);const bw=document.createElement('div');bw.className='bubble-wrap';
    const box=document.createElement('div');box.className='voice-trans-box '+(side==='user'?'u':'a');
    renderVoiceBar(box,phrase,side);
    if(cap){const cp=document.createElement('div');cp.className='voice-cap';cp.textContent=cap;box.append(cp)}
    if(zh){const z=document.createElement('div');z.className='trans';z.textContent=zh;box.append(z)}
    bw.append(box);col.append(bw);return true}
  if((v=grab('card'))!=null){const segs=v.split('|');const content=(segs[0]||'').trim();const loc=(segs[1]||'').trim();const date=(segs[2]||'').trim();const bw=document.createElement('div');bw.className='bubble-wrap';renderCardImg(bw,content,loc,date);addZh(bw);col.append(bw);return true}
  if((v=grab('img'))!=null){const bar=v.indexOf('|');let head=(bar>=0?v.slice(0,bar):v).trim();let cap=(bar>=0?v.slice(bar+1):'').trim();const bw=document.createElement('div');bw.className='bubble-wrap';
    const isReal=/^(data:image|https?:\/\/)/.test(head);
    if(isReal)renderRealImg(bw,head,cap);
    else{const desc=cap||head||'一张图片';renderPhotoCard(bw,desc);}
    addZh(bw);col.append(bw);return true}
  if((v=grab('transfer_accept'))!=null){
    const bw=document.createElement('div');bw.className='bubble-wrap';const card=document.createElement('div');card.className='wx-transfer accepted';
    card.innerHTML='<div class="wt-top"><div class="wt-ic"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></div><div><div class="wt-amt">已收款 ¥ '+(v||'0')+'</div><div class="wt-to">微信转账</div></div><div class="wt-tag">已存入</div></div>';
    bw.append(card);addZh(bw);col.append(bw);return true;
  }
  if((v=grab('transfer_refund'))!=null){
    const bw=document.createElement('div');bw.className='bubble-wrap';const card=document.createElement('div');card.className='wx-transfer refunded';
    card.innerHTML='<div class="wt-top"><div class="wt-ic"><svg viewBox="0 0 24 24"><path d="M15 9l-6 6M9 9l6 6"/></svg></div><div><div class="wt-amt">已退还 ¥ '+(v||'0')+'</div><div class="wt-to">微信转账</div></div><div class="wt-tag">已退回</div></div>';
    bw.append(card);addZh(bw);col.append(bw);return true;
  }
  if((v=grab('transfer'))!=null){const segs=v.split('|');const amt=(segs[0]||'').trim();const note=(segs[1]||'').trim();const r=curRole(),u=curUser();const toName=side==='user'?(r?r.roleName||'对方':'对方'):(u.userName||'我');
    const bw=document.createElement('div');bw.className='bubble-wrap';const card=document.createElement('div');card.className='wx-transfer';
    // 用消息索引判断是否已处理（msgIdx 是原始消息在 chat() 里的位置）
    const ci=msgIdx!=null?msgIdx:chat().findIndex(m=>!m.hidden&&m.content&&m.content.includes('{{transfer:'+v));
    const alreadyHandled=ci>=0&&chat().slice(ci+1).some(m=>m._transferAmt===amt&&(m._transferAction==='收款'||m._transferAction==='拒收'));
    let footHtml='';
    if(!alreadyHandled){
      footHtml='<div class="wt-actions"><button class="wt-btn accept">收款</button><button class="wt-btn reject">拒收</button></div>';
    }else{
      footHtml='<div class="wt-foot"><span style="color:#4caf50">已处理</span></div>';
    }
    card.innerHTML='<div class="wt-top"><div class="wt-ic"><svg viewBox="0 0 24 24"><path d="M17 7L7 17M7 7h10v10"/></svg></div><div><div class="wt-amt">¥ '+(amt||'0')+'</div><div class="wt-to">转账给 '+toName+'</div></div><div class="wt-tag">转账</div></div>'+(note?'<div class="wt-note">'+note.replace(/</g,'&lt;')+'</div>':'')+footHtml;
    if(!alreadyHandled){
      const acceptBtn=card.querySelector('.wt-btn.accept');
      const rejectBtn=card.querySelector('.wt-btn.reject');
      if(acceptBtn)acceptBtn.onclick=()=>{
        const isMyTransfer = side==='user';
        const msgRole = isMyTransfer ? 'assistant' : 'user';
        const msgContent = '{{transfer_accept:'+amt+'}}';
        const msg={role: msgRole, content: msgContent, t:Date.now(), _transferAmt:amt, _transferAction:'收款'};
        chat().push(msg);save();renderThread();
        if(!isMyTransfer && S.chatOpt.autoReply!==false)runAI();else showReplyBtn();
      };
      if(rejectBtn)rejectBtn.onclick=()=>{
        const isMyTransfer = side==='user';
        const msgRole = isMyTransfer ? 'assistant' : 'user';
        const msgContent = '{{transfer_refund:'+amt+'}}';
        const msg={role: msgRole, content: msgContent, t:Date.now(), _transferAmt:amt, _transferAction:'拒收'};
        chat().push(msg);save();renderThread();
        if(!isMyTransfer && S.chatOpt.autoReply!==false)runAI();else showReplyBtn();
      };
    }
    bw.append(card);addZh(bw);col.append(bw);return true}
  if((v=grab('location'))!=null){const segs=v.split('|');const name=(segs[0]||'').trim();const addr=(segs[1]||'').trim();
    const bw=document.createElement('div');bw.className='bubble-wrap';const card=document.createElement('div');card.className='wx-loc';
    card.innerHTML='<div class="wl-map"><div class="pin"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div></div><div class="wl-body"><div class="wl-name">'+(name||'位置').replace(/</g,'&lt;')+'</div><div class="wl-addr">'+(addr||'未提供地址').replace(/</g,'&lt;')+'</div></div><div class="wl-open">在地图中打开 ›</div>';
    bw.append(card);addZh(bw);col.append(bw);return true}
  if((v=grab('gift'))!=null){const segs=v.split('|');const name=(segs[0]||'').trim();const note=(segs[1]||'').trim();
    const bw=document.createElement('div');bw.className='bubble-wrap';const card=document.createElement('div');card.className='wx-gift';
    card.innerHTML='<div class="g-ribbon"></div><div class="g-shine"></div><div class="g-ic"><svg viewBox="0 0 24 24"><path d="M20 12v9H4v-9"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg></div><div class="g-body"><div class="g-label">送你一份礼物</div><div class="g-name">'+(name||'神秘礼物').replace(/</g,'&lt;')+'</div>'+(note?'<div class="g-note">'+note.replace(/</g,'&lt;')+'</div>':'')+'</div><div class="g-foot">点击查收 ›</div>';
    bw.append(card);addZh(bw);col.append(bw);return true}
  return false;
}
function renderBubbleContent(b,text){
  // 处理思维链折叠占位符
  if(text.includes('\u0002THINK:')){
    text=text.replace(/\u0002THINK:([^\u0002]*)\u0002/g,(m,b64)=>{
      let inner='';try{inner=decodeURIComponent(escape(atob(b64)))}catch(e){inner=b64}
      const wrap=document.createElement('details');wrap.className='think-wrap';
      const sum=document.createElement('summary');sum.textContent='💭 思考过程';
      const pre=document.createElement('div');pre.className='think-body';pre.textContent=inner.trim();
      wrap.append(sum,pre);b.append(wrap);return '';
    });
  }
  const re=/\{\{sticker:([^}]+)\}\}|\[sticker:([^\]]+)\]/g;let last=0,m,hadImg=false,hadAny=false;
  while((m=re.exec(text))){hadAny=true;const name=(m[1]||m[2]).trim();const before=text.slice(last,m.index);if(before)b.append(document.createTextNode(before));const st=findSticker(name);if(st&&st.url){const img=document.createElement('img');img.className='sticker-img';img.src=st.url;img.alt=name;b.append(img);hadImg=true}else{const ph=document.createElement('span');ph.className='sticker-missing';ph.textContent='〔表情·'+name+'〕';b.append(ph)}last=re.lastIndex}
  const rest=text.slice(last);if(rest||!hadAny)b.append(document.createTextNode(rest));
  if(hadImg&&!rest&&text.trim().match(/^(\{\{sticker:[^}]+\}\}|\[sticker:[^\]]+\])$/))b.classList.add('has-sticker');
}

let selMode=false;const selSet=new Set();
function enterSelMode(startIdx){
  const _sc=$('scroll');const _sp=_sc?_sc.scrollTop:0;
  selMode=true;selSet.clear();if(startIdx!=null)selSet.add(startIdx);
  document.body.classList.add('selmode');
  $('selTop').classList.add('show');$('selBar').classList.add('show');
  $('composer').style.visibility='hidden';
  renderThread();updateSelCount();
  if(_sc)requestAnimationFrame(()=>{_sc.scrollTop=_sp});
}
function exitSelMode(){selMode=false;selSet.clear();document.body.classList.remove('selmode');$('selTop').classList.remove('show');$('selBar').classList.remove('show');$('composer').style.visibility='';renderThread()}
function updateSelCount(){$('selCount').textContent='已选 '+selSet.size+' 条'}
$('selCancel').onclick=exitSelMode;
$('selAll').onclick=()=>{const c=chat();const vis=[];c.forEach((m,i)=>{if(!m.hidden)vis.push(i)});const allSel=vis.every(i=>selSet.has(i));selSet.clear();if(!allSel)vis.forEach(i=>selSet.add(i));const sc=$('scroll');const sp=sc?sc.scrollTop:0;renderThread();if(sc)sc.scrollTop=sp;updateSelCount()};
function selectedSorted(){return [...selSet].sort((a,b)=>a-b)}
function selectedText(){const c=chat();const r=curRole(),u=curUser();return selectedSorted().map(i=>{const m=c[i];const who=m.role==='user'?(u.userName||'我'):(r.roleName||'对方');return who+'：'+sanitizeForAI(stripTrans(m.content))}).join('\n')}
$('selCopy').onclick=()=>{if(!selSet.size){toast('未选择',true);return}copyText(selectedText());exitSelMode()};
$('selTxt').onclick=()=>{if(!selSet.size){toast('未选择',true);return}const r=curRole();const blob=new Blob([selectedText()],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(r.roleName||'聊天')+'_记录_'+fmtStamp()+'.txt';a.click();toast('已导出文本');exitSelMode()};
$('selImg').onclick=async()=>{if(!selSet.size){toast('未选择',true);return}toast('生成长图中…');try{await exportChatImage(selectedSorted())}catch(e){toast('生成失败：'+e.message,true)}exitSelMode()};
$('selDel').onclick=()=>{if(!selSet.size){toast('未选择',true);return}if(!confirm('删除选中的 '+selSet.size+' 条消息？'))return;const c=chat();selectedSorted().reverse().forEach(i=>c.splice(i,1));save();exitSelMode()};

function copyText(text){
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(()=>toast('已复制')).catch(()=>fallbackCopy(text))}
  else fallbackCopy(text);
}
function fallbackCopy(text){try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();toast('已复制')}catch(e){toast('复制失败，请手动选择',true)}}

function renderThread(){const t=$('thread');const _sc=$('scroll');const _keepScroll=selMode&&_sc;const _sp=_keepScroll?_sc.scrollTop:0;t.innerHTML='';if(!selMode){$('composer').style.visibility=''}if(typeof updateAiReplyBar==='function')updateAiReplyBar();if(!hasRole()){hideReplyBtn();return}ensureGreeting();const c=chat();
  $('thread').style.setProperty('--fz',(S.chatOpt.fontSize||15)+'px');
  let lastT=0;
  c.forEach((m,idx)=>{
    if(m.hidden)return;
    if(S.chatOpt.showTime!==false&&m.t){ if(!lastT||m.t-lastT>5*60000){const sep=document.createElement('div');sep.className='time-sep';const sepSpan=document.createElement('span');sepSpan.textContent=fmtDay(m.t)+' '+fmtTime(m.t);sep.append(sepSpan);t.append(sep)} lastT=m.t; }
    if(m.recalled){const rt=document.createElement('div');rt.className='sys-tip recall-tip';const _w=m.role==='user'?(curUser().userName||'你'):(curRole()&&curRole().roleName||'对方');rt.textContent='「'+_w+'」撤回了一条消息';t.append(rt);return;}
    // 旁白消息：居中小字，不走气泡
    if(m.content&&m.content.startsWith('\u0004NARR:')){const narrTxt=m.content.slice(6).replace(/\u0004$/,'').trim();const nd=document.createElement('div');nd.className='sys-tip narr-tip';nd.textContent=narrTxt;t.append(nd);return;}
    // 拍一拍：修改为像旁白一样居中渲染，去掉头像气泡
    if(m.content&&m.content.startsWith('\u0003PAT:')){
      const patTxt=m.content.slice(5).replace(/\u0003$/,'').trim();
      const nd=document.createElement('div');nd.className='sys-msg';
      nd.innerHTML=`<span class="sys-text">${patTxt}</span>`;
      t.append(nd);
      return;
    }
    if(m.role==='user'){renderUser(m.content,idx,m.t);if(m.seen){const rd=document.createElement('div');rd.className='read-receipt';rd.innerHTML='<svg viewBox="0 0 24 24"><path d="M1.5 12.5l4 4 7-9"/><path d="M11 16.5l1 .5 7-9"/></svg><span>已读</span>';t.append(rd)}}else renderAI(m.content,!!m.greet,idx,m.t);
  });
  if(!selMode)scrollEnd();  // 多选时不滚到底，避免点选跳走
  else if(_keepScroll){requestAnimationFrame(()=>{_sc.scrollTop=_sp})}  // 多选重绘后恢复原滚动位置，避免闪跳到上面
  if(!selMode&&S.chatOpt.autoReply===false&&c.length&&c[c.length-1].role==='user')showReplyBtn();else if(!selMode)hideReplyBtn();
}
// ===== 消息操作底部弹层 =====
function openMsgSheet(title,actions){
  $('msgSheetTitle').textContent=title||'操作';
  const host=$('msgSheetBtns');
  host.innerHTML='';  // 整块重建，避免残留
  const normal=actions.filter(a=>!a.danger);
  const danger=actions.filter(a=>a.danger);
  // 普通操作：4 列网格
  if(normal.length){
    const row=document.createElement('div');row.className='msg-sheet-row';
    normal.forEach(a=>{
      const btn=document.createElement('button');btn.className='msg-sheet-btn';
      btn.innerHTML=(a.svg||'')+'<span>'+a.label+'</span>';
      btn.onclick=()=>{closeMsgSheet();setTimeout(a.fn,10)};
      row.append(btn);
    });
    host.append(row);
  }
  // 危险操作：整行宽按钮
  if(danger.length){
    const drow=document.createElement('div');drow.className='msg-sheet-row wide';
    danger.forEach(a=>{
      const btn=document.createElement('button');btn.className='msg-sheet-btn danger';
      btn.innerHTML=(a.svg||'')+'<span>'+a.label+'</span>';
      btn.onclick=()=>{closeMsgSheet();setTimeout(a.fn,10)};
      drow.append(btn);
    });
    host.append(drow);
  }
  $('msgSheet').classList.add('show');$('msgSheetScrim').classList.add('show');
}
function closeMsgSheet(){$('msgSheet').classList.remove('show');$('msgSheetScrim').classList.remove('show')}
$('msgSheetScrim').onclick=closeMsgSheet;
$('msgSheetCancel').onclick=closeMsgSheet;

// 长按 = 进入多选，单击气泡 = 弹操作面板
function attachLongPress(wrap,idx){
  let timer=null,moved=false;
  const start=e=>{moved=false;timer=setTimeout(()=>{if(!moved&&!selMode)enterSelMode(idx)},480)};
  const mv=()=>{moved=true;if(timer){clearTimeout(timer);timer=null}};
  const end=()=>{if(timer){clearTimeout(timer);timer=null}};
  wrap.addEventListener('touchstart',start,{passive:true});
  wrap.addEventListener('touchmove',mv,{passive:true});
  wrap.addEventListener('touchend',end);
  wrap.addEventListener('contextmenu',e=>{e.preventDefault();if(selMode)toggleSel(idx);else enterSelMode(idx)});
}
function selCheckEl(idx){const ck=document.createElement('div');ck.className='msg-check'+(selSet.has(idx)?' on':'');ck.innerHTML='<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';return ck}
function recallMsg(idx, who) {
  const c = chat(); const m = c[idx]; if (!m) return;
  const raw = c.filter(x => !x.hidden);
  const n = S.memOpt && S.memOpt.carry || 20;
  const win = n > 0 ? raw.slice(-n) : raw.slice();
  if (win.includes(m)) {
    m.recalled = true; m._rc = m.content; m.content = '';
  } else {
    c.splice(idx, 1);
  }
  save(); renderThread(); toast('已撤回');
}

// === Emoji 表态 ===
const REACT_POOL = ['❤️','😂','😮','😢','😡','👍','🔥'];
function _mKey(m){ return (m.t||0)+'_'+(m.role||'u') }
function _getR(m){ if(!S.reactions)S.reactions={}; return S.reactions[_mKey(m)]||(S.reactions[_mKey(m)]={}); }
function renderReactBar(wrap, m, side) {
  const r = _getR(m);
  const shown = REACT_POOL.filter(e => r[e] > 0);
  if (!shown.length) return;
  const bar = document.createElement('div');
  bar.className = 'react-bar' + (side==='user' ? ' react-bar-r' : ' react-bar-l');
  shown.forEach(e => {
    const b = document.createElement('button'); b.className = 'react-btn' + (r._up===e?' on':'');
    b.textContent = e + (r[e]>1 ? '\u202f'+r[e] : '');
    b.onclick = ev => { ev.stopPropagation(); _toggleR(m,e); renderThread(); };
    bar.append(b);
  });
  wrap.append(bar);
}
function _toggleR(m, e) {
  const r = _getR(m);
  if (r._up === e) { r._up=null; r[e]=Math.max(0,(r[e]||1)-1); if(!r[e])delete r[e]; }
  else {
    if(r._up){ const o=r._up; r._up=null; r[o]=Math.max(0,(r[o]||1)-1); if(!r[o])delete r[o]; }
    r._up=e; r[e]=(r[e]||0)+1;
  }
  save();
}
let _rTarget = null;
function openReactPicker(m){ _rTarget=m; $('reactPicker').classList.add('show'); }
function closeReactPicker(){ $('reactPicker').classList.remove('show'); _rTarget=null; }

function toggleSel(idx){
  if(selSet.has(idx))selSet.delete(idx);else selSet.add(idx);
  // 只更新这一条的视觉，不重绘整列（避免滚动位置跳走）
  const wrap=document.querySelector('.msg[data-idx="'+idx+'"]');
  if(wrap){
    wrap.classList.toggle('sel',selSet.has(idx));
    const ck=wrap.querySelector('.msg-check');
    if(ck)ck.classList.toggle('on',selSet.has(idx));
  }
  updateSelCount();
}

function renderUser(text,idx,ts){
  const t=$('thread');const wrap=document.createElement('div');wrap.className='msg user'+(selSet.has(idx)?' sel':'');wrap.dataset.idx=idx;
  if(selMode){const ck=selCheckEl(idx);ck.style.right='auto';ck.style.left='6px';wrap.style.position='relative';wrap.style.paddingLeft='34px';wrap.append(ck)}
  wrap.append(avEl('user'));
  const col=document.createElement('div');col.className='m-col';
  // 引用条
  const _qm=chat()[idx];
  if(_qm&&_qm.quote){const qb=document.createElement('div');qb.className='quote-bar';qb.innerHTML='<div class="q-who">'+escapeHtml(_qm.quote.who||'')+'</div>'+escapeHtml(_qm.quote.text||'');col.append(qb)}
  const parts=text.split(/\n{2,}/).flatMap(p=>p.split(/\n/)).map(s=>s.trim()).filter(Boolean);
  const allParts=parts.length?parts:[text];
  let lastB=null;
  allParts.forEach(p=>{
    if(isSpecialPart(p)){renderSpecialPart(col,p,'user',idx);return}
    const bw=document.createElement('div');bw.className='bubble-wrap';const b=document.createElement('div');b.className='bubble';renderBubbleContent(b,p);bw.append(b);col.append(bw);lastB=b;
  });
  wrap.append(col);t.append(wrap);
  if(!selMode){
    // 单击气泡区 → 弹操作面板
    col.onclick=e=>{
      if(selMode||e.target.closest('.m-av'))return;
      const u2=curUser();
      openMsgSheet('我的消息',[
        {label:'复制',svg:'<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',fn:()=>copyText(stripTrans(text))},
        {label:'引用',svg:'<svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',fn:()=>setQuote('user',u2.userName||'我',text)},
        {label:'编辑',svg:'<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',fn:()=>{const nv=prompt('编辑消息：',text);if(nv==null)return;chat()[idx].content=nv;save();renderThread();toast('已修改')}},
        {label:'多选',svg:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>',fn:()=>enterSelMode(idx)},
        {label:'撤回',svg:'<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 0 10h-1"/></svg>',fn:()=>recallMsg(idx,'user')},{label:'删除',svg:'<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/></svg>',danger:true,fn:()=>{if(!confirm('删除这条消息？'))return;chat().splice(idx,1);save();renderThread()}},
      ]);
    };
  }
  if(chat()[idx]) renderReactBar(wrap, chat()[idx], 'user');
  attachLongPress(wrap,idx);
}
function renderAI(raw,isGreet,idx,ts){
  const t=$('thread');const wrap=document.createElement('div');wrap.className='msg ai'+(selSet.has(idx)?' sel':'');wrap.dataset.idx=idx;
  if(selMode){const ck=selCheckEl(idx);ck.style.left='auto';ck.style.right='6px';wrap.style.position='relative';wrap.style.paddingRight='34px';wrap.append(ck)}
  
  const aiAvatar = avEl('ai');
  aiAvatar.style.cursor = 'pointer';
  aiAvatar.onclick = () => {
      if(selMode)return;
      // 找到这条消息对应的 mind 数据（从本条及同组的第一条找）
      const msgs=chat();
      let mindData='';
      // 先从当前消息找
      if(msgs[idx]&&msgs[idx].mind!=null&&msgs[idx].mind!=='')mindData=msgs[idx].mind;
      else{
        // 同 grp 里找第一条有 mind 的
        const grp=msgs[idx]&&msgs[idx].grp;
        if(grp){const hit=msgs.find(m=>m.grp===grp&&m.mind!=null&&m.mind!=='');if(hit)mindData=hit.mind}
      }
      // 构建弹窗内容：三项始终显示
      const md=S.mind||{};
      const box=$('mindContent');box.innerHTML='';
      if(!mindData){
        box.innerHTML='<div class="note" style="text-align:center;margin:0">这条消息里没有捕捉到心声数据哦…</div>';
      }else{
        // 解析 mind 数据里的各字段
        const mindFiltered=toSub(mindData,'display','mind');
        const lines=mindFiltered.split('\n').map(l=>l.trim()).filter(Boolean);
        const fields={};
        lines.forEach(l=>{
          const colon=l.indexOf('：');const colon2=l.indexOf(':');
          const ci=colon>=0?colon:(colon2>=0?colon2:-1);
          if(ci>0){fields[l.slice(0,ci).trim()]=l.slice(ci+1).trim()}
          else fields[l]=''
        });
        // 动态标签：按「生成区」开关或已有数据显示，含时间
        const has=k=>Object.keys(fields).some(fk=>fk.includes(k.replace('度','')));
        let items=[];
        if(md.genAff||has('好感')) items.push({key:'好感度',icon:'❤️'});
        if(md.genTho||has('想法')) items.push({key:'想法',icon:'💭'});
        if(md.genPos||has('姿势')) items.push({key:'姿势',icon:'🎭'});
        if(md.genTime||has('时间')) items.push({key:'时间',icon:'🕐'});
        if(!items.length) items=[{key:'好感度',icon:'❤️'},{key:'想法',icon:'💭'},{key:'姿势',icon:'🎭'}];
        const msgObj=msgs[idx];
        items.forEach(({key,icon})=>{
          const val=Object.entries(fields).find(([k])=>k.includes(key.replace('度',''))||k===key);
          const card=document.createElement('div');
          card.style.cssText='background:var(--surface);border:1px solid var(--line-soft);border-radius:13px;padding:10px 13px;position:relative';
          const head=document.createElement('div');head.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
          const label=document.createElement('span');label.style.cssText='font-size:12px;color:var(--ink-faint);font-weight:600';label.textContent=icon+' '+key;
          const editBtn=document.createElement('button');editBtn.style.cssText='background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:0';editBtn.textContent='编辑';
          head.append(label,editBtn);
          const content=document.createElement('div');content.style.cssText='font-size:14px;color:var(--ink);line-height:1.6;white-space:pre-wrap';
          content.textContent=val?val[1]:'（本轮未生成）';
          editBtn.onclick=()=>{
            if(editBtn.textContent==='编辑'){content.contentEditable='true';content.style.outline='1px solid var(--accent)';content.style.borderRadius='6px';content.style.padding='2px 4px';editBtn.textContent='保存';content.focus()}
            else{content.contentEditable='false';content.style.outline='';content.style.padding='';editBtn.textContent='编辑';
              // 更新存储的 mind 数据
              if(msgObj){
                // 重建 mindData
                let newMind=mindData;
                const newVal=content.textContent.trim();
                if(val){newMind=newMind.replace(val[0]+'：'+val[1],val[0]+'：'+newVal).replace(val[0]+':'+val[1],val[0]+'：'+newVal)}
                else{newMind+=(newMind?'\n':'')+key+'：'+newVal}
                // 找到 grp 第一条存 mind
                const grp=msgObj.grp;const target=grp?msgs.find(m=>m.grp===grp&&m.mind!=null):msgObj;
                if(target)target.mind=newMind;else msgObj.mind=newMind;
                save();toast('心声已更新');
              }
            }
          };
          card.append(head,content);box.append(card);
        });
      }
      $('mindScrim').classList.add('show');
      $('mindModal').classList.add('show');
  };
  wrap.append(aiAvatar);

  const col=document.createElement('div');col.className='m-col';
  const subFull=toSub(raw);const parts=splitMessages(subFull);
  let lastB=null;
  parts.forEach(p=>{
    if(isSpecialPart(p)){renderSpecialPart(col,p,'ai',idx);return}
    const bw=document.createElement('div');bw.className='bubble-wrap';const b=document.createElement('div');b.className='bubble';
    const mi=p.indexOf('|||');
    if(mi>=0){const fore=p.slice(0,mi).trim(),zh=p.slice(mi+3).trim();const fdiv=document.createElement('div');renderBubbleContent(fdiv,fore);b.append(fdiv);if(zh){const z=document.createElement('div');z.className='trans';z.textContent=zh;b.append(z)}}
    else{renderBubbleContent(b,p||'…')}
    bw.append(b);col.append(bw);lastB=b;
  });
  if(curVoice().showRaw&&subFull!==raw&&lastB){const rr=document.createElement('div');rr.className='raw';rr.textContent='语音原文：'+raw;lastB.append(rr)}
  wrap.append(col);t.append(wrap);
  if(!selMode){
    // 单击气泡区 → 弹操作面板（头像区域单独处理心声，不触发此事件）
    col.onclick=e=>{
      if(selMode)return;
      const v=curVoice();
      const actions=[];
      if(v.key&&v.voice){
        const sb={label:'朗读',svg:'<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',fn:()=>{
          // 找一个临时按钮执行 speak
          const tmp=document.createElement('button');tmp.className='act';speak(voiceText(raw),tmp);
        }};
        actions.push(sb);
      }
      actions.push({label:'复制',svg:'<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',fn:()=>copyText(stripTrans(subFull))});
      const r2=curRole();
      actions.push({label:'引用',svg:'<svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',fn:()=>setQuote('ai',r2?r2.roleName||'角色':'角色',subFull.slice(0,80))});
      actions.push({label:'编辑',svg:'<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',fn:()=>{const nv=prompt('编辑消息：',raw);if(nv==null)return;chat()[idx].content=nv;save();renderThread();toast('已修改')}});
      if(!isGreet)actions.push({label:'重新生成',svg:'<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>',fn:()=>regen()});
      else if(greetingList().length>1)actions.push({label:'切换开场白',svg:'<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>',fn:()=>openGreetPicker(greetingList(),idx)});
      actions.push({label:'多选',svg:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>',fn:()=>enterSelMode(idx)});
      actions.push({label:'撤回',svg:'<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 0 10h-1"/></svg>',fn:()=>recallMsg(idx,'ai')});actions.push({label:'删除',svg:'<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/></svg>',danger:true,fn:()=>{if(!confirm('删除这条消息？'))return;chat().splice(idx,1);save();renderThread()}});
      openMsgSheet('角色消息',actions);
      // 顺便检查自动朗读
      const c2=chat();const isLast=(idx===c2.length-1);
      if(v.key&&v.voice&&v.autoSpeak&&!isGreet&&isLast){const tmp=document.createElement('button');tmp.className='act';setTimeout(()=>speak(voiceText(raw),tmp),200)}
    };
  }
  // 自动朗读（不依赖点击）
  (()=>{const v=curVoice();const c2=chat();const isLast=(idx===c2.length-1);if(v.key&&v.voice&&v.autoSpeak&&!isGreet&&isLast){const tmp=document.createElement('button');tmp.className='act';setTimeout(()=>speak(voiceText(raw),tmp),250)}})();
  if(chat()[idx]) renderReactBar(wrap, chat()[idx], 'ai');
  attachLongPress(wrap,idx);
}

function editBubble(lastB,idx){
  if(idx<0||idx>=chat().length)return;
  const cur=chat()[idx].content;
  const nv=prompt('编辑这条消息（完整内容）：',cur);
  if(nv==null)return;
  chat()[idx].content=nv;save();renderThread();toast('已修改');
}
function scrollEnd(){const s=$('scroll');requestAnimationFrame(()=>s.scrollTop=s.scrollHeight)}
function fmtStamp(){const d=new Date();const p=n=>('0'+n).slice(-2);return d.getFullYear()+''+p(d.getMonth()+1)+''+p(d.getDate())+'_'+p(d.getHours())+''+p(d.getMinutes())+''+p(d.getSeconds())}
function fmtTime(ts){if(!ts)return'';const d=new Date(ts);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
function fmtDay(ts){const d=new Date(ts);const now=new Date();const sameDay=d.toDateString()===now.toDateString();const y=new Date(now-86400000);const yest=d.toDateString()===y.toDateString();if(sameDay)return'今天';if(yest)return'昨天';return (d.getMonth()+1)+'月'+d.getDate()+'日'}

function loadImg(src){return new Promise(res=>{const im=new Image();im.crossOrigin='anonymous';im.onload=()=>res(im);im.onerror=()=>res(null);im.src=src})}
async function exportChatImage(indices){
  const r=curRole(),u=curUser();const all=chat();
  const msgs=(indices&&indices.length?indices.map(i=>all[i]):all.filter(m=>!m.hidden));
  const W=720;const pad=24,gap=18,avS=44,maxBub=W*0.62;
  const cv=document.createElement('canvas');const ctx=cv.getContext('2d');const FS=16,TFS=12;ctx.font=FS+'px sans-serif';
  function wrap(text){const lines=[];text.split('\n').forEach(seg=>{let cur='';for(const ch of seg){const test=cur+ch;if(ctx.measureText(test).width>maxBub-28){lines.push(cur);cur=ch}else cur=test}lines.push(cur)});return lines.length?lines:['']}
  const aiAv=r.avatar?await loadImg(r.avatar):null;
  const meAv=u.avatar?await loadImg(u.avatar):null;
  const stickerImgs={};
  for(const m of msgs){const re=/\{\{sticker:([^}]+)\}\}|\[sticker:([^\]]+)\]/g;let mm;while((mm=re.exec(m.content))){const nm=(mm[1]||mm[2]).trim();if(!(nm in stickerImgs)){const st=findSticker(nm);stickerImgs[nm]=st&&st.url?await loadImg(st.url):null}}}
  const STK=88;
  let H=pad;const items=[];let lastT=0;
  msgs.forEach(m=>{
    let sepH=0,sepText='';
    if(S.chatOpt.showTime!==false&&m.t&&(!lastT||m.t-lastT>5*60000)){sepText=fmtDay(m.t)+' '+fmtTime(m.t);sepH=26}
    if(m.t)lastT=m.t;
    const stOnly=/^(\{\{sticker:[^}]+\}\}|\[sticker:[^\]]+\])$/.test(stripTrans(m.content).trim());
    let bh,ls=[],transLs=[],kind='text',stName='';
    if(stOnly){const mm=stripTrans(m.content).trim().match(/\{\{sticker:([^}]+)\}\}|\[sticker:([^\]]+)\]/);stName=(mm[1]||mm[2]).trim();kind='sticker';bh=STK}
    else{
      const full=stripTrans(m.content)
        .replace(/<mind>[\s\S]*?<\/mind>/gi,'') // 导出长图时同样要去掉心声文本
        .replace(/\{\{sticker:[^}]+\}\}/g,'[表情]').replace(/\[sticker:[^\]]+\]/g,'[表情]')
        .replace(/\{\{voice:([\s\S]*?)\}\}/g,(x,p)=>'🎤 '+p.replace(/\[[^\]]*\]/g,'').trim()).replace(/\{\{voice:([^\n]*)$/g,(x,p)=>'🎤 '+p.replace(/\[[^\]]*\]/g,'').trim())
        .replace(/\{\{card:([\s\S]*?)\}\}/g,(x,p)=>{const c=(p.split('|')[0]||'').trim();return '🖼 '+c})
        .replace(/\{\{img:([\s\S]*?)\}\}/g,(x,p)=>{const i=p.indexOf('|');const h=(i>=0?p.slice(0,i):p).trim();const c=(i>=0?p.slice(i+1):'').trim();return '🖼 '+(c||(/^(data:image|https?:)/.test(h)?'[图片]':h))});
      const mi=m.content.indexOf('|||');
      ls=wrap(full);
      if(mi>=0){const zh=m.content.slice(mi+3).trim();if(zh){ctx.font=TFS+'px sans-serif';transLs=wrap(zh);ctx.font=FS+'px sans-serif'}}
      bh=ls.length*(FS+8)+transLs.length*(TFS+5)+(transLs.length?8:0)+20;
    }
    items.push({m,ls,transLs,bh,sepText,sepH,kind,stName});H+=sepH+Math.max(bh,avS)+gap;
  });
  H+=pad;cv.width=W;cv.height=H;
  ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--bg')||'#1a1714';ctx.fillRect(0,0,W,H);
  ctx.textBaseline='top';
  function roundRect(c,x,y,w,h,rd){c.beginPath();c.moveTo(x+rd,y);c.arcTo(x+w,y,x+w,y+h,rd);c.arcTo(x+w,y+h,x,y+h,rd);c.arcTo(x,y+h,x,y,rd);c.arcTo(x,y,x+w,y,rd);c.closePath()}
  function avatar(img,ax,ay,fb,color){ctx.save();roundRect(ctx,ax,ay,avS,avS,12);ctx.clip();if(img){ctx.drawImage(img,ax,ay,avS,avS)}else{ctx.fillStyle=color;ctx.fillRect(ax,ay,avS,avS);ctx.fillStyle='#fff';ctx.font='bold 18px sans-serif';ctx.fillText((fb||'?').charAt(0),ax+avS/2-9,ay+avS/2-10)}ctx.restore()}
  let y=pad;
  items.forEach(({m,ls,transLs,bh,sepText,sepH,kind,stName})=>{
    if(sepText){ctx.fillStyle='#999';ctx.font=FS-4+'px sans-serif';ctx.textAlign='center';ctx.fillText(sepText,W/2,y+6);ctx.textAlign='left';y+=sepH}
    const isU=m.role==='user';
    if(kind==='sticker'){
      const sx=isU?(W-pad-avS-12-STK):(pad+avS+12);
      const img=stickerImgs[stName];
      if(img){ctx.save();roundRect(ctx,sx,y,STK,STK,12);ctx.clip();ctx.drawImage(img,sx,y,STK,STK);ctx.restore()}
      else{ctx.fillStyle=isU?'#5a9e78':'#2e2820';roundRect(ctx,sx,y,STK,STK,12);ctx.fill();ctx.fillStyle='#aaa';ctx.font='13px sans-serif';ctx.fillText('['+stName+']',sx+8,y+STK/2-7)}
    }else{
      ctx.font=FS+'px sans-serif';
      let bw2=Math.max(...ls.map(l=>ctx.measureText(l).width));
      ctx.font=TFS+'px sans-serif';if(transLs.length)bw2=Math.max(bw2,...transLs.map(l=>ctx.measureText(l).width));
      bw2=Math.min(maxBub,bw2+28);ctx.font=FS+'px sans-serif';
      const bx=isU?(W-pad-avS-12-bw2):(pad+avS+12);
      ctx.fillStyle=isU?'#5a9e78':'#2e2820';roundRect(ctx,bx,y,bw2,bh,14);ctx.fill();
      ctx.fillStyle=isU?'#fff':'#f0ebe2';ls.forEach((l,i)=>ctx.fillText(l,bx+14,y+10+i*(FS+8)));
      if(transLs.length){ctx.font=TFS+'px sans-serif';ctx.fillStyle=isU?'rgba(255,255,255,.7)':'rgba(240,235,226,.6)';const ty=y+10+ls.length*(FS+8)+6;transLs.forEach((l,i)=>ctx.fillText(l,bx+14,ty+i*(TFS+5)));ctx.font=FS+'px sans-serif'}
    }
    const ax=isU?(W-pad-avS):pad;
    avatar(isU?meAv:aiAv,ax,y,isU?(u.userName||'我'):(r.roleName||'?'),isU?'#5a9e78':'#e0a063');
    y+=Math.max(bh,avS)+gap;
  });
  const url=cv.toDataURL('image/png');const a=document.createElement('a');a.href=url;a.download=(r.roleName||'聊天')+'_长图_'+fmtStamp()+'.png';a.click();toast('已导出长图')
}