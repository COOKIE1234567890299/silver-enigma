// ===== main.js =====
// 消息发送 / AI生成 / 朗读语音 / AI帮我回复 / 微信互动功能 / Plus菜单 / 附件发送 / PWA安装 / 页面初始化
// ====================

// 修复：声明用于防抖/防止多重请求的全局状态
let aiBusy = false;

// ===== 引用状态 =====
let quoteState=null; // {role, who, text}
function setQuote(role,who,text){
  quoteState={role,who,text};
  $('quotePreviewWho').textContent=who;
  $('quotePreviewText').textContent=text.replace(/<[^>]+>/g,'').slice(0,80);
  $('quotePreview').style.display='block';
  $('input').focus();
}
function clearQuote(){quoteState=null;$('quotePreview').style.display='none'}

function escapeHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
async function send(){const text=$('input').value.trim();if(!text)return;if(!hasRole()){toast('请先新建一个角色',true);openDrawer();return}
  if(roleSend){$('input').value='';$('input').style.height='auto';if(quoteState)clearQuote();chat().push({role:'assistant',content:text,t:Date.now(),_rolePlay:true});arSuggest=[];save();renderThread();return}
  const a=curApi();if(!a.apiKey){toast('请先在设置里填 API Key',true);openSettings();return}
  $('input').value='';$('input').style.height='auto';
  const msg={role:'user',content:text,t:Date.now()};
  if(quoteState){msg.quote={who:quoteState.who,text:quoteState.text.replace(/<[^>]+>/g,'').slice(0,120)};clearQuote()}
  chat().push(msg);arSuggest=[];save();renderThread();scheduleProactive();
  if(S.chatOpt.autoReply!==false){await runAI()}else{showReplyBtn()}}
function showReplyBtn(){if(!selMode)$('btnReply').style.display='grid'}
function hideReplyBtn(){$('btnReply').style.display='none'}
async function regen(){const c=chat();
  let end=c.length;while(end>0&&c[end-1].role==='assistant')end--;
  if(end<c.length)c.splice(end,c.length-end);
  save();renderThread();await runAI();}
async function runAI(){
  if(aiBusy)return; aiBusy=true;
  _injCache=null; // 每轮清掉注入缓存，保证 {{random:}} 同轮一致
  hideReplyBtn();$('sendBtn').disabled=true;$('btnReply').disabled=true;
  const t=$('thread');
  const w=document.createElement('div');w.className='msg ai';w.append(avEl('ai'));
  const col=document.createElement('div');col.className='m-col';
  const bw=document.createElement('div');bw.className='bubble-wrap';
  const b=document.createElement('div');b.className='bubble';b.innerHTML='<span class="typing"><i></i><i></i><i></i></span>';
  bw.append(b);col.append(bw);w.append(col);t.append(w);scrollEnd();
  // 气泡延迟：模拟真人「正在输入」，回复前先等一会
  if(S.chatOpt.typingDelay){
    const delay=Math.max(0,(S.chatOpt.typingDelaySec||3))*1000;
    await new Promise(r=>setTimeout(r,delay));
  }
  try{
    let ex=await callBrain();
    let reply=ex.text;
    const stripCheck=s=>String(s||'').replace(/<mind>[\s\S]*$/i,'').replace(/<noreply\s*\/?>|【不回复】|\[noreply\]/gi,'').trim();
    const isNoReply=s=>S.chatOpt.readNoReply && /<noreply\s*\/?>|【不回复】|\[noreply\]/i.test(s);
    // 空回处理：去掉心声/标记后若没有正文，自动重试一次
    if(!stripCheck(reply) && !isNoReply(reply)){
      ex=await callBrain();reply=ex.text;
    }
    // 截断续写：被长度截断且已有正文，自动接着写一次
    if(isTruncated(ex.finish) && stripCheck(reply) && !isNoReply(reply)){
      const more=await continueReply(reply);
      if(more) reply=reply+more;
    }
    w.remove();
    // 已读不回：若 AI 输出 <noreply> 标记，则不显示回复，只标「已读」
    if(isNoReply(reply)){
      // 给最后一条用户消息标已读
      const cc=chat();for(let i=cc.length-1;i>=0;i--){if(cc[i].role==='user'){cc[i].seen=true;break}}
      save();renderThread();
      await maybeSummarize();
    }else{
      const cleaned=reply.replace(/<noreply\s*\/?>|【不回复】|\[noreply\]/gi,'').trim();
      if(!stripCheck(cleaned)){
        toast('回复为空（可能被模型拒绝或截断），可点重新生成或加大「最大回复长度」/检查破限',true);
        showReplyBtn();
      }else{
        pushAIReply(cleaned);
        save();renderThread();await maybeSummarize();
        arSuggest=[];
        if(S.aiReply&&S.aiReply.on&&S.aiReply.auto){try{openAiReply()}catch(e){}}
      }
    }
  }
  catch(e){w.remove();toast('请求失败：'+e.message,true);chat().push({role:'assistant',content:'[出错] '+e.message,t:Date.now()});save();renderThread()}
  finally{aiBusy=false;$('sendBtn').disabled=false;$('btnReply').disabled=false}
}
$('btnReply').onclick=()=>runAI();

async function callBrain(){
  const p=curApi().provider;
  const d = p==='claude'?await callClaude(): p==='gemini'?await callGemini(): await callOpenAICompat();
  const ex=extractAI(d,p);
  if(ex.error) throw new Error(ex.error);
  return ex; // {text, finish}
}
// 截断续写：被 finish=length 截断且已有正文时，接着写一次
async function continueReply(partial){
  const sys=buildSystem();
  const user='你上一条回复因长度限制被截断了。这是你已经写出的部分：\n\n'+partial+'\n\n请直接从中断处继续写完，不要重复已有内容、不要重新开头、不要加任何说明，只输出后续正文。';
  try{const more=await simpleCall(sys,user,(S.maxTokens||4096));return (more||'').trim();}catch(e){return '';}
}
async function callClaude(){const a=curApi();const body={model:a.model,max_tokens:(S.maxTokens||4096),system:buildSystem(),messages:buildMessages()};if(a.temperature!=null&&a.temperature!==1)body.temperature=a.temperature;const res=await robustFetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':a.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify(body)},120000);return await res.json()}
async function callGemini(){const a=curApi();const url=`https://generativelanguage.googleapis.com/v1beta/models/${a.model}:generateContent?key=${a.apiKey}`;const contents=buildMessages().map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));const gc={maxOutputTokens:(S.maxTokens||4096)};if(a.temperature!=null&&a.temperature!==1)gc.temperature=a.temperature;if(a.topP!=null&&a.topP!==1)gc.topP=a.topP;const res=await robustFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:buildSystem()}]},contents,generationConfig:gc})},120000);return await res.json()}
async function callOpenAICompat(){const a=curApi();let base=a.provider==='deepseek'?'https://api.deepseek.com/v1':(a.baseUrl||'').replace(/\/$/,'');if(!base)throw new Error('请填写 Base URL');const msgs=[{role:'system',content:buildSystem()},...buildMessages()];const body={model:a.model,messages:msgs,max_tokens:(S.maxTokens||4096)};if(a.temperature!=null&&a.temperature!==1)body.temperature=a.temperature;if(a.topP!=null&&a.topP!==1)body.top_p=a.topP;const res=await robustFetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+a.apiKey},body:JSON.stringify(body)},120000);return await res.json()}

let curAudio=null;

// ===== AI 帮我想回复 =====
const AR_DEF_DIRS=[{name:'推剧情',guide:''},{name:'谈心',guide:''},{name:'调情',guide:''},{name:'日常',guide:''}];
function renderArDirs(){
  const box=$('arDirs');if(!box)return;box.innerHTML='';
  const ar=S.aiReply||(S.aiReply={on:false,count:2,auto:false,dirs:AR_DEF_DIRS.slice()});
  if(!Array.isArray(ar.dirs))ar.dirs=AR_DEF_DIRS.slice();
  const n=ar.count||2;
  for(let i=0;i<n;i++){
    if(!ar.dirs[i])ar.dirs[i]={name:AR_DEF_DIRS[i]?AR_DEF_DIRS[i].name:('方向'+(i+1)),guide:''};
    const d=ar.dirs[i];
    const card=document.createElement('div');card.className='seg-card';card.style.marginTop=i?'10px':'0';
    const nameWrap=document.createElement('label');nameWrap.className='fld';
    nameWrap.innerHTML='<div class="fld-label">'+(i+1)+'· 方向名字</div>';
    const nameIn=document.createElement('input');nameIn.type='text';nameIn.value=d.name||'';nameIn.placeholder='如：推剧情';
    nameIn.oninput=()=>{d.name=nameIn.value;save()};nameWrap.append(nameIn);
    const gWrap=document.createElement('label');gWrap.className='fld';gWrap.style.marginTop='8px';
    gWrap.innerHTML='<div class="fld-label">指引（可选）</div>';
    const gIn=document.createElement('input');gIn.type='text';gIn.value=d.guide||'';gIn.placeholder='例：分享一件小事';
    gIn.oninput=()=>{d.guide=gIn.value;save()};gWrap.append(gIn);
    card.append(nameWrap,gWrap);box.append(card);
  }
}
async function simpleCall(sys,userText,maxTok){
  const a=curApi();maxTok=maxTok||400;
  if(a.provider==='claude'){const r=await robustFetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':a.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:a.model,max_tokens:maxTok,system:sys,messages:[{role:'user',content:userText}]})},90000);const d=await r.json();const ex=extractAI(d,'claude');if(ex.error)throw new Error(ex.error);return ex.text}
  if(a.provider==='gemini'){const r=await robustFetch(`https://generativelanguage.googleapis.com/v1beta/models/${a.model}:generateContent?key=${a.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:sys}]},contents:[{role:'user',parts:[{text:userText}]}],generationConfig:{maxOutputTokens:maxTok}})},90000);const d=await r.json();const ex=extractAI(d,'gemini');if(ex.error)throw new Error(ex.error);return ex.text}
  let base=a.provider==='deepseek'?'https://api.deepseek.com/v1':(a.baseUrl||'').replace(/\/$/,'');if(!base)throw new Error('请填 Base URL');const r=await robustFetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+a.apiKey},body:JSON.stringify({model:a.model,messages:[{role:'system',content:sys},{role:'user',content:userText}],max_tokens:maxTok})},90000);const d=await r.json();const ex=extractAI(d,'openai');if(ex.error)throw new Error(ex.error);return ex.text
}
function arRecentContext(){
  const r=curRole(),u=curUser();
  return chat().filter(m=>!m.hidden).slice(-8).map(m=>{const who=m.role==='user'?(u.userName||'我'):(r.roleName||'对方');return who+'：'+sanitizeForAI(stripTrans(m.content))}).join('\n');
}
function arClean(s){
  return String(s||'')
    .replace(/<think>[\s\S]*?<\/think>/gi,'') // 确保去掉大模型思考块
    .replace(/<mind>[\s\S]*?<\/mind>/gi,'')   // 去心声块
    .replace(/<mind>[\s\S]*$/i,'')            // 去未闭合心声
    .replace(/<\/?[a-z][^>]*>/gi,'')          // 去 <标签>
    .replace(/\{\{[^}]*\}\}/g,'')             // 去 {{指令}}
    .replace(/\[[a-zA-Z_]+\]/g,'')            // 去 [happy] 类标签
    .replace(/^[\s"「『（(]+|[\s"」』）)]+$/g,'')
    .trim();
}
async function arGenOne(dir){
  const r=curRole(),u=curUser();
  const sys='你在帮「'+(u.userName||'我')+'」构思要发给「'+(r.roleName||'对方')+'」的下一条消息。只输出一句口语简短的回复正文，禁止任何解释/引号/标签，写完整，不要截断。';
  const user='【对话】\n'+arRecentContext()+'\n\n按「'+(dir.name||'自然')+'」'+(dir.guide?('（'+dir.guide+'）'):'')+'方向写一条。';
  let out='';
  for(let attempt=0;attempt<3;attempt++){
    let raw='';
    try{raw=await simpleCall(sys,user, S.maxTokens || 2048);}catch(e){if(attempt===2)throw e;await new Promise(res=>setTimeout(res,200));continue;}
    out=arClean(raw);if(out)break;
    await new Promise(res=>setTimeout(res,150));
  }
  return out||'（生成失败，点🔄重试）';
}
let arSuggest=[];
function openAiReply(){
  if(!hasRole()){toast('先选个角色',true);return}
  const a=curApi();if(!a.apiKey){toast('请先填 API Key',true);openSettings();return}
  $('aiRepSheet').classList.add('show');$('pickScrim').classList.add('show');
  if(!arSuggest.length)genAllAiReplies();else renderAiRepSheet();
}
function closeAiReply(){$('aiRepSheet').classList.remove('show');$('pickScrim').classList.remove('show')}
async function genAllAiReplies(){
  const ar=S.aiReply||{};
  const n=Math.max(1,ar.count||2);
  const baseDirs=ar.dirs&&ar.dirs.length?ar.dirs:AR_DEF_DIRS.slice();
  // 确保 dirs 数组长度够 n 条
  const dirs=[];
  for(let i=0;i<n;i++){
    dirs.push(baseDirs[i]||{name:'方向'+(i+1),guide:''});
  }
  arSuggest=dirs.map(d=>({name:d.name||('方向'+(dirs.indexOf(d)+1)),guide:d.guide||'',text:'',loading:true}));
  renderAiRepSheet();
  // 串行生成，每条之间留间隔，避免并发触发 429 限流
  for(let i=0;i<dirs.length;i++){
    try{arSuggest[i].text=await arGenOne(dirs[i])}catch(e){arSuggest[i].text='[生成失败] '+e.message}
    arSuggest[i].loading=false;renderAiRepSheet();
    if(i<dirs.length-1)await new Promise(res=>setTimeout(res,800));
  }
}
async function regenOneAiReply(i){
  const ar=S.aiReply||{};const dirs=(ar.dirs||AR_DEF_DIRS);
  if(!arSuggest[i])return;arSuggest[i].loading=true;renderAiRepSheet();
  try{arSuggest[i].text=await arGenOne(dirs[i]||{name:arSuggest[i].name,guide:arSuggest[i].guide})}catch(e){arSuggest[i].text='[生成失败] '+e.message}
  arSuggest[i].loading=false;renderAiRepSheet();
}
function renderAiRepSheet(){
  const body=$('aiRepBody');body.innerHTML='';
  if(!arSuggest.length){body.innerHTML='<div class="note" style="margin:0">点「🔄 全部」生成回复。</div>';return}
  arSuggest.forEach((s,i)=>{
    const card=document.createElement('div');card.className='airep-card';
    const top=document.createElement('div');top.className='ac-top';
    const tag=document.createElement('span');tag.className='airep-tag';tag.textContent=s.name||('方向'+(i+1));
    const re=document.createElement('button');re.className='ac-re';re.innerHTML='<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>';
    re.onclick=()=>regenOneAiReply(i);
    top.append(tag,re);
    const txt=document.createElement('div');txt.className='airep-text';
    txt.textContent=s.loading?'生成中…':(s.text||'（空）');
    if(!s.loading&&s.text&&!s.text.startsWith('[生成失败')){
      txt.onclick=()=>{const inp=$('input');inp.value=s.text;inp.dispatchEvent(new Event('input'));closeAiReply();inp.focus()};
    }
    card.append(top,txt);
    const hint=document.createElement('div');hint.className='airep-hint';hint.textContent=s.loading?'':'点这条填进输入框，可改后再发';
    card.append(hint);
    body.append(card);
  });
}
function updateAiReplyBar(){
  const bar=$('aiReplyBar');if(!bar)return;
  const ar=S.aiReply||{};
  const show=ar.on&&hasRole()&&chat().some(m=>!m.hidden);
  bar.style.display=show?'flex':'none';
}

// 只朗读对白：剥离旁白、动作、代码、引用、<标签>、[语气词]、颜文字
function extractDialogue(text){
  let t=String(text||'');
  t=t.replace(/```[\s\S]*?```/g,' ').replace(/`[^`]*`/g,' ');     // 代码块/行内代码
  t=t.replace(/<\/?[a-zA-Z][^>]*>/g,' ');                          // <标签>
  t=t.replace(/\{\{[^}]*\}\}/g,' ');                               // {{指令}}
  t=t.replace(/\[[^\]]{0,20}\]/g,' ');                             // [语气词]/[laughs] 等短方括号
  t=t.replace(/^\s*>.*$/gm,' ');                                   // markdown 引用行
  // 若包含成对的对白引号，则【只保留】引号内的内容（其余视为旁白/动作）
  const quoted=[];const qre=/[「『“"]([^」』”"]*)[」』”"]/g;let qm;
  while((qm=qre.exec(t))){const inner=qm[1].trim();if(inner)quoted.push(inner)}
  if(quoted.length){t=quoted.join('。')}
  else{
    t=t.replace(/（[^）]*）/g,' ').replace(/\([^)]*\)/g,' ');       // （旁白/动作）
    t=t.replace(/\*[^*]*\*/g,' ').replace(/_[^_]*_/g,' ');         // *动作* _强调_
  }
  // 去颜文字与多余符号串
  t=t.replace(/[（(][^）)]{0,16}[）)]/g,' ');
  t=t.replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'，').replace(/[，。、]{2,}/g,'。').trim();
  return t;
}
async function speak(raw,btn){const v=curVoice();raw=(raw||'').replace(/\{\{sticker:[^}]+\}\}/g,'').replace(/\[sticker:[^\]]+\]/g,'').trim();if(v.dialogOnly)raw=extractDialogue(raw);raw=raw.trim();if(!raw){toast('这条没有可朗读的对白',true);return}if(!v.key||!v.voice){toast('请先配置语音',true);return}if(curAudio){curAudio.pause();curAudio=null;document.querySelectorAll('.act.on').forEach(b=>{b.classList.remove('on');b.innerHTML=icoSpeak+'朗读'})}btn.classList.add('on');btn.innerHTML='<span class="wave"><i></i><i></i><i></i><i></i></span>生成';try{let res;if(v.engine==='elevenlabs'){res=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}`,{method:'POST',headers:{'xi-api-key':v.key,'Content-Type':'application/json','Accept':'audio/mpeg'},body:JSON.stringify({text:raw,model_id:v.model||'eleven_v3'})})}else{let base=v.engine==='openai'?'https://api.openai.com/v1':(v.base||'').replace(/\/$/,'');if(!base)throw new Error('请填语音 Base URL');res=await fetch(base+'/audio/speech',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+v.key},body:JSON.stringify({model:v.model||'tts-1',voice:v.voice,input:raw})})}if(!res.ok)throw new Error('HTTP '+res.status+' '+(await res.text()).slice(0,120));const blob=await res.blob();const audio=new Audio(URL.createObjectURL(blob));curAudio=audio;btn.innerHTML='<span class="wave"><i></i><i></i><i></i><i></i></span>播放';audio.onended=()=>{btn.classList.remove('on');btn.innerHTML=icoSpeak+'朗读';curAudio=null};audio.play()}catch(e){toast('语音失败：'+e.message,true);btn.classList.remove('on');btn.innerHTML=icoSpeak+'朗读'}}

// ===== 通用输入弹窗（替代原生 prompt，跟随主题样式）=====
let _gxCb=null;
function gxOpen(opts){
  opts=opts||{};
  $('gxTitle').textContent=opts.title||'输入';
  $('gxLabel').textContent=opts.label||'内容';
  const f=$('gxField');f.value=opts.value||'';f.placeholder=opts.placeholder||'';
  $('gxOk').textContent=opts.ok||'确定';
  _gxCb=opts.onOk||null;
  $('gxScrim').classList.add('show');$('gxModal').classList.add('show');
  setTimeout(()=>{f.focus();},50);
}
function gxClose(){$('gxScrim').classList.remove('show');$('gxModal').classList.remove('show');_gxCb=null}
$('gxCancel')&&($('gxCancel').onclick=gxClose);
$('gxScrim')&&($('gxScrim').onclick=gxClose);
$('gxOk')&&($('gxOk').onclick=()=>{const v=$('gxField').value;const cb=_gxCb;gxClose();if(cb)cb(v)});

// ===== 以角色身份发送 模式 =====
let roleSend=false;
function setRoleSend(on){
  roleSend=!!on;
  const bar=$('roleSendBar');
  if(bar){bar.style.display=roleSend?'flex':'none';const nm=$('roleSendName');if(nm)nm.textContent=(curRole()&&curRole().roleName)||'对方';}
}
$('roleSendExit')&&($('roleSendExit').onclick=()=>{setRoleSend(false);toast('已退出以角色发送')});

function openPlus(){if(!hasRole()){toast('请先新建角色',true);return}$('plusMenu').classList.add('show');$('pickScrim').classList.add('show')}
function closePlus(){$('plusMenu').classList.remove('show');$('pickScrim').classList.remove('show')}
$('btnPlus').onclick=openPlus;$('plusClose').onclick=closePlus;
let wxKind='transfer';
function openWx(kind){
  wxKind=kind;
  const cfg={transfer:{t:'转账',l1:'金额（¥）',ph1:'520',l2:'备注（可选）',ph2:'写一句话…',type1:'number'},
             location:{t:'分享位置',l1:'地点名称',ph1:'如：埃菲尔铁塔',l2:'详细地址（可选）',ph2:'如：xx路xx号',type1:'text'},
             gift:{t:'送出礼物',l1:'礼物名称',ph1:'如：一束花',l2:'附言（可选）',ph2:'写一句动人的话…',type1:'text'}}[kind];
  $('wxTitle').textContent=cfg.t;$('wxL1').textContent=cfg.l1;$('wxL2').textContent=cfg.l2;
  const icons={transfer:'<svg viewBox="0 0 24 24"><path d="M17 7L7 17M7 7h10v10"/></svg>',location:'<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',gift:'<svg viewBox="0 0 24 24"><path d="M20 12v9H4v-9"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>'};
  const ie=$('wxPopIc');if(ie){ie.innerHTML=icons[kind]||'';ie.className='wx-pop-ic '+kind}
  $('wxF1').value='';$('wxF2').value='';$('wxF1').type=cfg.type1;$('wxF1').placeholder=cfg.ph1;$('wxF2').placeholder=cfg.ph2;
  closePlus();$('pickScrim').classList.remove('show');
  $('wxScrim').classList.add('show');$('wxModal').classList.add('show');
}
function closeWx(){$('wxScrim').classList.remove('show');$('wxModal').classList.remove('show')}
function sendWx(){
  const f1=$('wxF1').value.trim(),f2=$('wxF2').value.trim();
  if(!f1){toast('请填写'+(wxKind==='transfer'?'金额':'内容'),true);return}
  const token='{{'+wxKind+':'+f1+'|'+f2+'}}';
  if(roleSend){chat().push({role:'assistant',content:token,t:Date.now(),_rolePlay:true});arSuggest=[];save();closeWx();renderThread();return}
  chat().push({role:'user',content:token,t:Date.now()});arSuggest=[];save();closeWx();renderThread();
  if(S.chatOpt.autoReply!==false)runAI();else showReplyBtn();
}
$('puTransfer').onclick=()=>openWx('transfer');
$('puLocation').onclick=()=>openWx('location');
$('puGift').onclick=()=>openWx('gift');
$('wxCancel').onclick=closeWx;$('wxScrim').onclick=closeWx;$('wxOk').onclick=sendWx;

// 发旁白（居中系统小字，无头像，不触发 AI）
$('puNarrate')&&($('puNarrate').onclick=()=>{
  if(!hasRole()){toast('先选个角色',true);return}
  closePlus();
  gxOpen({title:'发旁白',label:'旁白内容（居中小字，无头像）',placeholder:'描写场景或动作…',onOk:txt=>{
    if(!txt||!txt.trim())return;
    chat().push({role:'user',content:'\u0004NARR:'+txt.trim()+'\u0004',t:Date.now(),_narrate:true});
    save();renderThread();
  }});
});

// 以角色身份发送：切换为一个模式，开启后所有输入/转账/礼物等都以角色名义发出
$('puRoleMode')&&($('puRoleMode').onclick=()=>{
  if(!hasRole()){toast('先选个角色',true);return}
  closePlus();
  setRoleSend(!roleSend);
  toast(roleSend?('已开启 · 现在发出的都以「'+((curRole()&&curRole().roleName)||'对方')+'」身份'):'已退出以角色发送');
});
function fmtCardDate(ts){const d=new Date(ts);const p=n=>('0'+n).slice(-2);return p(d.getFullYear()%100)+'.'+p(d.getMonth()+1)+'.'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}
let attMode='voice',attImgData='';
function openAtt(mode){
  attMode=mode;attImgData='';
  $('attImgPreview').style.display='none';$('attText').value='';$('attCardExtra').style.display='none';
  if(mode==='voice'){$('attTitle').textContent='发语音条';$('attTip').textContent='打字内容会显示成语音条样式（不花钱）。';$('attText').placeholder='想用语音说的话…'}
  if(mode==='card'){$('attTitle').textContent='制作相片记忆';$('attTip').textContent='像小手机那张卡片：写下相片内容，地点和日期已自动填好、你也可以改。';$('attText').placeholder='相片内容（如：和你的第一次约会）';$('attCardExtra').style.display='block';$('attLoc').value='Taipei';$('attDate').value=fmtCardDate(Date.now())}
  if(mode==='realimg'){$('attTitle').textContent='发图片';$('attTip').textContent='先选图片，再写这张图的意思（AI 靠文字理解）。';$('attText').placeholder='这张图主要想表达什么…'}
  $('attScrim').classList.add('show');$('attModal').classList.add('show');
  if(mode==='realimg'){pickImage(d=>{attImgData=d;$('attImgEl').src=d;$('attImgPreview').style.display='block'})}
}
function closeAtt(){$('attModal').classList.remove('show');$('attScrim').classList.remove('show')}
$('puVoice').onclick=()=>{closePlus();openAtt('voice')};
$('puCard').onclick=()=>{closePlus();openAtt('card')};
$('puRealImg').onclick=()=>{closePlus();openAtt('realimg')};
$('puTapTap').onclick=()=>doTapTap();
// ===== 拍一拍 =====
function doTapTap(){
  if(!hasRole()){toast('先选个角色',true);return}
  closePlus();
  const r=curRole();const u=curUser();
  const who=roleSend?(r.roleName||'TA'):(u.userName||'你');
  const target=roleSend?(u.userName||'你'):(r.roleName||'TA');
  gxOpen({title:'拍一拍',label:'自定义动作（留空为默认）',value:'拍了拍'+target,placeholder:'拍了拍…',onOk:act=>{
    const action=(act||'').trim()||('拍了拍'+target);
    const topAv=document.querySelector('.top-id .top-av');
    if(topAv){topAv.classList.remove('taptap-anim');void topAv.offsetWidth;topAv.classList.add('taptap-anim');setTimeout(()=>topAv.classList.remove('taptap-anim'),600)}
    const av=$('taptapTip');av.textContent=who+' '+action;av.classList.add('show');setTimeout(()=>av.classList.remove('show'),2200);
    // 把发出者的名字也包含进去，方便作为独立旁白显示
    chat().push({role:roleSend?'assistant':'user',content:'\u0003PAT:'+who+' '+action+'\u0003',t:Date.now()});
    save();renderThread();
    if(!roleSend){if(S.chatOpt.autoReply!==false)runAI();else showReplyBtn()}
  }});
}
$('attCancel').onclick=closeAtt;$('attScrim').onclick=closeAtt;
$('attOk').onclick=()=>{
  const txt=$('attText').value.trim();
  let content='';
  if(attMode==='voice'){if(!txt){toast('写点内容',true);return}content='{{voice:'+txt+'}}'}
  else if(attMode==='card'){if(!txt){toast('写点内容',true);return}const loc=$('attLoc').value.trim();const date=$('attDate').value.trim();content='{{card:'+txt+'|'+loc+'|'+date+'}}'}
  else if(attMode==='realimg'){if(!attImgData){toast('先选一张图',true);return}content='{{img:'+attImgData+(txt?'|'+txt:'')+'}}'}
  if(roleSend){chat().push({role:'assistant',content,t:Date.now(),_rolePlay:true});save();closeAtt();renderThread();return}
  chat().push({role:'user',content,t:Date.now()});save();closeAtt();renderThread();
  if(S.chatOpt.autoReply!==false)runAI();else showReplyBtn();
};

$('btnTestProactive').onclick=async()=>{pullSettings();save();if(!hasRole()){toast('请先选个角色',true);return}const a=curApi();if(!a.apiKey){toast('先填 API Key',true);return}toast('正在让 TA 主动发一条…');try{await fireProactive();toast('✓ 主动消息已触发，看聊天')}catch(e){toast('测试失败：'+e.message,true)}};
function refreshKeepStat(){
  const el=$('keepStat');if(!el)return;
  const fg=document.visibilityState==='visible';
  if(silentAudio){
    const ok=silentAudio.type==='aud'?!silentAudio.au.paused:(silentAudio.ac&&silentAudio.ac.state!=='closed');
    el.textContent=ok?'🟢 保活中':'🟡 保活异常';el.style.color=ok?'#4caf50':'var(--accent)';
  }else{
    el.textContent=fg?'⚪ 前台运行（未保活）':'🔴 后台风险（未保活）';
    el.style.color=fg?'var(--ink-faint)':'var(--danger)';
  }
}
$('btnTestKeep')&&($('btnTestKeep').onclick=()=>{startKeepAlive();setTimeout(refreshKeepStat,300);if(silentAudio)toast('保活已启动，查看下方状态灯')});

$('sendBtn').onclick=send;
$('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
$('input').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,128)+'px'});

// ===== PWA 安装 =====
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  const btn=$('btnInstallApp');if(btn)btn.style.display='grid';
});
window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  const btn=$('btnInstallApp');if(btn)btn.style.display='none';
  toast('已安装到桌面 ✓');
});
(function(){
  if($('btnInstallApp'))$('btnInstallApp').onclick=async()=>{
    if(deferredInstallPrompt){deferredInstallPrompt.prompt();const r=await deferredInstallPrompt.userChoice;if(r.outcome==='accepted')deferredInstallPrompt=null}
    else toast('请用浏览器菜单→「添加到主屏幕」安装',true);
  };
})();
// PWA：使用同目录的 manifest.json + sw.js（最可靠的可安装方式）
(function setupPWA(){
  try{
    if('serviceWorker'in navigator&&location.protocol.startsWith('http')){
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }catch(e){}
})();

if(!storeOK)setTimeout(()=>toast('预览环境暂不能保存，下载后用浏览器打开即可记忆'),500);
(function migrateSplit(){
  if(S._splitMigrated)return;
  let changed=false;
  S.roleCards.forEach(r=>{(r.convos||[]).forEach(c=>{
    const out=[];
    (c.msgs||[]).forEach(m=>{
      if(m.role==='assistant'&&!m.greet&&typeof m.content==='string'){
        const parts=splitRawIntoMessages(m.content);
        if(parts.length>1){const base=m.t||Date.now();parts.forEach((p,i)=>out.push({...m,content:p,t:(m.t||base)+i,grp:base}));changed=true;return}
      }
      out.push(m);
    });
    c.msgs=out;
  })});
  S._splitMigrated=true;if(changed)save();else save();
})();
renderThread();refreshTop();applyProactive();

// 看门狗：非生成状态下，发送键/回复键绝不允许卡在禁用态
setInterval(()=>{ if(!aiBusy){ const s=$('sendBtn'),r=$('btnReply'); if(s&&s.disabled)s.disabled=false; if(r&&r.disabled)r.disabled=false; } },1500);

// === 心声记录 ===
function openMindLog() {
  const c = chat();
  const box = $('mindLogList'); if (!box) return;
  box.innerHTML = '';
  const entries = c.map((m,i) => ({m,i})).filter(({m}) => m.mind && m.mind.trim());
  if (!entries.length) { box.innerHTML = '<div class="note" style="text-align:center;margin:16px 0">暂无心声记录</div>'; }
  entries.forEach(({m,i}) => {
    const d = document.createElement('div'); d.className = 'ml-item';
    const ts = m.t ? new Date(m.t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    const preview = m.mind.replace(/<[^>]+>/g,'').trim().slice(0,60);
    d.innerHTML = '<div class="ml-meta"><span class="ml-ts">'+ts+'</span><input type="checkbox" class="ml-ck" data-idx="'+i+'"></div><div class="ml-preview">'+preview+'</div><div class="ml-full" style="display:none">'+m.mind.replace(/</g,'&lt;')+'</div>';
    d.querySelector('.ml-preview').onclick = () => {
      const full = d.querySelector('.ml-full'); full.style.display = full.style.display==='none'?'block':'none';
    };
    box.append(d);
  });
  $('mindLogScrim').classList.add('show'); $('mindLogModal').classList.add('show');
}
function closeMindLog() { $('mindLogScrim').classList.remove('show'); $('mindLogModal').classList.remove('show'); }
function deleteMindLogSel() {
  const cks = [...$('mindLogList').querySelectorAll('.ml-ck:checked')];
  if (!cks.length) { toast('没有选中', true); return; }
  if (!confirm('删除选中 '+cks.length+' 条心声记录？（不影响正文）')) return;
  const idxs = new Set(cks.map(c => +c.dataset.idx));
  chat().forEach((m,i) => { if (idxs.has(i)) { m.mind = ''; } });
  save(); openMindLog(); toast('已删除 '+cks.length+' 条');
}

// === 导出功能 ===
function exportRoleCard() {
  const r = curRole(); if (!r) { toast('先选个角色', true); return; }
  const wb = (S.worldBook||[]).filter(w => w.roleId===r.id || w.scope==='global');
  const rx = (S.regexPresets||[]);
  const data = { _type:'roleCard', role:JSON.parse(JSON.stringify(r)), worldBook:wb, regexPresets:rx };
  _dlJson(data, (r.roleName||'角色卡')+'.json');
  toast('角色卡已导出');
}
function exportWorldBook(groupName) {
  let items = S.worldBook||[];
  if (groupName) items = items.filter(w => w.sourceGroup===groupName);
  _dlJson({_type:'worldBook', items}, (groupName||'世界书')+'.json');
  toast('世界书已导出（'+items.length+'条）');
}
function exportRegex(groupName) {
  const reg = curRegex(); if (!reg) return;
  let rules = reg.rules||[];
  if (groupName) rules = rules.filter(r => (r.group||'')=== groupName);
  _dlJson({_type:'regex', name:reg.name, rules}, (groupName||'正则')+'.json');
  toast('正则已导出（'+rules.length+'条）');
}
function _dlJson(data, filename) {
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
  a.download = filename; document.body.append(a); a.click(); a.remove();
}

// 多选：事件委托——点击时从实际落点的 .msg 现读 data-idx，所点即所选，杜绝错位
(function(){
  const th=$('thread'); if(!th) return;
  th.addEventListener('click',e=>{
    if(!selMode) return;
    const msg=e.target.closest('.msg');
    if(!msg||!th.contains(msg)) return;
    const idx=parseInt(msg.dataset.idx,10);
    if(!isNaN(idx)) toggleSel(idx);
  });
})();

// ===== 跨大类多选导出功能 =====
let _treeExportData = null;
function openTreeExport(type) {
  const title = type === 'wb' ? '导出世界书' : '导出正则规则';
  const tEl = $('treeExportTitle'); if(tEl) tEl.textContent = title;
  const list = $('treeExportList'); 
  if(!list) {
     // 容错：如果用户还没加入对应的 HTML 节点，降级使用旧版导出
     if(type === 'wb') exportWorldBook();
     else exportRegex();
     return;
  }
  list.innerHTML = '';
  let groups = {}; 
  
  if (type === 'wb') {
    const items = S.worldBook || [];
    if (!items.length) { toast('没有可导出的条目', true); return; }
    items.forEach((w, i) => {
      const g = w.scope === 'global' ? '🌐 全局世界书' : '👤 角色专属';
      if(!groups[g]) groups[g] = [];
      groups[g].push({ original: w, idx: i, name: w.name });
    });
  } else {
    const reg = curRegex(); const items = reg ? (reg.rules||[]) : [];
    if (!items.length) { toast('没有可导出的规则', true); return; }
    items.forEach((r, i) => {
      const g = r.group || '📁 未分组';
      if(!groups[g]) groups[g] = [];
      groups[g].push({ original: r, idx: i, name: r.name || r.find });
    });
  }
  _treeExportData = { type, groups };

  Object.keys(groups).forEach(gName => {
    const gDiv = document.createElement('div'); gDiv.className = 'tree-group';
    const gHead = document.createElement('label'); gHead.className = 'tree-ghead';
    const gCb = document.createElement('input'); gCb.type = 'checkbox'; gCb.checked = true;
    gHead.append(gCb, document.createTextNode(' ' + gName)); gDiv.append(gHead);

    const itemsDiv = document.createElement('div'); itemsDiv.className = 'tree-items';
    const itemCbs = [];
    groups[gName].forEach(itemObj => {
      const iLabel = document.createElement('label'); iLabel.className = 'tree-item-lbl';
      const iCb = document.createElement('input'); iCb.type = 'checkbox'; iCb.checked = true;
      iCb.dataset.g = gName; iCb.dataset.i = itemObj.idx; itemCbs.push(iCb);
      iLabel.append(iCb, document.createTextNode(' ' + itemObj.name)); itemsDiv.append(iLabel);
      
      iCb.onchange = () => {
        const allChecked = itemCbs.every(c => c.checked);
        gCb.checked = allChecked; gCb.indeterminate = !allChecked && itemCbs.some(c => c.checked);
      };
    });
    
    gCb.onchange = () => itemCbs.forEach(c => c.checked = gCb.checked);
    gDiv.append(itemsDiv); list.append(gDiv);
  });
  if($('treeExportScrim')) $('treeExportScrim').classList.add('show'); 
  if($('treeExportModal')) $('treeExportModal').classList.add('show');
}

function doTreeExport() {
  if(!_treeExportData) return;
  const { type, groups } = _treeExportData; const selected = [];
  const cbs = $('treeExportList').querySelectorAll('input[data-g]:checked');
  cbs.forEach(cb => {
    const item = groups[cb.dataset.g].find(x => x.idx === parseInt(cb.dataset.i, 10));
    if(item) selected.push(item.original);
  });
  if (!selected.length) { toast('至少选择一项', true); return; }
  
  if (type === 'wb') {
    _dlJson({ _type: 'worldBook', items: selected }, '世界书导出_' + fmtStamp() + '.json');
    toast('已导出 ' + selected.length + ' 条世界书');
  } else {
    const reg = curRegex();
    _dlJson({ _type: 'regex', name: reg ? reg.name : '正则', rules: selected }, '正则导出_' + fmtStamp() + '.json');
    toast('已导出 ' + selected.length + ' 条规则');
  }
  closeTreeExport();
}

function closeTreeExport() { 
  if($('treeExportScrim')) $('treeExportScrim').classList.remove('show'); 
  if($('treeExportModal')) $('treeExportModal').classList.remove('show'); 
  _treeExportData = null; 
}

// 拦截原有的导出按钮事件
setTimeout(() => {
  const wbBtn = document.getElementById('wbExport'); if(wbBtn) wbBtn.onclick = () => openTreeExport('wb');
  const rxBtn = document.getElementById('rxExport'); if(rxBtn) rxBtn.onclick = () => openTreeExport('rx');
  const teCancel = document.getElementById('treeExportCancel'); if(teCancel) teCancel.onclick = closeTreeExport;
  const teScrim = document.getElementById('treeExportScrim'); if(teScrim) teScrim.onclick = closeTreeExport;
  const teOk = document.getElementById('treeExportOk'); if(teOk) teOk.onclick = doTreeExport;
}, 500);

}