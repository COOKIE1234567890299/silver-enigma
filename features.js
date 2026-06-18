// ===== features.js =====
// 语音通话 / 关系推进 / 后台保活 / 主动消息 / 时间系统 / 长期记忆弹窗
// ========================

let proTimer = null;
let silentAudio = null;

// === 语音通话系统（完全重写：微信风格、接听判定、挂断后续）===
let _call={active:false,t0:0,tmr:null,ok:false,msgs:[],inputLocked:false};

async function startCall(){
  if(!hasRole()){toast('先选个角色',true);return}
  if(_call.active){toast('通话进行中',true);return}
  if(S.chatOpt.callOn===false){toast('通话功能已关闭',true);return}
  const r=curRole();
  _call={active:true,t0:0,tmr:null,ok:false,msgs:[],inputLocked:false};
  
  const av=$('callAv');
  if(r.avatar){av.style.backgroundImage='url('+r.avatar+')';av.textContent=''}
  else{av.style.backgroundImage='';av.textContent=(r.roleName||'?')[0]}
  $('callName').textContent=r.roleName||'对方';
  $('callStatus').textContent='正在等待对方接听...';
  $('callBubbles').innerHTML='';
  $('callInputArea').style.display='none';
  
  // 设置通话背景
  const bgUrl = r.callBg || S.globalCallBg || r.bg || S.globalBg;
  const bgEl = $('callBgImg');
  if(bgEl) {
    if(bgUrl) bgEl.style.backgroundImage = `url(${bgUrl})`;
    else bgEl.style.backgroundImage = 'none';
  }

  $('callModal').classList.add('show');

  // AI 判定是否接听
  const sysPrompt = "用户正在向你发起语音通话。请结合当前的人设、好感度和剧情上下文，决定是否接听。如果你决定接听，请只输出 <accept>；如果拒绝，请输出 <reject> 并附带简短的心声或理由（例如：<reject>现在太晚了不想接）。不要输出其他任何解释。";
  try {
    const decision = await simpleCall(sysPrompt, "（发起语音通话）", 100);
    if(!_call.active) return; // 中途挂断
    
    if(decision.includes('<reject>') || Math.random() < (S.chatOpt.callRejectChance||15)/100) {
      $('callStatus').textContent = '对方手机可能不在身边，建议稍后再拨';
      setTimeout(endCall, 2000);
    } else {
      $('callStatus').textContent = '00:00';
      _call.ok = true; _call.t0 = Date.now();
      $('callInputArea').style.display = 'flex';
      _call.tmr = setInterval(() => {
        const s = Math.floor((Date.now()-_call.t0)/1000);
        $('callStatus').textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
      }, 1000);
      
      // 电话接通，AI 开口说第一句话
      await callAISay('（电话接通了，请你先自然地打个招呼，像接电话一样开口说一句话，简短口语化）');
    }
  } catch(e) {
    $('callStatus').textContent = '信号不好，连接失败';
    setTimeout(endCall, 1500);
  }
}

async function callAISay(prompt){
  if(!_call.active||!_call.ok)return;
  const r=curRole();
  const histCtx=_call.msgs.slice(-6).map(m=>m.role+': '+m.text).join('\n');
  const sys=buildSystem()+'\n\n【当前状态：语音通话中】你和对方正在打语音电话，请用极其口语化、简短的方式说话，每次只说1-2句。绝对不要发表情包。必须输出对白，可以带少量括号动作描写。';
  const userPrompt=histCtx?(histCtx+'\n\n'+prompt):prompt;
  addCallBubble('ai','…');
  const idx=_call.msgs.length;_call.msgs.push({role:'assistant',text:'…'});
  try{
    const txt=await simpleCall(sys,userPrompt,200);
    const clean=txt.replace(/<mind>[\s\S]*?<\/mind>/gi,'').replace(/<mind>[\s\S]*$/i,'').replace(/\{\{[^}]+\}\}/g,'').trim();
    _call.msgs[idx].text=clean||'（沉默）';
    updateCallBubble(idx,_call.msgs[idx].text);
    
    // 调用语音 API 只读对白
    if (S.chatOpt.callVoiceApi !== false && clean) {
      const sayText = typeof extractDialogue === 'function' ? extractDialogue(clean) : clean;
      if (sayText.trim()) {
        const dummyBtn = document.createElement('button');
        speak(sayText, dummyBtn).catch(e => console.error("通话语音播放失败", e));
      }
    }
  }catch(e){_call.msgs[idx].text='（信号不好）';updateCallBubble(idx,'（信号不好）')}
}

function addCallBubble(role,text){
  const box=$('callBubbles');
  const bub=document.createElement('div');bub.className='call-bub call-bub-'+role;
  bub.textContent=text;
  bub.dataset.bubIdx=_call.msgs.length;
  box.append(bub);box.scrollTop=box.scrollHeight;
}
function updateCallBubble(idx,text){
  const box=$('callBubbles');
  const bub=box.querySelector('[data-bub-idx="'+idx+'"]');
  if(bub)bub.textContent=text;
  box.scrollTop=box.scrollHeight;
}

async function sendCallMsg(){
  const inp=$('callInput');const txt=inp.value.trim();if(!txt||_call.inputLocked)return;
  inp.value='';_call.inputLocked=true;$('callSendBtn').disabled=true;
  addCallBubble('user',txt);
  _call.msgs.push({role:'user',text:txt});
  await callAISay('用户刚才说：「'+txt+'」，请自然回应');
  _call.inputLocked=false;$('callSendBtn').disabled=false;
  $('callInput').focus();
}

async function endCall(){
  if(!_call.active)return;
  const {ok,t0} = _call; 
  _call.active = false; 
  clearInterval(_call.tmr);
  
  $('callModal').classList.remove('show');
  
  if(!ok){ toast('通话已取消'); return; }
  
  const dur = t0 ? Math.floor((Date.now()-t0)/1000) : 0;
  const ds = dur>0 ? dur+'秒' : '片刻';
  
  // 整理通话记录为隐藏记忆
  const dialogLog = _call.msgs.map(m=>(m.role==='user'?'我':'对方')+'：'+m.text).join('\n');
  const note = `（语音通话已结束，时长 ${ds}。\n通话记录：\n${dialogLog}）`;
  chat().push({role:'user', content:note, t:Date.now(), hidden:true});
  
  // 发送系统提示并触发 AI 后续回复
  chat().push({role:'user', content:'\u0004NARR:通话已结束\u0004', t:Date.now()});
  chat().push({role:'user', content:'（刚才我们打了语音电话，已经挂断。请基于刚刚的通话内容，发一条文字消息作为挂断后的自然反应，符合你的人设）', t:Date.now(), hidden:true});
  
  save(); renderThread();
  
  if(S.chatOpt.autoReply!==false) { await runAI(); } else { showReplyBtn(); }
  toast('通话结束');
}

$('callEnd')&&($('callEnd').onclick=endCall);
$('callSendBtn')&&($('callSendBtn').onclick=sendCallMsg);
$('callInput')&&($('callInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendCallMsg()}}));
$('puVoiceCall')&&($('puVoiceCall').onclick=()=>{closePlus();startCall()});

// === 关系推进 ===
const _RP_TPL = '【关系推进授权】在维持你的核心人设前提下，你被允许自主策划并推进与对方的情感进展。可以主动表达情感、提出约会邀请、制造仪式感场景。节奏要自然克制，不要每条都推进，等气氛合适再行动。可从下列活动中选择：{activities}';
const _RP_ACTS = ['海边散步','烛光晚餐','手写信','送定制礼物','一起看电影','去游乐园','在家做饭','午夜通话','送花','下雨天共伞'];
function collectRelationPush() {
  if (!S.relationPush || !S.relationPush.on) return null;
  const tpl = S.relationPush.prompt || _RP_TPL;
  const acts = (S.relationPush.activities && S.relationPush.activities.length ? S.relationPush.activities : _RP_ACTS).join('、');
  return tpl.replace('{activities}', acts);
}
function syncRP(){
  const rp=S.relationPush||{};
  if($('rpOn'))$('rpOn').checked=!!rp.on;
  if($('rpPrompt'))$('rpPrompt').value=(rp.prompt&&rp.prompt.trim())?rp.prompt:_RP_TPL;
  if($('rpActivities'))$('rpActivities').value=((rp.activities&&rp.activities.length)?rp.activities:_RP_ACTS).join('\n');
}

document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){scheduleProactive();refreshKeepStat();}});
function scheduleProactive(){
  if(proTimer){clearTimeout(proTimer);proTimer=null}
  if(S.proactive.on&&hasRole()){
    const ms=Math.max(1,S.proactive.minutes||10)*60000;
    proTimer=setTimeout(()=>{if(document.visibilityState==='visible'||S.proactive.keepAlive)fireProactive();else scheduleProactive()},ms);
  }
}
function applyProactive(){
  scheduleProactive();
  if(S.proactive.keepAlive){startKeepAlive()}else{stopKeepAlive()}
  if(typeof refreshKeepStat==='function')refreshKeepStat();
}

// === 真正的前后端保活逻辑 ===
function startKeepAlive(){
  if(silentAudio && silentAudio.type === 'aud'){
     silentAudio.au.play().catch(()=>{});
     refreshKeepStat();
     return;
  }
  try{
    let au=$('_siAu');
    if(!au){
      au=document.createElement('audio');au.id='_siAu';
      // 核心修复：合法的极微小静音 MP3 数据流，浏览器才能正确解析并占用通道
      au.src='data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYxLjEuMTAwAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABJbmZvAAAADwAAAAEAAABVAAADSAADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwPz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/AAAAAExhdmMyLjEyMFQAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAP/7UMQAAAMAAQAAAAgAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAA==';
      au.loop=true;
      au.volume=0.01;
      au.setAttribute('playsinline','true');
      au.setAttribute('webkit-playsinline','true');
      document.body.append(au);
    }
    au.play().catch(()=>{});
    silentAudio={au,type:'aud'};
  }catch(e){
    silentAudio=null;
  }
  refreshKeepStat();
}

// 触摸唤醒，解决浏览器要求必须有用户交互才能播放音频的安全限制
document.addEventListener('click', () => {
  if (S.proactive && S.proactive.on && S.proactive.keepAlive && silentAudio && silentAudio.type === 'aud' && silentAudio.au && silentAudio.au.paused) {
    silentAudio.au.play().catch(()=>{});
    refreshKeepStat();
  }
}, {passive: true});
document.addEventListener('touchstart', () => {
  if (S.proactive && S.proactive.on && S.proactive.keepAlive && silentAudio && silentAudio.type === 'aud' && silentAudio.au && silentAudio.au.paused) {
    silentAudio.au.play().catch(()=>{});
    refreshKeepStat();
  }
}, {passive: true});

function stopKeepAlive(){
  if(silentAudio){
    try{if(silentAudio.type==='aud'){silentAudio.au.pause();silentAudio.au.remove();}
        else{silentAudio.osc&&silentAudio.osc.stop();silentAudio.ac&&silentAudio.ac.close();}}catch(e){}
    silentAudio=null;
  }
}
async function fireProactive(){
  if(!hasRole()){scheduleProactive();return}const a=curApi();if(!a.apiKey){scheduleProactive();return}
  const note='（系统指令，不要回复本段）'+S.proactive.prompt;
  const c=chat();c.push({role:'user',content:note,t:Date.now(),hidden:true});
  let ex=null;
  try{ex=await callBrain()}catch(e){}
  finally{
    const pos=c.map(m=>m.content===note&&m.hidden).lastIndexOf(true);
    if(pos>=0)c.splice(pos,1);
  }
  if(ex&&ex.text){pushAIReply(ex.text);save();renderThread()}
  scheduleProactive();
}

$('autoReply').addEventListener('change',()=>{S.chatOpt.autoReply=$('autoReply').checked;save();const c=chat();if(S.chatOpt.autoReply===false&&c.length&&c[c.length-1].role==='user')showReplyBtn();else hideReplyBtn()});
$('splitMsg').addEventListener('change',()=>{S.chatOpt.split=$('splitMsg').checked;save()});
$('autoTrans').addEventListener('change',()=>{S.chatOpt.trans=$('autoTrans').checked;save()});
$('fontSize').addEventListener('input',()=>{S.chatOpt.fontSize=+$('fontSize').value;$('fzVal').textContent=S.chatOpt.fontSize+'px';$('thread').style.setProperty('--fz',S.chatOpt.fontSize+'px');save()});
$('typingDelayOn').addEventListener('change',()=>{S.chatOpt.typingDelay=$('typingDelayOn').checked;save();$('typingDelayWrap').style.display=S.chatOpt.typingDelay?'block':'none'});
$('typingDelaySec').addEventListener('change',()=>{S.chatOpt.typingDelaySec=+$('typingDelaySec').value||3;save()});
$('readNoReplyOn').addEventListener('change',()=>{S.chatOpt.readNoReply=$('readNoReplyOn').checked;save()});
$('charStickersOn').addEventListener('change',()=>{S.chatOpt.charStickers=$('charStickersOn').checked;save()});
$('charKaomojiOn').addEventListener('change',()=>{S.chatOpt.charKaomoji=$('charKaomojiOn').checked;save()});
$('autoStatusOn').addEventListener('change',()=>{S.chatOpt.autoStatus=$('autoStatusOn').checked;save()});
$('showTime').addEventListener('change',()=>{S.chatOpt.showTime=$('showTime').checked;save();renderThread()});

// ===== 时间管理 =====
function syncTimeUI(){
  const on=!!S.chatOpt.timeSysOn;
  if($('timeSysOn'))$('timeSysOn').checked=on;
  if($('storyTimeWrap'))$('storyTimeWrap').style.display=on?'block':'none';
  if($('storyStart'))$('storyStart').value=S.chatOpt.storyStart||'';
  if($('timeFallback'))$('timeFallback').value=(S.chatOpt.timeFallbackMin!=null?S.chatOpt.timeFallbackMin:5);
  if($('timeRecentN'))$('timeRecentN').value=(S.chatOpt.timeRecentN!=null?S.chatOpt.timeRecentN:2);
  refreshStoryClock();
}
function refreshStoryClock(){const el=$('storyClockNow');if(el)el.textContent=(typeof fmtStoryTime==='function')?fmtStoryTime(storyEpoch()):'—';}
$('timeSysHead')&&$('timeSysHead').addEventListener('click',()=>{const w=$('timeSysWrap');if(w){w.classList.toggle('open');$('timeSysHead').classList.toggle('open')}});
$('timeSysOn')&&$('timeSysOn').addEventListener('change',()=>{
  S.chatOpt.timeSysOn=$('timeSysOn').checked;
  if(S.chatOpt.timeSysOn){const c=curConvo();if(c&&c.clock==null)c.clock=storyStartMs();}
  save();syncTimeUI();
  toast(S.chatOpt.timeSysOn?'已启用故事时间，AI 每轮自动推进':'已切回手机真实时间');
});
$('storyStart')&&$('storyStart').addEventListener('change',()=>{S.chatOpt.storyStart=$('storyStart').value||'';const c=curConvo();if(c)c.clock=storyStartMs();save();refreshStoryClock()});
$('timeFallback')&&$('timeFallback').addEventListener('change',()=>{S.chatOpt.timeFallbackMin=Math.max(0,+$('timeFallback').value||0);save()});
$('timeRecentN')&&$('timeRecentN').addEventListener('change',()=>{S.chatOpt.timeRecentN=Math.max(0,+$('timeRecentN').value||0);save()});
$('storyClockReset')&&$('storyClockReset').addEventListener('click',()=>{const c=curConvo();if(c){c.clock=storyStartMs();save();refreshStoryClock();toast('已重置故事时间')}});
$('patOn').addEventListener('change',()=>{S.chatOpt.patOn=$('patOn').checked;save()});
$('narrateOn')&&$('narrateOn').addEventListener('change',()=>{S.chatOpt.narrateOn=$('narrateOn').checked;save()});
$('callOn')&&$('callOn').addEventListener('change',()=>{S.chatOpt.callOn=$('callOn').checked;save()});
$('callVoiceApiOn')&&$('callVoiceApiOn').addEventListener('change',()=>{S.chatOpt.callVoiceApi=$('callVoiceApiOn').checked;save()});
$('callRejectChance')&&$('callRejectChance').addEventListener('input',()=>{const v=+$('callRejectChance').value;S.chatOpt.callRejectChance=v;if($('rejectChanceVal'))$('rejectChanceVal').textContent=v+'%';save()});
$('rpSave')&&$('rpSave').addEventListener('click',()=>{if(!S.relationPush)S.relationPush={};S.relationPush.on=!!($('rpOn')&&$('rpOn').checked);S.relationPush.prompt=($('rpPrompt')&&$('rpPrompt').value)||'';const _ra=($('rpActivities')&&$('rpActivities').value)||'';S.relationPush.activities=_ra.split(/\n/).map(x=>x.trim()).filter(Boolean);save();toast('已保存')});
(()=>{const _rp=$('reactPickerEmojis');if(_rp&&typeof REACT_POOL!=='undefined'){REACT_POOL.forEach(e=>{const b=document.createElement('button');b.className='react-pe';b.textContent=e;b.onclick=()=>{if(_rTarget){_toggleR(_rTarget,e);renderThread();}closeReactPicker();};_rp.append(b)});}})();
$('dialogOnly')&&$('dialogOnly').addEventListener('change',()=>{const v=curVoice();v.dialogOnly=$('dialogOnly').checked;save()});

// ===== 长期记忆弹窗 =====
function openMemModal(){renderMemModalList();$('memScrim').classList.add('show');$('memModal').classList.add('show')}
function closeMemModal(){$('memModal').classList.remove('show');$('memScrim').classList.remove('show')}
$('btnOpenMem').onclick=()=>{pullSettings();save();openMemModal()};
$('memModalClose').onclick=closeMemModal;$('memScrim').onclick=closeMemModal;
function renderMemModalList(){
  const box=$('memModalList');box.innerHTML='';const rm=roleMem();
  if(!rm||!rm.memories.length){box.innerHTML='<div class="note" style="margin-top:0">还没有长期记忆。每次总结会在这里追加一条。</div>';return}
  rm.memories.forEach((m,i)=>{
    const card=document.createElement('div');card.className='seg-card';card.style.marginTop='8px';card.style.padding='12px';
    const top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';
    top.innerHTML='<b style="font-size:12px;color:var(--ink-faint)">第 '+(i+1)+' 条</b>';
    const btns=document.createElement('div');btns.style.cssText='display:flex;gap:6px';
    const edt=document.createElement('button');edt.className='mini';edt.textContent='编辑';
    const del=document.createElement('button');del.className='mini danger';del.textContent='删除';
    const ta=document.createElement('textarea');ta.className='ta';ta.value=m;ta.style.minHeight='56px';ta.disabled=true;ta.style.opacity='.85';
    edt.onclick=()=>{if(ta.disabled){ta.disabled=false;ta.style.opacity='1';ta.focus();edt.textContent='保存'}else{rm.memories[i]=ta.value;ta.disabled=true;ta.style.opacity='.85';edt.textContent='编辑';save();toast('已保存')}};
    del.onclick=()=>{if(!confirm('删除这条记忆？'))return;rm.memories.splice(i,1);if(!rm.memories.length)rm.sumDone=0;save();renderMemModalList()};
    btns.append(edt,del);top.append(btns);card.append(top,ta);box.append(card);
  });
}
$('memAddManual').onclick=()=>{const rm=roleMem();if(!rm)return;rm.memories.push('');save();renderMemModalList();const box=$('memModalList');const tas=box.querySelectorAll('textarea');const last=tas[tas.length-1];if(last){last.disabled=false;last.style.opacity='1';last.focus()}};
function sumErr(e){const m=(e&&e.message)||'';return m.includes('fetch')?'总结失败：网络或被限流':'总结失败：'+m;}
$('memSumInModal').onclick=async()=>{try{await doSummarize(false);renderMemModalList()}catch(e){toast(sumErr(e),true)}};
$('btnSumNow').onclick=async()=>{pullSettings();save();try{await doSummarize(false)}catch(e){toast(sumErr(e),true)}};
$('btnRelNow').onclick=async()=>{pullSettings();save();try{await doRelation(false);$('relText').value=roleMem().relation||''}catch(e){toast('更新失败：'+e.message,true)}};

// ... 保持原有代码不变 ...
$('btnTest').onclick=async()=>{
  pullSettings();const a=curApi();const out=$('testOut');out.className='test-out';out.textContent='';
  if(!a.apiKey){out.className='test-out bad';out.textContent='请先填 API Key';return}
  out.className='test-out ok';out.textContent='测试中…';
  try{await testConnection(a);out.className='test-out ok';out.textContent='✓ 连接成功'}
  catch(e){out.className='test-out bad';out.textContent='✗ '+e.message}
};
async function testConnection(a){
  if(a.provider==='claude'){const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':a.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:a.model||'claude-sonnet-4-6',max_tokens:1,messages:[{role:'user',content:'hi'}]})});if(!r.ok)throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,80));return}
  if(a.provider==='gemini'){const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${a.apiKey}`);if(!r.ok)throw new Error('HTTP '+r.status);return}
  let base=a.provider==='deepseek'?'https://api.deepseek.com/v1':(a.baseUrl||'').replace(/\/$/,'');if(!base)throw new Error('请填 Base URL');
  const r=await fetch(base+'/models',{headers:{'Authorization':'Bearer '+a.apiKey}});if(!r.ok)throw new Error('HTTP '+r.status);
}
let fetchedModels=[];
$('btnFetchModels').onclick=async()=>{
  pullSettings();const a=curApi();const out=$('testOut');out.className='test-out';
  if(!a.apiKey){out.className='test-out bad';out.textContent='请先填 API Key';return}
  out.className='test-out ok';out.textContent='拉取中…';
  try{const list=await fetchModels(a);if(!list.length)throw new Error('未返回模型');fetchedModels=list;out.className='test-out ok';out.textContent='✓ 拉到 '+list.length+' 个，点「选择」挑模型';$('btnPickModel').style.display='block'}
  catch(e){out.className='test-out bad';out.textContent='✗ '+e.message+(a.provider==='claude'?'（Claude 无公开列表，请手填）':'')}
};
$('btnPickModel').onclick=()=>openModelPicker();
function openModelPicker(){renderPickList('');$('pickFilter').value='';$('pickScrim').classList.add('show');$('modelPicker').classList.add('show')}
function closeModelPicker(){$('modelPicker').classList.remove('show');$('pickScrim').classList.remove('show')}
$('pickClose').onclick=closeModelPicker;
$('pickScrim').onclick=()=>{closeModelPicker();closeGreet();if(typeof closePlus==='function')closePlus();closeStickerPicker();if(typeof closeAiReply==='function')closeAiReply()};
$('pickFilter').oninput=()=>renderPickList($('pickFilter').value);
function renderPickList(filter){const box=$('pickList');box.innerHTML='';const cur=$('model').value;const f=(filter||'').toLowerCase();fetchedModels.filter(m=>m.toLowerCase().includes(f)).forEach(m=>{const it=document.createElement('div');it.className='pick-item'+(m===cur?' cur':'');it.innerHTML='<span>'+m+'</span><span class="chk">✓</span>';it.onclick=()=>{$('model').value=m;closeModelPicker();renderPickList('')};box.append(it)})}
async function fetchModels(a){
  if(a.provider==='claude')throw new Error('不支持拉取');
  if(a.provider==='gemini'){const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${a.apiKey}`);if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();return(d.models||[]).map(m=>(m.name||'').replace('models/','')).filter(Boolean)}
  let base=a.provider==='deepseek'?'https://api.deepseek.com/v1':(a.baseUrl||'').replace(/\/$/,'');if(!base)throw new Error('请填 Base URL');
  const r=await fetch(base+'/models',{headers:{'Authorization':'Bearer '+a.apiKey}});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();return(d.data||[]).map(m=>m.id).filter(Boolean)
}

$('btnExport').onclick=()=>{pullSettings();save();const blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='语音角色_备份_'+fmtStamp()+'.json';a.click();toast('已导出')};
$('btnImport').onclick=()=>$('fileImport').click();
$('fileImport').onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{S=JSON.parse(rd.result);const fr=freshState();for(const k in fr)if(S[k]==null)S[k]=fr[k];
  if(!Array.isArray(S.worldBook))S.worldBook=[];
  if(S.wbScanFloors==null)S.wbScanFloors=4;
  if(S.roleCards)S.roleCards.forEach(r=>{if(!r.id)r.id=newId('r');if(!r.convos){const c=newConvo('对话 1');c.memories=r.memories||[];c.relation=r.relation||'';r.convos=[c];r.curConvo=c.id}if(!r.curConvo&&r.convos.length)r.curConvo=r.convos[0].id;
    if(r.greetings==null){const raw=(r.greeting||'').trim();r.greetings=raw?raw.split(/\n+/).map(s=>s.trim()).filter(Boolean):[]}
    if(r.order==null)r.order=100;if(r.wbIds==null)r.wbIds=[];});
  (S.regexPresets||[]).forEach(p=>{if(Array.isArray(p.rules))p.rules=p.rules.map(rr=>typeof rr==='string'?{find:rr,replace:'',on:true,target:'both',name:rr.slice(0,12)||'规则',group:''}:rr);if(!Array.isArray(p.groups))p.groups=[]});
  save();applyTheme();syncSettings();refreshTop();renderThread();toast('导入成功')}catch(err){toast('文件无法解析',true)}};rd.readAsText(f);e.target.value=''};
}