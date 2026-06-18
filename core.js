// ===== core.js =====
// 数据层：DB存储 / 全局状态 S / 工厂函数 / 加载迁移 / 保存
// =====================

const $=id=>document.getElementById(id);
const toast=(m,e=false)=>{const t=$('toast');t.textContent=m;t.className='toast show'+(e?' err':'');setTimeout(()=>t.className='toast',2400)};
let mem={},storeOK=true;
try{localStorage.setItem('__t','1');localStorage.removeItem('__t')}catch(e){storeOK=false}
const DB={get(k){if(storeOK){try{return localStorage.getItem(k)}catch(e){}}return mem[k]??null},set(k,v){if(storeOK){try{localStorage.setItem(k,v);return}catch(e){if(e&&e.name==='QuotaExceededError'){try{toast('存储空间已满！请删减角色或清理背景图，否则刷新后新数据会丢失',true)}catch(_){}}}}mem[k]=v}};

const defModels={claude:'claude-sonnet-4-6',gemini:'gemini-2.0-flash',deepseek:'deepseek-chat',openai:''};
const DEF_EMO='【情绪标签 · 严格规则】方括号情绪标签（如 [warm] [excited] [whispers] [laughs] [sighs] [giggles] [teasing]）只能出现在语音条 {{voice:…}} 的内部，用来让声音更生动。\n禁止：任何普通文字消息的开头或中间都绝对不能出现 [excited] 这类方括号标签。如果你不是在发语音条，就一个情绪标签都不要写，直接像真人发微信那样自然说话即可。\n正确示例：今天好开心呀～\n错误示例：[happy] 今天好开心呀～\n再说一遍：不发语音条时，一个方括号标签都不许出现。';
const DEF_VOICE='【语音条】大多数时候用普通文字消息。只有在情绪浓烈、关键的时刻（如认真表白、深夜的真心话、安慰、撒娇、念诗或唱歌），你才可以改用语音条来说那一句。发语音条的格式：单独一行写 {{voice:要说的那句话}}，双花括号里就是你想用声音表达的内容。务必写上结尾的两个右花括号 }}，不能漏。不要每条都用语音条，绝大部分还是普通文字，语音条是点睛之笔，一次顶多一条。\n【发图片/相片记忆卡】如果你想"发一张照片"给对方（你没有真实图片，只能描述画面），请使用相片记忆卡的形式。格式：单独一行写 {{card:画面描述或文字内容|地点|日期}}，三段用竖线 | 分隔，地点和日期可留空但竖线要保留，例如 {{card:坐在书桌前对着镜头比耶的自拍|家里|}} 或 {{card:我们的第一次约会||}}。务必写上结尾 }}。';
const INJECT_OPTS=[['tail','系统结尾'],['head','系统开头'],['depth','对话深度'],['off','关闭']];
const POS_OPTS=[['head','开头'],['tail','结尾'],['depth','指定深度']];

function newWB(o){o=o||{};return{
  id:newId('wb'),
  name:o.name||'新条目',
  content:o.content||'',
  keys:o.keys||[],
  on:o.on!==false,
  constant:o.constant!==false,
  scanMode:o.scanMode||'sys',
  scanSelf:o.scanSelf||4,
  scope:o.scope||'global',
  roleId:o.roleId||'',
  pos:o.pos||'head',
  depth:o.depth||4,
  order:o.order!=null?o.order:100
}}
let _rid=Date.now();
const newId=p=>(p||'id')+(_rid++)+Math.random().toString(36).slice(2,6);
function newConvo(title){return{id:newId('c'),title:title||'新对话',msgs:[],memories:[],relation:'',sumDone:0,relDone:0,createdAt:Date.now()}}
function freshState(){return{
  apiPresets:[{name:'默认',provider:'claude',baseUrl:'',model:defModels.claude,apiKey:'',temperature:1,topP:1}],apiIdx:0,
  roleCards:[],roleIdx:0,
  userCards:[{name:'我',userName:'我',avatar:'',persona:'',inject:'tail',depth:0,order:100}],userIdx:0,
  maxTokens:4096,
  tplPresets:{},
  longDistance:{on:false},
  appearance:{userBubble:'',aiBubble:'',userShape:'circle',aiShape:'circle',avSize:42,accent:'',accent2:''},
  memOpt:{carry:20,sumEvery:20,autoSum:true,sumInject:'head',sumDepth:0,sumMin:80,sumMax:200,
    sumPrompt:'请把以下对话浓缩成一条简洁的长期记忆，记录关键事实、情节进展、情感变化和重要约定，用第三人称：',
    relEvery:20,autoRel:true,relInject:'head',relDepth:0,
    relPrompt:'请根据对话梳理「我」和角色的关系档案，更新或补全以下字段（没有的留空）：相遇时间、确定关系时间、重要进展节点、当前关系状态。简洁列出：'},
  worldPresets:[{name:'无',world:'',inject:'head',depth:0}],
  worldBook:[],
  wbGroups:[],
  voicePresets:[{name:'默认',engine:'elevenlabs',base:'',key:'',voice:'',model:'eleven_v3',autoSpeak:false,showRaw:false,dialogOnly:false}],voiceIdx:0,
  regexPresets:[{name:'默认',rules:[{find:'\\[.*?\\]',replace:'',on:true,target:'both',name:'去方括号',group:''}]}],regexIdx:0,
  emo:{on:false,tpl:DEF_EMO,inject:'depth',depth:0},
  voiceMsg:{on:false,tpl:DEF_VOICE,inject:'depth',depth:0},
  mind:{on:false,genAff:true,genTho:true,genPos:true,genTime:false,injAff:true,injTho:false,injPos:true,injTime:true,affMaxStep:10,prompt:'',inject:'depth',depth:0,order:100},
  jailbreak:{on:false,tpl:'',inject:'head',depth:0,order:1},
  jailbreakTail:{on:false,tpl:'',inject:'tail',depth:0,order:999},
  chatOpt:{split:true,splitInject:'depth',splitDepth:0,trans:false,transInject:'depth',transDepth:0,autoReply:true,showTime:true,fontSize:15,sysFontSize:12,typingDelay:false,typingDelaySec:3,readNoReply:false,charStickers:true,charKaomoji:true,autoStatus:true,timeSysOn:false,storyStart:'',timeFallbackMin:5,timeRecentN:2,patOn:true,narrateOn:false,actionModeOn:true,callOn:true,callVoiceApi:false,callRejectChance:15,recallSee:false,charReact:true},
  aiReply:{on:false,count:2,auto:false,dirs:[{name:'推剧情',guide:''},{name:'谈心',guide:''},{name:'调情',guide:''},{name:'日常',guide:''}]},
  stickers:{global:[],perRole:{},inject:'depth',depth:0},
  relationPush:{on:false,prompt:'',activities:[]},
  proactive:{on:false,minutes:10,keepAlive:false,inject:'depth',depth:0,
    prompt:'现在你主动给对方发一条消息，像真人那样自然地找 TA 说话，可以是关心、分享、撒娇或日常，简短一点。'},
  theme:'dark',
  globalBg:'',
  globalCallBg:'',
  bgPresets:[]
}}
let S;
function load(){const raw=DB.get('vp6');if(raw){try{S=JSON.parse(raw)}catch(e){S=freshState()}}else S=freshState();const f=freshState();for(const k in f)if(S[k]==null)S[k]=f[k];if(!S.voiceMsg)S.voiceMsg=f.voiceMsg;if(!S.mind)S.mind=f.mind;if(S.stickers&&S.stickers.inject==null){S.stickers.inject='depth';S.stickers.depth=0}
  if(S.mind){const m=S.mind;if(m.genAff==null){m.genAff=(m.aff!==false);m.genTho=(m.tho!==false);m.genPos=(m.pos!==false)}
    if(m.genTime==null)m.genTime=false;if(m.injAff==null)m.injAff=true;if(m.injTho==null)m.injTho=false;if(m.injPos==null)m.injPos=true;if(m.injTime==null)m.injTime=true;
    if(m.affMaxStep==null)m.affMaxStep=10;if(m.prompt==null)m.prompt='';if(m.inject==null)m.inject='depth';if(m.depth==null)m.depth=0;if(m.order==null)m.order=100}
  if(!S.jailbreak)S.jailbreak=f.jailbreak;
  if(!S.jailbreakTail)S.jailbreakTail=f.jailbreakTail;
  if(!S.aiReply)S.aiReply=f.aiReply;else{if(!Array.isArray(S.aiReply.dirs)||!S.aiReply.dirs.length)S.aiReply.dirs=f.aiReply.dirs;if(S.aiReply.count==null)S.aiReply.count=2;if(S.aiReply.on==null)S.aiReply.on=false;if(S.aiReply.auto==null)S.aiReply.auto=false}
  if(S.chatOpt&&!S.chatOpt.timeMode)S.chatOpt.timeMode='real';
  if(!S.reactions)S.reactions={};
  if(!S.relationPush)S.relationPush={on:false,prompt:'',activities:[]};
  if(S.chatOpt){if(S.chatOpt.storyStart==null)S.chatOpt.storyStart='';if(S.chatOpt.timeSysOn==null)S.chatOpt.timeSysOn=(S.chatOpt.timeMode==='fiction');if(S.chatOpt.timeFallbackMin==null)S.chatOpt.timeFallbackMin=5;if(S.chatOpt.timeRecentN==null)S.chatOpt.timeRecentN=2;if(S.chatOpt.patOn==null)S.chatOpt.patOn=true;if(S.chatOpt.narrateOn==null)S.chatOpt.narrateOn=false;if(S.chatOpt.actionModeOn==null)S.chatOpt.actionModeOn=true;if(S.chatOpt.callOn==null)S.chatOpt.callOn=true;if(S.chatOpt.callVoiceApi==null)S.chatOpt.callVoiceApi=false;if(S.chatOpt.callRejectChance==null)S.chatOpt.callRejectChance=15;if(S.chatOpt.recallSee==null)S.chatOpt.recallSee=false;if(S.chatOpt.charReact==null)S.chatOpt.charReact=true;if(S.chatOpt.sysFontSize==null)S.chatOpt.sysFontSize=12;}
  (S.apiPresets||[]).forEach(p=>{if(p.temperature==null)p.temperature=1;if(p.topP==null)p.topP=1;});
  if(S.memOpt){if(S.memOpt.sumMin==null)S.memOpt.sumMin=80;if(S.memOpt.sumMax==null)S.memOpt.sumMax=200;}
  if(S.maxTokens==null)S.maxTokens=4096;
  if(S.globalCallBg==null)S.globalCallBg='';
  if(!S.tplPresets)S.tplPresets={};
  if(!S.longDistance)S.longDistance={on:false};
  if(!Array.isArray(S.bgPresets))S.bgPresets=[];
  if(!S.appearance)S.appearance={userBubble:'',aiBubble:'',userShape:'circle',aiShape:'circle',avSize:42,accent:'',accent2:''};
  else{const ap=S.appearance;if(ap.userShape==null)ap.userShape='circle';if(ap.aiShape==null)ap.aiShape='circle';if(ap.avSize==null)ap.avSize=42;if(ap.accent==null)ap.accent='';if(ap.accent2==null)ap.accent2='';}
  if(S.voiceMsg&&S.voiceMsg.tpl&&(/\[voice:/.test(S.voiceMsg.tpl)||!/相片记忆卡/.test(S.voiceMsg.tpl)))S.voiceMsg.tpl=DEF_VOICE;
  if(S.emo&&S.emo.tpl&&!/严格规则/.test(S.emo.tpl))S.emo.tpl=DEF_EMO;
  if(S.roleCards&&S.roleCards.length){
    let changed=false;
    S.roleCards.forEach(r=>{
      if(!r.id){r.id=newId('r');changed=true;
        if(S.stickers&&S.stickers.perRole&&S.stickers.perRole[r.roleName]&&!S.stickers.perRole[r.id]){S.stickers.perRole[r.id]=S.stickers.perRole[r.roleName];delete S.stickers.perRole[r.roleName]}
      }
      if(!r.convos){
        const c=newConvo('对话 1');
        c.memories=r.memories||[];c.relation=r.relation||'';c.sumDone=r.sumDone||0;c.relDone=r.relDone||0;
        r.convos=[c];r.curConvo=c.id;changed=true;
      }
      if(!r.curConvo&&r.convos.length)r.curConvo=r.convos[0].id;
      if(r.greetings==null){
        const raw=(r.greeting||'').trim();
        r.greetings=raw?raw.split(/\n+/).map(s=>s.trim()).filter(Boolean):[];
        changed=true;
      }
      if(r.order==null){r.order=100;changed=true}
      if(r.wbIds==null){r.wbIds=[];changed=true}
      if(r.callBg==null){r.callBg='';changed=true}
    });
    if(changed)save();
  }
  if(!Array.isArray(S.worldBook))S.worldBook=[];
  if(!Array.isArray(S.wbGroups))S.wbGroups=[];
  if(!S._wbMigrated){
    (S.worldPresets||[]).forEach(w=>{
      if(w&&w.world&&w.world.trim()&&w.name!=='无'){
        S.worldBook.push(newWB({name:w.name||'世界设定',content:w.world,scope:'global',pos:w.inject||'head',depth:w.depth||4,constant:true}));
      }
    });
    (S.roleCards||[]).forEach(r=>{
      const wp=S.worldPresets&&S.worldPresets[r.worldIdx];
      if(wp&&wp.name&&wp.name!=='无'){
        const hit=S.worldBook.find(x=>x.name===(wp.name||'世界设定'));
        if(hit&&!r.wbIds.includes(hit.id))r.wbIds.push(hit.id);
      }
    });
    S._wbMigrated=true;save();
  }
  (S.regexPresets||[]).forEach(p=>{
    if(Array.isArray(p.rules)){
      p.rules=p.rules.map(r=>{
        if(typeof r==='string')return{find:r,replace:'',on:true,target:'both',name:r.slice(0,12)||'规则',group:''};
        return{find:r.find||'',replace:r.replace||'',on:r.on!==false,target:r.target||'both',name:r.name||(r.find||'').slice(0,12)||'规则',group:r.group||'',minDepth:r.minDepth,maxDepth:r.maxDepth};
      });
    }
  });
  if(S.wbScanFloors==null)S.wbScanFloors=4;
}
function save(){DB.set('vp6',JSON.stringify(S))}
load();

const curApi=()=>S.apiPresets[S.apiIdx];
const hasRole=()=>S.roleCards.length>0;
const curRole=()=>S.roleCards[S.roleIdx]||null;
const curUser=()=>S.userCards[S.userIdx];
const curVoice=()=>S.voicePresets[S.voiceIdx];
const curRegex=()=>S.regexPresets[S.regexIdx];

function curConvo(){const r=curRole();if(!r)return null;if(!r.convos||!r.convos.length){r.convos=[newConvo('对话 1')];r.curConvo=r.convos[0].id}let c=r.convos.find(x=>x.id===r.curConvo);if(!c){c=r.convos[0];r.curConvo=c.id}return c}
function chat(){const c=curConvo();return c?c.msgs:[]}
function roleMem(){const c=curConvo();if(!c)return null;if(!c.memories)c.memories=[];if(c.relation==null)c.relation='';if(c.sumDone==null)c.sumDone=0;if(c.relDone==null)c.relDone=0;return c}
const roleWorld=()=>curRole()?(S.worldPresets[curRole().worldIdx]||{world:'',inject:'head',depth:0}):{world:''};