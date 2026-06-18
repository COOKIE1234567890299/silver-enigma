// ===== ai-engine.js =====
// 网络请求 / AI接口调用 / 世界书检索 / 注入系统 / 消息构建 / 正则处理 / 对话总结
// =========================

async function robustFetch(url,opts,timeoutMs,maxRetry){
  timeoutMs=timeoutMs||90000;
  maxRetry=(maxRetry==null)?4:maxRetry; // 429/过载自动退避重试
  let attempt=0;
  while(true){
    const ctrl=new AbortController();
    const tid=setTimeout(()=>ctrl.abort(),timeoutMs);
    let r;
    try{ r=await fetch(url,Object.assign({},opts,{signal:ctrl.signal})); }
    catch(e){ clearTimeout(tid);
      if(e&&e.name==='AbortError') throw new Error('请求超时（超过'+Math.round(timeoutMs/1000)+'秒未响应，多半是对话太长或网络慢，可减少条数）');
      throw new Error('网络无法连接（'+((e&&e.message)||'fetch失败')+'）。若你是用本地文件 content:// 打开的，请改用 https 网址打开，副请求更容易被本地来源拦截。');
    }
    clearTimeout(tid);
    if(r.ok) return r;
    // 限流(429)或服务过载(529/503)：退避后重试
    if((r.status===429||r.status===529||r.status===503)&&attempt<maxRetry){
      let wait=0;
      const ra=r.headers.get&&r.headers.get('retry-after');
      if(ra){const n=parseFloat(ra);if(!isNaN(n))wait=n*1000;}
      if(!wait)wait=Math.min(20000,1200*Math.pow(2,attempt))+Math.random()*400; // 1.2s,2.4s,4.8s,9.6s...
      attempt++;
      await new Promise(res=>setTimeout(res,wait));
      continue;
    }
    let body='';try{body=(await r.text()).slice(0,160)}catch(_){ }
    throw new Error('HTTP '+r.status+(body?(' '+body):''));
  }
}
// 统一解析三种接口的返回，识别：代理错误(200+error)、截断(finish_reason)、空回
function extractAI(d,provider){
  if(d==null||typeof d!=='object') return {text:'',finish:'',error:'接口返回的不是合法 JSON（多半是中转站出错页）'};
  if(d.error){const m=(d.error&&(d.error.message||d.error.type))||(typeof d.error==='string'?d.error:JSON.stringify(d.error));return {text:'',finish:'error',error:m};}
  if(provider==='claude'){
    if(d.type==='error')return {text:'',finish:'error',error:(d.error&&d.error.message)||'claude error'};
    let text=(d.content||[]).map(c=>c.text||'').join('\n').trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return {text,finish:d.stop_reason||''};
  }
  if(provider==='gemini'){
    if(d.promptFeedback&&d.promptFeedback.blockReason)return {text:'',finish:'block',error:'内容被 Gemini 拦截：'+d.promptFeedback.blockReason};
    const cand=(d.candidates&&d.candidates[0])||{};
    let text=((cand.content&&cand.content.parts)||[]).map(p=>p.text||'').join('\n').trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    let err='';if(!text&&cand.finishReason&&/SAFETY|RECITATION|BLOCK/i.test(cand.finishReason))err='内容被 Gemini 拦截：'+cand.finishReason;
    return {text,finish:cand.finishReason||'',error:err};
  }
  // openai 兼容
  const ch=(d.choices&&d.choices[0])||{};const msg=ch.message||{};
  let text=msg.content;if(Array.isArray(text))text=text.map(x=>(x&&x.text)||'').join('');
  text=String(text||'');
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let err='';if(!text&&ch.finish_reason&&/content_filter/i.test(ch.finish_reason))err='内容被接口过滤（content_filter），检查破限提示词';
  return {text,finish:ch.finish_reason||'',error:err};
}
function isTruncated(finish){return /length|max_?token|MAX_TOKENS/i.test(finish||'');}

async function withRetry(fn,tries){
  tries=tries||2;let lastErr;
  for(let i=0;i<tries;i++){
    try{return await fn();}
    catch(e){lastErr=e;if(i<tries-1)await new Promise(r=>setTimeout(r,800*(i+1)));}
  }
  throw lastErr;
}
async function summarizeCall(prompt,history){
  const a=curApi();const r0=curRole(),u0=curUser();
  const mo=S.memOpt||{};
  let wc='';
  if(mo.sumMin||mo.sumMax){wc='\n【字数要求】'+(mo.sumMin?('不少于 '+mo.sumMin+' 字'):'')+(mo.sumMin&&mo.sumMax?'，':'')+(mo.sumMax?('不超过 '+mo.sumMax+' 字'):'')+'。';}
  const mt = Math.max(2048, S.maxTokens || 4096);
  const charName=(r0&&r0.roleName)||'角色',userName=(u0&&u0.userName)||'用户';
  const gmap={'男':'男性（请用"他"指代）','女':'女性（请用"她"指代）','双性':'双性（可用 TA，不要固定他/她）','其他':((r0&&r0.genderCustom)?r0.genderCustom+'（按此设定指代，不要默认他/她）':'性别不定（避免用确定的他/她，可用 TA）')};
  const gtxt=(r0&&r0.gender&&gmap[r0.gender])?('\n· 「'+charName+'」的性别是'+gmap[r0.gender]+'，指代时务必用对。'):'';
  const sys='你是一个对话记录的总结助手，只输出要求的内容，不要任何多余的话。\n【身份对照表，必须严格遵守】\n· 「'+charName+'」= 角色，是 AI 扮演的虚构一方。对话里凡是标了【'+charName+'】的，都是角色说的话，开场白（标了"开场白"的那条）也一定是角色说的，绝不是用户说的。\n· 「'+userName+'」= 真人用户。只有标了【'+userName+'】的才是用户说的。'+gtxt+'\n总结时务必分清主语，不要张冠李戴，尤其不要把角色（含开场白）的话写成是用户说的。';
  const text=history.map(m=>{const who=m.role==='user'?userName:charName;const tag=m.greet?'（开场白，由角色'+charName+'说出）':'';return '【'+who+'】'+tag+'：'+sanitizeForAI(m.content)}).join('\n');
  const full=prompt+wc+'\n\n以下是对话记录，请严格按【】里标注的身份来理解谁说了什么：\n'+text;
  if(a.provider==='claude'){const r=await robustFetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':a.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:a.model,max_tokens:mt,system:sys,messages:[{role:'user',content:full}]})});const d=await r.json();const ex=extractAI(d,'claude');if(ex.error)throw new Error(ex.error);return ex.text}
  if(a.provider==='gemini'){const r=await robustFetch(`https://generativelanguage.googleapis.com/v1beta/models/${a.model}:generateContent?key=${a.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:sys}]},contents:[{role:'user',parts:[{text:full}]}],generationConfig:{maxOutputTokens:mt}})});const d=await r.json();const ex=extractAI(d,'gemini');if(ex.error)throw new Error(ex.error);return ex.text}
  let base=a.provider==='deepseek'?'https://api.deepseek.com/v1':(a.baseUrl||'').replace(/\/$/,'');const r=await robustFetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+a.apiKey},body:JSON.stringify({model:a.model,messages:[{role:'system',content:sys},{role:'user',content:full}],max_tokens:mt})});const d=await r.json();const ex=extractAI(d,'openai');if(ex.error)throw new Error(ex.error);return ex.text
}
async function doSummarize(silent){
  const rm=roleMem();if(!rm)return;const c=chat().filter(m=>!m.hidden);
  // 「目前没有长期记忆」含两种：从没总结过 / 总结过又被删空——后者 sumDone 可能仍残留，需归零从头来
  if(!rm.memories.length && rm.sumDone){rm.sumDone=0;}
  const from=rm.sumDone||0;const seg=c.slice(from);if(!seg.length){if(!silent)toast('没有新对话可总结',true);return}
  if(!silent)toast('总结中…');
  // 按【字数预算】分批：每批历史控制在 ~5500 字以内，避免请求过大被网关拒绝
  const BUDGET=5500;
  const batches=[];let cur=[],curLen=0;
  for(const m of seg){const len=(m.content||'').length+12;if(cur.length&&curLen+len>BUDGET){batches.push(cur);cur=[];curLen=0}cur.push(m);curLen+=len}
  if(cur.length)batches.push(cur);
  let res;
  try{
    if(batches.length<=1){
      res=await withRetry(()=>summarizeCall(S.memOpt.sumPrompt,seg),2);
    }else{
      const parts=[];
      for(let i=0;i<batches.length;i++){
        if(!silent)toast('总结中…（第 '+(i+1)+'/'+batches.length+' 批）');
        const piece=await withRetry(()=>summarizeCall(S.memOpt.sumPrompt,batches[i]),2);
        if(piece)parts.push(piece);
      }
      if(parts.length>1){
        const mergePrompt='下面是同一段对话分批生成的多条小结，请按你之前的格式要求把它们融合、去重、按时间顺序整理成连贯的长期记忆，不要丢失关键事件：\n\n'+parts.map((p,i)=>'〔'+(i+1)+'〕\n'+p).join('\n\n');
        try{res=await withRetry(()=>summarizeCall(mergePrompt,[]),2);}catch(e){res=parts.join('\n\n');}
      }else res=parts[0]||'';
    }
  }catch(e){if(!silent)toast(sumErr(e),true);else console.warn('autoSum fail',e);return;}
  if(res){rm.memories.push(res);rm.sumDone=c.length;save();if(!silent){renderMemModalList&&renderMemModalList();toast('已生成记忆')}}
  else if(!silent)toast('总结返回为空，可能被截断，试着调大「最大回复长度」',true);
}
async function doRelation(silent){
  const rm=roleMem();if(!rm)return;const c=chat().filter(m=>!m.hidden);if(!c.length){if(!silent)toast('没有对话',true);return}
  if(!silent)toast('更新档案中…');
  const prompt=S.memOpt.relPrompt+(rm.relation?('\n\n已有档案（在此基础上更新）：\n'+rm.relation):'');
  // 只取最近一段窗口，避免请求过大
  const win=Math.min(c.length,Math.max(S.memOpt.relEvery||30,40));
  let res;
  try{res=await withRetry(()=>summarizeCall(prompt,c.slice(-win)),2);}
  catch(e){if(!silent)toast(sumErr(e),true);else console.warn('autoRel fail',e);return;}
  if(res){rm.relation=res;rm.relDone=c.length;save();if(!silent)toast('已更新关系档案')}
}
async function maybeSummarize(){
  const rm=roleMem();if(!rm)return;const c=chat().filter(m=>!m.hidden);const total=c.length;
  if(S.memOpt.autoSum&&S.memOpt.sumEvery>0&&total-(rm.sumDone||0)>=S.memOpt.sumEvery){try{await doSummarize(true)}catch(e){}}
  if(S.memOpt.autoRel&&S.memOpt.relEvery>0&&total-(rm.relDone||0)>=S.memOpt.relEvery){try{await doRelation(true)}catch(e){}}
}
function getActiveWorldBook(){
  const r=curRole();const list=[];
  (S.worldBook||[]).forEach(w=>{
    if(!w.on)return;
    if(w.scope==='global'){list.push(w)}
    else if(w.scope==='role'&&r&&w.roleId===r.id){list.push(w)}
  });
  return list;
}
function wbKeywordHit(w){
  if(!w.keys||!w.keys.length)return false;
  const floors=w.scanMode==='self'?(w.scanSelf||4):(S.wbScanFloors||4);
  const c=chat().filter(m=>!m.hidden);
  const seg=c.slice(-Math.max(1,floors));
  const text=seg.map(m=>sanitizeForAI(stripTrans(m.content))).join('\n').toLowerCase();
  return w.keys.some(k=>{k=(k||'').trim().toLowerCase();return k&&text.includes(k)});
}
// ===== 权威时间引擎：时间由 App 持有，AI 只读不算 =====
const TIME_UNIT_MS={'分钟':60000,'分':60000,'小时':3600000,'时':3600000,'天':86400000,'日':86400000,'周':604800000,'星期':604800000,'月':2592000000,'年':31536000000};
function storyStartMs(){const v=((S.chatOpt&&S.chatOpt.storyStart)||'').trim();if(v){const t=Date.parse(v);if(!isNaN(t))return t;const t2=Date.parse(v.replace(/-/g,'/'));if(!isNaN(t2))return t2}return Date.now()}
function storyEpoch(){const c=curConvo();if(!c)return storyStartMs();if(c.clock==null)c.clock=storyStartMs();return c.clock}
function fmtStoryTime(ms){const d=new Date(ms);const wd=['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日 '+wd+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
function parseTimeAdvance(txt){
  if(!txt)return 0;
  const m=String(txt).match(/时间推进\s*[：:]\s*\+?\s*(\d+(?:\.\d+)?)\s*(分钟|分|小时|时|天|日|周|星期|个月|月|年)/);
  if(!m)return 0;
  let unit=m[2]==='个月'?'月':m[2];
  const per=TIME_UNIT_MS[unit]||0;return Math.round(parseFloat(m[1])*per);
}
// 解析「本轮经过：+N单位」（兼容旧的「时间推进」），返回毫秒；没有则 null
function parseElapsed(txt){
  if(!txt)return null;
  const m=String(txt).match(/(?:本轮经过|时间推进|经过时间)\s*[：:]\s*\+?\s*(\d+(?:\.\d+)?)\s*(分钟|分|小时|时|天|日|周|星期|个月|月|年)/);
  if(!m)return null;
  let unit=m[2]==='个月'?'月':m[2];
  const per=TIME_UNIT_MS[unit]||0;return Math.round(parseFloat(m[1])*per);
}
// 收到 AI 回复时按「本轮经过」推进一次时钟；AI 漏写则用兜底分钟。返回清理掉标记后的 mind 文本
function applyTimeAdvance(mindTxt){
  if(!(S.chatOpt&&S.chatOpt.timeSysOn))return mindTxt;
  const c=curConvo();if(!c)return mindTxt;
  if(c.clock==null)c.clock=storyStartMs();
  let adv=parseElapsed(mindTxt);
  if(adv==null)adv=((S.chatOpt.timeFallbackMin!=null?S.chatOpt.timeFallbackMin:5))*60000;
  if(adv>0)c.clock+=adv;
  if(typeof refreshStoryClock==='function')refreshStoryClock();
  return String(mindTxt||'').split('\n').filter(l=>!/(?:本轮经过|时间推进|经过时间)\s*[：:]/.test(l)).join('\n').trim();
}

function lastMindFields(){
  const c=chat();
  for(let i=c.length-1;i>=0;i--){
    const m=c[i];
    if(m.role==='assistant'&&m.mind!=null&&m.mind!==''){
      const txt=String(m.mind);
      const fields={};
      txt.split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{
        const ci=Math.min(...['：',':'].map(s=>{const k=l.indexOf(s);return k<0?1e9:k}));
        if(ci>0&&ci<1e9){let k=l.slice(0,ci).trim();const v=l.slice(ci+1).trim();
          if(k.includes('好感'))k='好感度';else if(k.includes('想法')||k.includes('心'))k='想法';else if(k.includes('姿势')||k.includes('动作'))k='姿势';else if(k.includes('时间')||k.includes('日期'))k='时间';
          if(v)fields[k]=v;}
      });
      return Object.keys(fields).length?fields:null;
    }
  }
  return null;
}
function collectInjections(){
  const r=curRole(),u=curUser();
  const buckets={head:[],tail:[],depthMap:{}};
  const put=(pos,depth,txt,order)=>{if(!pos||pos==='off'||!txt||!txt.trim())return;const item={txt:resolveRandomMacros(txt.trim()),order:(order!=null?order:50)};if(pos==='depth'){const d=depth||0;(buckets.depthMap[d]=buckets.depthMap[d]||[]).push(item)}else buckets[pos].push(item)};
  if(r){let gdesc='';if(r.gender==='男')gdesc='男性';else if(r.gender==='女')gdesc='女性';else if(r.gender==='双性')gdesc='双性';else if(r.gender==='其他')gdesc=(r.genderCustom||'性别不定');const gpre=gdesc?('【性别】'+r.roleName+'是'+gdesc+'。\n'):'';put(r.inject||'head',r.depth,gpre+(r.persona||'你是一个友好的语音聊天角色。'),r.order)}
  getActiveWorldBook().forEach(w=>{
    if(!w.content||!w.content.trim())return;
    const trigger=w.constant?true:wbKeywordHit(w);
    if(!trigger)return;
    put(w.pos||'head',w.depth,w.content,w.order);
  });
  // 这里同步了刚刚为你修好的人设顺序参数 u.order 喔
  if(u.userName||u.persona){let t='【对话对象】你正在和'+(u.userName||'对方')+'对话。';if(u.persona&&u.persona.trim())t+=' '+u.persona;put(u.inject||'tail',u.depth,t,u.order??100)}
  if(S.chatOpt.split)put(S.chatOpt.splitInject||'depth',S.chatOpt.splitDepth,'【回复方式】像真人发手机消息那样，一条条简短地说，不要长篇大论。每条用换行分隔，口语自然。线上线下都遵守。');
  if(r&&r.lang&&r.lang.trim()){put(S.chatOpt.transInject||'depth',S.chatOpt.transDepth,'【语言与翻译】你用'+r.lang+'说话。每一条消息写成「'+r.lang+'原文 ||| 简体中文翻译」的格式，用三个竖线 ||| 分隔原文和译文，每条消息一行。')}
  else if(S.chatOpt.trans)put(S.chatOpt.transInject||'depth',S.chatOpt.transDepth,'【翻译】当你用非中文说话时，每条写成「原文 ||| 简体中文翻译」，用三个竖线 ||| 分隔。');
  if(S.emo.on&&S.emo.tpl&&S.emo.tpl.trim())put(S.emo.inject||'depth',S.emo.depth,S.emo.tpl);
  const rm=roleMem();
  if(rm&&rm.memories&&rm.memories.length){const memTxt='【长期记忆】\n'+rm.memories.map((m,i)=>(i+1)+'. '+m).join('\n');put(S.memOpt.sumInject||'head',S.memOpt.sumDepth,memTxt)}
  if(rm&&rm.relation&&rm.relation.trim()){put(S.memOpt.relInject||'head',S.memOpt.relDepth,'【关系档案】\n'+rm.relation)}
  const sts=allStickers();
  if(sts.length){const names=sts.map(s=>s.name).filter(Boolean).join('、');put(S.stickers.inject||'depth',S.stickers.depth,'【表情包 · 严格规则】你可以发表情包，格式：单独一行写 {{sticker:名字}}。\n名字【只能】从下面这份可用清单里【一字不差】地选一个，绝对不许自己编造清单以外的名字，也不许改字。如果没有贴切的，就不发表情、改用文字。\n可用清单：'+names)}
  if(S.voiceMsg&&S.voiceMsg.on&&S.voiceMsg.tpl&&S.voiceMsg.tpl.trim())put(S.voiceMsg.inject||'depth',S.voiceMsg.depth,S.voiceMsg.tpl);
  
  // 心声系统：生成区（这轮让 AI 输出哪些）
  if(S.mind && S.mind.on){
    const md=S.mind;
    const gen=[];
    if(md.genAff) gen.push('好感度：写出当前好感度的具体数值，并在括号里标明较上一轮的变化（例：「52（+3）」或「48（-5）」，首轮可写初始值）。单轮变化幅度绝对不能超过 ±'+(md.affMaxStep||10)+'。');
    if(md.genTho) gen.push('想法：此时心里真实、私密的想法（可以和表面说的话不一致）。');
    if(md.genPos) gen.push('姿势：此时具体的身体姿态、表情或小动作。');
    if(md.genTime){
      gen.push('时间：直接照抄系统在【当前故事时间】里给你的时间，一个字都不要改、不要自己推算或累加。');
    }
    if(gen.length){
      let text;
      if(md.prompt && md.prompt.trim()){
        text=md.prompt.trim()+'\n\n本轮需要输出的字段（每项一行，放进 <mind> 标签内）：\n'+gen.join('\n');
      }else{
        text='【心声系统 · 输出规则】在每次回复的【最末尾】，用 <mind>…</mind> 标签输出你（角色）此刻的内部真实状态，每项单独一行：\n'+gen.join('\n')+'\n这段内容【绝不能】出现在聊天气泡正文里，只能放在 <mind> 与 </mind> 之间，并且务必写好结尾的 </mind>。\n你也可以在 <mind> 里对用户最新消息用 {{react:emoji}} 表态（如 {{react:\u2764\ufe0f}}），只用 \u2764\ufe0f \U0001f602 \U0001f62e \U0001f622 \U0001f621 \U0001f44d \U0001f525，情绪合适才加，不要每次都加。';
      }
      put(md.inject||'depth', md.depth||0, text, md.order ?? 100);
    }
    // 注入区：把【上一轮】生成的状态回传给 AI，保证连贯（只取最近一轮）
    const last=lastMindFields();
    if(last){
      const carry=[];
      if(md.injAff && last['好感度']!=null) carry.push('好感度：'+last['好感度']);
      if(md.injTho && last['想法']!=null) carry.push('想法：'+last['想法']);
      if(md.injPos && last['姿势']!=null) carry.push('姿势：'+last['姿势']);
      if(md.injTime && last['时间']!=null) carry.push('时间：'+last['时间']);
      if(carry.length){
        put(md.inject||'depth', md.depth||0, '【承接上一轮状态 · 必须延续，不要凭空跳变】上一轮结束时你的状态是：\n'+carry.join('\n'), (md.order ?? 100)-1);
      }
    }
  }

  // ── 时间引擎：维护一条故事时间线，AI 每轮报「本轮经过」，系统推进一次 ──
  {
    const on=(S.chatOpt&&S.chatOpt.timeSysOn);
    const nowMs=on?storyEpoch():Date.now();
    const dstr=fmtStoryTime(nowMs);
    let block='【当前故事时间】现在是 '+dstr+'。请直接采用这个时间自然对话（问候、作息、白天黑夜、节日等），不要自己改写或重新推算具体数字。';
    if(on){
      block+='\n【本轮经过 · 必填】回复时请在 <mind> 里【单独一行】写出这一轮故事时间过去了多久，格式「本轮经过：+N单位」（单位只能是 分钟/小时/天/周/月）。普通聊天就写几分钟（如「本轮经过：+5分钟」）；若本轮剧情出现明显跳跃（你或对方提到「过了三天」「第二天」「一周后」「睡了一觉」「下班后」等），就写对应的量（如「本轮经过：+1周」）。它表示“这一轮过去的时长”，不是累计，每轮都要重新写、绝不要漏。不要在正文气泡里写具体日期数字。';
    }
    put('depth',0,block,1);
  }

  // ── 关系推进 ──
  const _rpt = collectRelationPush();
  if (_rpt) put('depth',0,_rpt,5);
  // ── 破限注入 ──
  if(S.jailbreak && S.jailbreak.on && S.jailbreak.tpl && S.jailbreak.tpl.trim()){
    put(S.jailbreak.inject||'head', S.jailbreak.depth||0, S.jailbreak.tpl.trim(), S.jailbreak.order ?? 1);
  }
  // ── 尾部破限注入 ──
  if(S.jailbreakTail && S.jailbreakTail.on && S.jailbreakTail.tpl && S.jailbreakTail.tpl.trim()){
    put(S.jailbreakTail.inject||'tail', S.jailbreakTail.depth||0, S.jailbreakTail.tpl.trim(), S.jailbreakTail.order ?? 999);
  }

  // ── 异地 / 网恋模式 ──
  if(S.longDistance && S.longDistance.on){
    put('depth',0,'【关系设定 · 异地/网恋】你和对方目前身处不同的地方，距离很远，现实中【见不了面】、无法当面接触或发生线下身体接触。你们只能通过线上方式联系：文字消息、语音、视频通话、转账、发照片等。请始终遵守这个设定，不要安排两人当面见面或线下相处的剧情，把互动都放在「隔着屏幕」的状态下展开。',2);
  }

  // ── 已读不回（AI 自主决定）──
  if(S.chatOpt.readNoReply){
    put('depth',0,'【已读不回机制】如果此刻你（角色）因为情绪、心情、矛盾或其它原因，真的不想回复对方，你可以选择「已读不回」：在回复中【只】输出一个标记 <noreply> ，不要写任何其它内容。系统会把对方消息标为「已读」但不显示你的回复。请克制使用，只在性格和情绪合理时才这样做。',2);
  }

  // ── 角色自主用表情包 ──
  if(S.chatOpt.charStickers!==false){
    const sts2=allStickers();
    if(sts2.length){put('depth',0,'【表情包自主使用】请根据你的性格、当前情绪和聊天风格，自然地决定要不要发表情包，该发就发、不该发就不发，不要每条都发。',3)}
  }
  // ── 角色自主用颜文字/emoji ──
  if(S.chatOpt.charKaomoji!==false){
    put('depth',0,'【颜文字与Emoji】你可以在消息里自然地加入颜文字（如 (´▽)、(◕‿◕)）或 emoji（如 😊🥺🔥），但要严格符合你的性格和说话风格——高冷的人少用、活泼的人多用，按情绪和人设合理选择，不要滥用。',4);
  }
  // ── 角色自主改状态 ──
  if(S.chatOpt.autoStatus!==false){
    put('depth',0,'【自定义状态】当你（角色）的状态或心情发生变化时，可以更新顶部状态文字：在回复中单独一行写 {{status:新状态}}（例如 {{status:在忙}}、{{status:有点累了}}、{{status:想你了}}）。该标记不会作为聊天气泡显示，只更新顶部状态。按情绪自然使用，不必每次都改。',5);
  }
  // ── 旁白模式 ──
  if(S.chatOpt&&S.chatOpt.narrateOn){
    put('depth',0,'【旁白模式已开启】描写动作、神态、场景时用中文圆括号包裹，如（轻轻叹了口气）。括号内内容会渲染为居中旁白提示，不是气泡，不要在正文里单独一行写动作描写。',3);
  }
  // ── 动作系统 ──
  if(S.chatOpt&&S.chatOpt.actionModeOn!==false){
    put('depth',0,'【动作系统】在对话消息里，用中文圆括号 () 自然地穿插动作、表情、神态描写，如「（低头轻笑）没什么。」或「好久不见。（向你走过来）」。动作要简短、符合人设，不要大段动作描述，先说话再加动作或穿插其中，口语自然。',4);
  }else{
    // 关掉动作系统时：动作只能以旁白形式出现
    put('depth',0,'【动作模式已关闭】不要在对话气泡里用括号写动作描写。若需要描写动作或场景，使用单独旁白段落（系统会把括号内容渲染为旁白）。',4);
  }
  // ── 气泡延迟提示 ──
  if(S.chatOpt&&S.chatOpt.typingDelay){
    put('depth',0,'【气泡延迟】系统已开启「正在输入」效果，对方会先看到你在打字的提示，延迟后才收到消息。这会让对话更真实，你不需要特别提及这一点，正常回复即可。',7);
  }
  put('depth',0,'【拍一拍】当情绪到了，你可以主动「拍一拍」对方：在回复中单独一行写 {{pat:动作}}（例如 {{pat:拍了拍你的头}}、{{pat:拍了拍你}}），动作内容你自由发挥，符合人设即可。该标记会显示为一条拍一拍提示。',6);
  // ── 撤回可见性 ──
  if(S.chatOpt.recallSee){
    put('depth',0,'【撤回可见】对话里出现撤回提示时，系统会把被撤回的内容也给你（你在对方撤回前刚好看到了）。你可以自然地回应，但不要原样复述被撤回的原话。',8);
  }else{
    put('depth',0,'【撤回不可见内容】对话里出现撤回提示时，你只知道发生了撤回，但看不到具体内容，可以自然地回应或好奇地问一句，不要凭空编造被撤回的内容。',8);
  }
  // ── AI 表情表态 ──
  if(S.chatOpt.charReact!==false){
    // 表态已在心声系统里处理，这里只在心声关闭时单独添加
    if(!(S.mind&&S.mind.on)){
      put('depth',0,'【表情表态】当你（角色）对某条消息有强烈情绪反应时，可以在回复里附上一个表态：在消息末尾单独一行写 {{react:表情}}（只用 ❤️ 😂 😮 😢 😡 👍 🔥，情绪合适才用，不要每条都加）。',9);
    }
  }

  const sortBucket=arr=>arr.sort((a,b)=>a.order-b.order).map(x=>x.txt);
  const out={head:sortBucket(buckets.head),tail:sortBucket(buckets.tail),depthMap:{}};
  Object.keys(buckets.depthMap).forEach(d=>{out.depthMap[d]=sortBucket(buckets.depthMap[d])});
  return out;
}
let _injCache=null,_injCacheKey='';
function collectInjectionsOnce(){
  // 用对话长度+时间戳作 cache key，同一轮 send/runAI 内只算一次
  const key=(chat().length)+'|'+(curRole()&&curRole().id||'')+'|'+(S.chatOpt.timeSysOn?storyEpoch():'real');
  if(_injCache&&_injCacheKey===key)return _injCache;
  _injCache=collectInjections();_injCacheKey=key;return _injCache;
}
function buildSystem(){const b=collectInjectionsOnce();return [...b.head,...b.tail].join('\n\n')}
function buildDepthNote(){const b=collectInjectionsOnce();const all=[];Object.keys(b.depthMap).sort((x,y)=>y-x).forEach(d=>all.push(...b.depthMap[d]));return all.join('\n\n')}
function carriedMessages(){const c=chat().filter(m=>!m.hidden&&!m.recalled);const n=S.memOpt.carry||20;return n>0?c.slice(-n):c.slice()}
function sanitizeForAI(content){
  return content
    .replace(/\{\{voice:([\s\S]*?)\}\}/g,'（语音条）$1')
    .replace(/\{\{voice:([^\n]*)$/g,'（语音条）$1')
    .replace(/\{\{card:([\s\S]*?)\}\}/g,(m,p1)=>{const segs=p1.split('|');const c=(segs[0]||'').trim();const loc=(segs[1]||'').trim();const date=(segs[2]||'').trim();return '（发了一张相片记忆卡，内容："'+c+'"'+(loc?'，地点：'+loc:'')+(date?'，时间：'+date:'')+'）'})
    .replace(/\{\{img:([\s\S]*?)\}\}/g,(m,p1)=>{const i=p1.indexOf('|');let head=(i>=0?p1.slice(0,i):p1).trim();const cap=i>=0?p1.slice(i+1).trim():'';if(/^(data:image|https?:)/.test(head))return cap?'（发了一张图片，意思是：'+cap+'）':'（发了一张图片）';return '（发了一张图片，内容是：'+(cap||head)+'）'})
    .replace(/\{\{img:([^\n]*)$/g,'（发了一张图片）')
    .replace(/\{\{transfer:([\s\S]*?)\}\}/g,(m,p1)=>{const s=p1.split('|');const amt=(s[0]||'').trim();const note=(s[1]||'').trim();return '（发起了一笔转账，金额 ¥'+amt+(note?'，备注：'+note:'')+'）'})
    .replace(/\{\{location:([\s\S]*?)\}\}/g,(m,p1)=>{const s=p1.split('|');const name=(s[0]||'').trim();const addr=(s[1]||'').trim();return '（分享了一个位置：'+name+(addr?'（'+addr+'）':'')+'）'})
    .replace(/\{\{gift:([\s\S]*?)\}\}/g,(m,p1)=>{const s=p1.split('|');const name=(s[0]||'').trim();const note=(s[1]||'').trim();return '（送出了一份礼物：'+(name||'礼物')+(note?'，附言：'+note:'')+'）'})
    .replace(/\u0003PAT:([^\u0003]+)\u0003/g,'（拍一拍：$1）')
    .replace(/\u0004NARR:([^\u0004]*)\u0004/g,'（旁白：$1）')
    .replace(/\{\{sticker:([^}]+)\}\}/g,'（表情：$1）')
    .replace(/\[sticker:([^\]]+)\]/g,'（表情：$1）');
}
// 解析 {{random:选项1|选项2|选项3}} 宏（兼容 SillyTavern）
function resolveRandomMacros(text){
  return String(text||'').replace(/\{\{random:([^}]+)\}\}/gi,(_,opts)=>{
    const choices=opts.split('|').map(s=>s.trim()).filter(Boolean);
    if(!choices.length)return '';
    return choices[Math.floor(Math.random()*choices.length)];
  });
}
function buildMessages(){
  const rawMsgs=chat().filter(m=>!m.hidden);
  const _n=S.memOpt&&S.memOpt.carry||20;
  const _win=_n>0?rawMsgs.slice(-_n):rawMsgs.slice();
  const msgs=_win.map(m=>{
    if(m.recalled){const _w=m.role==='user'?(curUser().userName||'你'):(curRole()&&curRole().roleName||'对方');
      if(S.chatOpt.recallSee){const _c=sanitizeForAI(stripTrans(m._rc||''))||'（空白）';return{role:m.role==='user'?'user':'assistant',content:'（系统：'+_w+'撤回了一条消息，但你在对方撤回前刚好瞥见了，内容是：「'+_c+'」。你可以自然地回应，但不要原样复述这句话。）'}}
      return{role:m.role==='user'?'user':'assistant',content:'（系统：'+_w+'撤回了一条消息，你知道发生了撤回但看不到具体内容）'}}
    let content=m.content;
    if(m.role==='assistant')content=toSub(content,'prompt');
    content=sanitizeForAI(content);
    if(m.quote){content='（回复 '+m.quote.who+'：「'+m.quote.text+'」）\n'+content}
    if(!content || content.trim()==='') content='（无言）'; // 兼容DeepSeek等严禁空消息的模型
    return{role:m.role,content};
  });
  const b=collectInjectionsOnce();
  // 省 token：只在最近 N 轮里保留时间标记，更早的 AI 消息把残留的时间行剥掉
  {const _keepN=(S.chatOpt&&S.chatOpt.timeRecentN!=null)?S.chatOpt.timeRecentN:2;let _ac=0;for(let i=msgs.length-1;i>=0;i--){if(msgs[i].role==='assistant'){_ac++;if(_ac>_keepN)msgs[i].content=msgs[i].content.replace(/(?:本轮经过|时间推进|经过时间)\s*[：:]\s*\+?\s*[\d.]+\s*[^\n，。]*/g,'').replace(/\n{2,}/g,'\n').trim();}}}
  const depths=Object.keys(b.depthMap).map(Number).sort((x,y)=>y-x);
  depths.forEach(d=>{const txt=b.depthMap[d].join('\n\n');const note={role:'user',content:'（系统指令，请遵守，不要回复本段）\n'+txt};const pos=Math.max(0,msgs.length-d);msgs.splice(pos,0,note)});
  return msgs;
}
function stripTrans(t){return t.split('\n').map(l=>{const i=l.indexOf('|||');return i>=0?l.slice(0,i).trim():l}).join('\n')}
function stripVoiceTags(t){return t.replace(/\{\{voice:([\s\S]*?)\}\}/g,'$1').replace(/\{\{card:[\s\S]*?\}\}/g,'').replace(/\{\{img:[\s\S]*?\}\}/g,'').replace(/\{\{sticker:[^}]+\}\}/g,'').replace(/\n{2,}/g,'\n').trim()}
// 朗读用文本：展开语音内容→套用「显示」向正则（用户删语气标记的规则在此生效）→非 v3 引擎去掉 [语气] 方括号标记
function voiceText(raw){
  let o=String(raw||'');
  o=o.replace(/<mind>[\s\S]*?<\/mind>/gi,'').replace(/<mind>[\s\S]*$/i,'');
  o=stripTrans(o);
  o=o.replace(/\{\{voice:([\s\S]*?)\}\}/g,'$1').replace(/\{\{voice:[^\n]*$/g,m=>m.replace(/^\{\{voice:/,'').replace(/\}+\s*$/,''));
  try{
    for(const r of curRegex().rules){
      if(!r)continue;const rule=(typeof r==='string')?{find:r,replace:'',on:true,target:'both'}:r;
      if(rule.on===false)continue;const tg=rule.target||'both';if(tg==='prompt')continue;
      const sc=rule.applyScope||'chat';if(sc!=='all'&&sc!=='chat')continue;
      const pr=parseRegexRule(rule.find);if(!pr.src)continue;
      o=o.replace(new RegExp(pr.src,pr.flags),rule.replace||'');
    }
  }catch(e){}
  o=o.replace(/\{\{sticker:[^}]+\}\}/g,'').replace(/\[sticker:[^\]]+\]/g,'').replace(/\{\{card:[\s\S]*?\}\}/g,'').replace(/\{\{img:[\s\S]*?\}\}/g,'');
  if((curVoice().engine||'')!=='elevenlabs')o=o.replace(/\[[^\]]*\]/g,'');
  return o.replace(/[ \t]{2,}/g,' ').replace(/\n{2,}/g,'\n').trim();
}
// 语音条上显示给人看的文字：去掉 [语气] 标记，保留对话
function voiceCaption(phrase){return String(phrase||'').replace(/\[[^\]]*\]/g,'').replace(/[ \t]{2,}/g,' ').trim()}
function parseRegexRule(find){
  find=find||'';
  const m=find.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
  if(m){let fl=m[2]||'';if(!fl.includes('g'))fl+='g';return{src:m[1],flags:fl}}
  return{src:find,flags:'g'};
}
function toSub(raw,scene,area){
  scene=scene||'display';
  area=area||'chat'; // chat=聊天正文 / mind=心声内容
  let o=raw;
  // 解析 {{random:…}} 宏（无论哪种 scene 都处理，避免原样显示）
  o=resolveRandomMacros(o);
  if(scene==='display'){
    // 清除完整 <mind>…</mind> 块
    o=o.replace(/<mind>[\s\S]*?<\/mind>/gi,'');
    // 清除未闭合（被截断）的 <mind> 及其后内容
    o=o.replace(/<mind>[\s\S]*$/i,'');
    // 清除旧数据遗留的孤立标签
    o=o.replace(/^<\/?mind>$/gim,'').replace(/^<\/?mind>\s*/gim,'');
    // thinking 标签折叠（占位符，由 renderBubbleContent 处理）
    o=o.replace(/<thinking>([\s\S]*?)<\/thinking>/gi,(m,inner)=>'\u0002THINK:'+btoa(unescape(encodeURIComponent(inner)))+'\u0002');
  }

  const holds=[];
  const hold=re=>{o=o.replace(re,m=>{holds.push(m);return '\u0001'+(holds.length-1)+'\u0001'})};
  hold(/\{\{sticker:[^}]+\}\}/g);
  hold(/\{\{voice:[\s\S]*?\}\}/g);hold(/\{\{voice:[^\n]*$/g);
  hold(/\{\{card:[\s\S]*?\}\}/g);hold(/\{\{card:[^\n]*$/g);
  hold(/\{\{img:[\s\S]*?\}\}/g);hold(/\{\{img:[^\n]*$/g);
  for(const r of curRegex().rules){
    if(!r)continue;
    const rule=(typeof r==='string')?{find:r,replace:'',on:true,target:'both'}:r;
    if(rule.on===false)continue;
    const tg=rule.target||'both';
    if(scene==='display'&&tg==='prompt')continue;
    if(scene==='prompt'&&tg==='display')continue;
    // 作用范围过滤：all=全部 / chat=只聊天 / mind=只心声
    const sc=rule.applyScope||'chat';
    if(sc!=='all'&&sc!==area)continue;
    const {src,flags}=parseRegexRule(rule.find);
    if(!src)continue;
    try{o=o.replace(new RegExp(src,flags),rule.replace||'')}catch(e){}
  }
  o=o.replace(/\u0001(\d+)\u0001/g,(m,i)=>holds[+i]||'');
  return o.replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
function splitMessages(raw){if(!S.chatOpt.split)return[raw];let parts=raw.split(/\n{2,}/).flatMap(p=>p.split(/\n/)).map(s=>s.trim()).filter(Boolean);return parts.length?parts:[raw]}
function splitRawIntoMessages(raw){
  if(!S.chatOpt.split)return[raw];
  let parts=raw.split(/\n{2,}/).flatMap(p=>p.split(/\n/)).map(s=>s.trim()).filter(Boolean);
  parts=parts.filter(p=>{const sub=toSub(p);return sub.trim()!==''||isSpecialPart(p)});
  return parts.length?parts:[raw];
}
function pushAIReply(raw){
  // 剥离 <mind> 块：只要出现 <mind> 就把它及后面所有内容从气泡剥掉（即使被截断没写 </mind>）
  const mindMatch=raw.match(/<mind>([\s\S]*?)(?:<\/mind>|$)/i);
  let mindData=mindMatch?mindMatch[1].replace(/<\/?mind>/gi,'').trim():'';
  // 权威时间引擎：本轮时间推进只在这里应用一次，并清掉「时间推进」标记
  mindData=applyTimeAdvance(mindData);
  // AI 表态解析
  const _rm=[...raw.matchAll(/\{\{react:([^}]+)\}\}/gi)];
  if(_rm.length){const _lu=chat().slice().reverse().find(x=>x.role==='user'&&!x.hidden&&!x.recalled);if(_lu){const _em=_rm[_rm.length-1][1].trim();const _rr=_getR(_lu);_rr[_em]=(_rr[_em]||0)+1;}}
  let cleanRaw=raw.replace(/<mind>[\s\S]*$/i,'').replace(/\{\{react:[^}]+\}\}/gi,'').trim();
  // 处理 {{status:新状态}}（更新顶部状态，不进气泡）
  const statusMatches=[...cleanRaw.matchAll(/\{\{status:([^}]+)\}\}/gi)];
  if(statusMatches.length){
    const newStatus=statusMatches[statusMatches.length-1][1].trim();
    const r=curRole();if(r){r.customStatus=newStatus;refreshTop()}
    cleanRaw=cleanRaw.replace(/\{\{status:[^}]+\}\}/gi,'').trim();
  }
  // 处理 {{pat:动作}}（拍一拍，转成系统提示气泡）
  cleanRaw=cleanRaw.replace(/\{\{pat:([^}]+)\}\}/gi,(m,act)=>'\u0003PAT:'+act.trim()+'\u0003');
  let _nr = cleanRaw;
  if (S.chatOpt && S.chatOpt.narrateOn) {
    _nr = cleanRaw.replace(/[（(]([^）)\n]{1,120})[）)]/g, (_,t) => '\u0004NARR:'+t+'\u0004');
  }
  const c=chat();const parts=splitRawIntoMessages(_nr);const base=Date.now();
  parts.forEach((p,i)=>c.push({role:'assistant',content:p,t:base+i,grp:base,mind:i===0?mindData:undefined}));
}

// 粗估 token 数（按字符数/4 for English, /2 for CJK 混合）
function estimateTokens(text){
  if(!text)return 0;
  let cjk=0,other=0;
  for(const ch of text){/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)?cjk++:other++}
  return Math.ceil(cjk/1.5+other/4);
}
$('dbgToken').onclick=()=>{
  pullSettings();
  const o=$('dbgTokenOut');o.style.display='block';
  const sys=buildSystem();const msgs=buildMessages();
  const sysT=estimateTokens(sys);
  const msgsT=msgs.reduce((s,m)=>s+estimateTokens(m.content),0);
  const total=sysT+msgsT+4; // 4 for roles/overhead
  const r=curRole();const allC=chat().filter(m=>!m.hidden);
  const totalHist=allC.reduce((s,m)=>s+estimateTokens(m.content),0);
  o.textContent=`本次预计输入 token（估算）：
系统提示：约 ${sysT} tokens
携带消息：约 ${msgsT} tokens
━━━━━━━━━━━━━━
本次合计：约 ${total} tokens

参考：
当前对话历史总计：约 ${totalHist} tokens（${allC.length} 条）
携带最近：${S.memOpt.carry||20} 条（可在记忆设置里改）

* 以上为粗估，实际以各平台计费为准`;
};

// 头像大小滑块
$('avatarSize').addEventListener('input',()=>{
  const v=+$('avatarSize').value||42;
  $('avSzVal').textContent=v+'px';
  S.chatOpt.avatarSize=v;
  applyAvatarSize(v);save();
});
function applyAvatarSize(v){
  document.documentElement.style.setProperty('--av-sz',(v||42)+'px');
}

// 全局聊天背景按钮
$('globalBgPick').onclick=()=>pickImage(d=>{S.globalBg=d;setBg($('globalBgThumb'),d);save();refreshTop();toast('全局背景已设置')});
$('globalBgClear').onclick=()=>{S.globalBg='';setBg($('globalBgThumb'),'');save();refreshTop();toast('已清除全局背景')};
$('apBgPick')&&($('apBgPick').onclick=()=>pickImage(d=>{S.globalBg=d;setBg($('apBgThumb'),d);save();refreshTop();if(typeof syncAppearance==='function')syncAppearance();toast('背景已设置')}));
$('apBgClear')&&($('apBgClear').onclick=()=>{S.globalBg='';setBg($('apBgThumb'),'');save();refreshTop();if(typeof syncAppearance==='function')syncAppearance();toast('已清除背景')});

$('dbgSystem').onclick=()=>{
  pullSettings();const o=$('dbgSystemOut');o.style.display='block';
  try {
      const sys=buildSystem();
      const msgs=buildMessages();
      let out='════ 系统提示（system）════\n'+(sys||'（空）')+'\n\n';
      out+='════ 实际消息序列（含深度注入）════\n';
      msgs.forEach((m,i)=>{out+='['+(i+1)+'] '+m.role+'：\n'+String(m.content)+'\n\n'});
      // 增加实际发给大模型的最终 JSON 结构展示
      out+='\n════ 发送给大模型的 Messages 数组 ════\n'+JSON.stringify(msgs, null, 2);
      o.textContent=out;
  } catch(e) {
      o.textContent='发生错误：'+e.message;
  }
};
$('dbgRegex').onclick=()=>{const o=$('dbgRegexOut');o.style.display='block';o.textContent='过滤后字幕：\n'+toSub($('dbgRegexIn').value)+'\n\n（语音仍用原文）'};
$('dbgCarry').onclick=()=>{pullSettings();const o=$('dbgCarryOut');o.style.display='block';const rm=roleMem();const carried=carriedMessages();let s='当前对话：'+(curConvo()?curConvo().title:'无')+'\n携带最近消息条数：'+(S.memOpt.carry||20)+'\n实际本轮携带：'+carried.length+' 条\n';s+='\n长期记忆（'+(rm&&rm.memories?rm.memories.length:0)+' 条）：\n'+((rm&&rm.memories&&rm.memories.length)?rm.memories.map((m,i)=>(i+1)+'. '+m).join('\n'):'（无）');s+='\n\n关系档案：\n'+((rm&&rm.relation)?rm.relation:'（无）');o.textContent=s};

let stTab='global';
function roleStickerKey(){const r=curRole();return r?r.id:null}
function stCurList(){if(stTab==='global')return S.stickers.global;const k=roleStickerKey();if(!k)return[];if(!S.stickers.perRole[k])S.stickers.perRole[k]=[];return S.stickers.perRole[k]}
function allStickers(){const k=roleStickerKey();const per=(k&&S.stickers.perRole[k])||[];return S.stickers.global.concat(per)}
function findSticker(name){const n=(name||'').trim();return allStickers().find(s=>s.name===n)}

$('btnSticker').onclick=()=>{if(!hasRole()){toast('请先新建角色',true);return}switchStickerTab('sticker');$('pickScrim').classList.add('show');$('stickerPicker').classList.add('show')};
function closeStickerPicker(){$('stickerPicker').classList.remove('show');$('pickScrim').classList.remove('show')}
$('stClose').onclick=closeStickerPicker;
$('aiReplyBar').onclick=openAiReply;
$('aiRepClose').onclick=closeAiReply;
$('aiRepAll').onclick=genAllAiReplies;

// ===== 颜文字 & Emoji =====
const KAOMOJI_LIST=[
  '(´▽`ʃƪ)','(●´ω｀●)','(◕‿◕✿)','(≧▽≦)','(｡♥‿♥｡)','(っ˘ω˘ς )','(*´艸｀*)','(⁄ ⁄•⁄ω⁄•⁄ ⁄)',
  '(。•́︿•̀。)','(｡ŏ﹏ŏ)','(´；ω；`)','(/ω＼)','(╥_╥)','(つ°ヮ°)つ','(ง •_•)ง','(≧ω≦)',
  '( ˘ω˘ )','(´-ω-`)','(ΦзΦ)','(>人<)','(｀皿´)','(≖_≖ )','(눈_눈)','(╯°□°）╯',
  '( ˶ˆ꒳ˆ˵ )','(∩˃ω˂∩)','(˘³˘)♡','♡(>ᴗ•)','(づ￣ ³￣)づ','~(˘▾˘~)','(¬‿¬)','(￢‿￢ )',
  '(*ﾟ∀ﾟ*)','(´ε｀)','( ´•ω•` )','눈_눈','(っ•̀ω•́)っ✂╰⋃╯','d(ŐдŐ๑)','Σ(っ°Д°;)っ','(⊙_⊙)'
];
const EMOJI_LIST=[
  '😊','😂','🥺','😭','😍','🥰','😘','🤗','🤭','😏','😒','😔','😢','😡','🥱','😴',
  '👀','💀','✨','💕','💔','❤️','🔥','💯','👍','👎','🙏','💪','🤝','👋','🫶','💅',
  '🎉','🎊','🌸','🍀','☁️','⭐','🌙','💫','🎵','🎶','💌','📱','💬','👁️','🫠','🥹'
];
let stTab2='sticker';
function renderEmojiGrid(list,isFace){
  const g=$('emojiGrid');g.style.setProperty('display','grid','important');$('stGrid').style.setProperty('display','none','important');
  g.className='emoji-grid'+(isFace?' kaomoji':'');
  g.innerHTML='';
  list.forEach(em=>{
    const btn=document.createElement('button');
    btn.className='emoji-cell'+(isFace?' kao':'');
    btn.textContent=em;
    btn.onclick=()=>{
      const txt=$('input');txt.value+=em;txt.dispatchEvent(new Event('input'));txt.focus();
    };
    g.append(btn);
  });
}
function switchStickerTab(tab){
  stTab2=tab;
  // tab: sticker=表情包 / kaomoji=颜文字 / emoji=Emoji
  ['Sticker','Kaomoji','Emoji'].forEach(t=>{
    const btn=$('stTab'+t);
    if(btn)btn.classList.toggle('active',('st'+t)===('st'+tab.charAt(0).toUpperCase()+tab.slice(1)));
  });
  if(tab==='sticker'){$('emojiGrid').style.setProperty('display','none','important');$('stGrid').style.setProperty('display','grid','important');renderStickerPicker()}
  else if(tab==='kaomoji'){renderEmojiGrid(KAOMOJI_LIST,true)}
  else{renderEmojiGrid(EMOJI_LIST,false)}
}
$('stTabSticker').onclick=()=>switchStickerTab('sticker');
$('stTabKaomoji').onclick=()=>switchStickerTab('kaomoji');
$('stTabEmoji').onclick=()=>switchStickerTab('emoji');
function squareStickers(container){requestAnimationFrame(()=>{container.querySelectorAll('.stbox').forEach(bx=>{const w=bx.clientWidth;if(w){bx.style.paddingTop='0';bx.style.height=w+'px'}})})}
function renderStickerPicker(){const g=$('stGrid');g.innerHTML='';const list=allStickers();if(!list.length){g.innerHTML='<div class="note" style="grid-column:1/-1">还没有表情，点「管理」上传。</div>';return}list.forEach(s=>{const c=document.createElement('div');c.className='st-cell';c.innerHTML=`<div class="stbox"><img src="${s.url}" alt=""></div><div class="nm">${s.name||''}</div>`;c.onclick=()=>{
    const content = '{{sticker:'+s.name+'}}';
    if(roleSend) {
        chat().push({role:'assistant',content,t:Date.now(),_rolePlay:true});
    } else {
        chat().push({role:'user',content,t:Date.now()});
    }
    save();closeStickerPicker();renderThread();
    if(!roleSend){
        if(S.chatOpt.autoReply!==false)runAI();else showReplyBtn();
    }
};g.append(c)});squareStickers(g)}
$('stMgr').onclick=()=>{closeStickerPicker();openStickerPanel()};
function openStickerPanel(){stTab='global';document.querySelectorAll('[data-sttab]').forEach(t=>t.classList.toggle('active',t.dataset.sttab==='global'));$('stScope').textContent='所有角色可用的通用表情。AI 靠「名字」识别和发送。';if(!S.stickers.inject)S.stickers.inject='depth';fillInject($('stInject'),S.stickers.inject);$('stDepth').value=S.stickers.depth??0;bindDepth($('stInject'),$('stDepth'));renderStManage();$('stickerPanel').classList.add('show')}
$('stInjectSave').onclick=()=>{S.stickers.inject=$('stInject').value;S.stickers.depth=+$('stDepth').value||0;save();toast('表情注入设置已保存')};
$('stBack').onclick=()=>$('stickerPanel').classList.remove('show');
document.querySelectorAll('[data-sttab]').forEach(t=>t.onclick=()=>{document.querySelectorAll('[data-sttab]').forEach(x=>x.classList.remove('active'));t.classList.add('active');stTab=t.dataset.sttab;$('stScope').textContent=stTab==='global'?'所有角色可用的通用表情。AI 靠「名字」识别和发送。':('仅当前角色「'+(curRole()?curRole().roleName:'')+'」可用。');renderStManage()});
function renderStManage(){const box=$('stManageGrid');box.innerHTML='';const list=stCurList();list.forEach((s,i)=>{const c=document.createElement('div');c.className='st-mcell';c.innerHTML=`<div class="stbox"><img src="${s.url}" alt=""></div><div class="nm">${s.name||''}</div><button class="rm">×</button>`;c.querySelector('.rm').onclick=()=>{list.splice(i,1);save();renderStManage()};c.querySelector('img').onclick=()=>{const n=prompt('表情名字（AI 靠它识别）：',s.name);if(n!=null){s.name=n.trim();save();renderStManage()}};box.append(c)});squareStickers(box)}
$('stAdd').onclick=()=>pickImage(d=>{const n=prompt('给这个表情起个名字（AI 靠它识别）：','');if(n==null)return;stCurList().push({name:n.trim()||'表情',url:d});save();renderStManage()});
$('stBatch').onclick=()=>{$('batchText').value='';$('batchScopeName').textContent=stTab==='global'?'通用表情包':('角色专属（'+(curRole()?curRole().roleName:'')+'）');$('batchScrim').classList.add('show');$('batchModal').classList.add('show')};
$('batchCancel').onclick=()=>{$('batchModal').classList.remove('show');$('batchScrim').classList.remove('show')};
$('batchScrim').onclick=()=>{$('batchModal').classList.remove('show');$('batchScrim').classList.remove('show')};
function parseStickerLines(text){const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);let n=0;lines.forEach(l=>{const i=l.indexOf(':');const j=l.indexOf('：');const k=(i<0)?j:(j<0?i:Math.min(i,j));if(k<0)return;const name=l.slice(0,k).trim(),url=l.slice(k+1).trim();if(name&&url){stCurList().push({name,url});n++}});return n}
$('batchOk').onclick=()=>{const n=parseStickerLines($('batchText').value);save();renderStManage();$('batchModal').classList.remove('show');$('batchScrim').classList.remove('show');toast('导入了 '+n+' 个')};
$('batchFileBtn').onclick=()=>$('stFilePick').click();
$('stFilePick').onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{let n=0;const txt=rd.result;try{
  if(f.name.toLowerCase().endsWith('.json')){const data=JSON.parse(txt);if(Array.isArray(data)){data.forEach(o=>{const name=(o.name||o.意思||o.意義||'').toString().trim();const url=(o.url||o.URL||o.link||'').toString().trim();if(name&&url){stCurList().push({name,url});n++}})}else if(data&&typeof data==='object'){Object.keys(data).forEach(k=>{const url=(data[k]||'').toString().trim();if(k&&url){stCurList().push({name:k.trim(),url});n++}})}}
  else{n=parseStickerLines(txt)}
  save();renderStManage();$('batchModal').classList.remove('show');$('batchScrim').classList.remove('show');toast('从文件导入了 '+n+' 个')
}catch(err){toast('文件解析失败：'+err.message,true)}};rd.readAsText(f);e.target.value=''};

// ===== 陪伴系统 =====
$('btnCompanion').onclick=()=>{if(!hasRole()){toast('先选个角色',true);return}openCompanion()};
function openCompanion(){
  const r=curRole(),u=curUser(),c=curConvo();const msgs=c?c.msgs.filter(m=>!m.hidden):[];
  $('compTitle').textContent=(r.roleName||'角色')+' · '+(c?c.title:'');
  setAvDisp($('compAvMe'),u.avatar,u.userName);setAvDisp($('compAvAi'),r.avatar,r.roleName);
  const times=msgs.map(m=>m.t).filter(Boolean);
  let days=0,first=c?c.createdAt:Date.now();
  if(times.length){first=Math.min(first,...times);const last=Math.max(...times);days=Math.max(0,Math.floor((last-first)/86400000))}
  const fmt=ts=>{const d=new Date(ts);return (d.getMonth()+1)+'月'+d.getDate()+'日 '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)};
  const lastTs=times.length?Math.max(...times):first;
  $('compDate').textContent=fmt(first)+' － '+fmt(lastTs);
  let chars=0;msgs.forEach(m=>{chars+=sanitizeForAI(stripTrans(m.content)).replace(/\s/g,'').length});
  $('compDays').innerHTML=days+'<small>天</small>';
  $('compMsgs').innerHTML=msgs.length+'<small>条</small>';
  $('compChars').innerHTML=chars+'<small>字</small>';
  $('compScrim').classList.add('show');$('compModal').classList.add('show');
}
function closeCompanion(){$('compModal').classList.remove('show');$('compScrim').classList.remove('show')}
$('compClose').onclick=closeCompanion;$('compScrim').onclick=closeCompanion;

// ===== 心声系统：加上关闭动作 =====
$('mindClose').onclick=()=>{ $('mindModal').classList.remove('show'); $('mindScrim').classList.remove('show'); };
$('mindScrim').onclick=$('mindClose').onclick;