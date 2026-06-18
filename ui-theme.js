// ===== ui-theme.js =====
// 主题 / 外观 / 背景 / 头像工具
// ========================

const SUN='<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
const MOON='<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
function applyTheme(){document.documentElement.setAttribute('data-theme',S.theme);document.querySelector('meta[name=theme-color]').setAttribute('content',S.theme==='light'?'#f5f0e6':'#1a1714');$('themeIcon').innerHTML=S.theme==='light'?SUN:MOON}
function applyAppearance(){
  const ap=S.appearance||{};const root=document.documentElement.style;
  if(ap.userBubble){root.setProperty('--user-b1',ap.userBubble);root.setProperty('--user-b2',ap.userBubble);}else{root.removeProperty('--user-b1');root.removeProperty('--user-b2');}
  if(ap.aiBubble){root.setProperty('--ai-b',ap.aiBubble);}else{root.removeProperty('--ai-b');}
  if(ap.accent){root.setProperty('--accent',ap.accent);root.setProperty('--accent-2',ap.accent2||ap.accent);}else{root.removeProperty('--accent');root.removeProperty('--accent-2');}
  root.setProperty('--av-sz',(ap.avSize||42)+'px');
  if($('thread'))$('thread').style.setProperty('--fz',(S.chatOpt.fontSize||15)+'px');
}
const ACCENT_PRESETS=[['默认橙','',''],['玫瑰粉','#e06b9a','#d85b8c'],['天青蓝','#5a8fe0','#4f7fd6'],['薄荷绿','#4fb389','#3fa57d'],['丁香紫','#9a7ae0','#8a6ad6'],['赤陶红','#d8694f','#c85a42'],['暮金黄','#d8a83f','#c89a2f']];
const BG_PRESETS=[
  'linear-gradient(160deg,#2b3a4a,#1a2530)',
  'linear-gradient(160deg,#3a2b4a,#22192e)',
  'linear-gradient(160deg,#4a3a2b,#2e2419)',
  'linear-gradient(160deg,#2b4a3a,#192e24)',
  'linear-gradient(160deg,#4a2b3a,#2e1924)',
  'linear-gradient(160deg,#1f2937,#0f1620)',
  'linear-gradient(160deg,#f3e7d3,#e6d3b3)'
];
function syncAppearance(){
  const ap=S.appearance||(S.appearance={});const u=curUser(),r=curRole();
  $('apUserBubble').value=ap.userBubble||'#5a9e78';
  $('apAiBubble').value=ap.aiBubble||'#2e2820';
  $('apFont').value=S.chatOpt.fontSize||15;$('apFontVal').textContent=(S.chatOpt.fontSize||15)+'px';
  $('apAvSize').value=ap.avSize||42;$('apAvVal').textContent=(ap.avSize||42)+'px';
  const us=(u&&u.avShape==='square')?'square':'circle';
  const as=(r&&r.avShape==='square')?'square':'circle';
  $('apUserCircle').classList.toggle('on',us==='circle');$('apUserSquare').classList.toggle('on',us==='square');
  $('apAiCircle').classList.toggle('on',as==='circle');$('apAiSquare').classList.toggle('on',as==='square');
  $('apAccent').value=ap.accent||'#e0a063';
  const sw=$('apAccentSwatches');if(sw){sw.innerHTML='';ACCENT_PRESETS.forEach(([nm,c1,c2])=>{const b=document.createElement('button');b.className='mini';b.textContent=nm;b.style.cssText='border-radius:10px;'+(c1?('background:'+c1+';color:#fff;border-color:'+c1):'');const on=((ap.accent||'')===(c1||''));if(on)b.style.outline='2px solid var(--ink)';b.onclick=()=>{S.appearance.accent=c1;S.appearance.accent2=c2;applyAppearance();syncAppearance();refreshTop&&refreshTop()};sw.append(b)})}
  document.querySelectorAll('[data-theme-set]').forEach(card=>{
    card.classList.toggle('on',(S.theme||'dark')===card.dataset.themeSet);
    card.onclick=()=>{S.theme=card.dataset.themeSet;applyTheme();save();syncAppearance()};
  });
  const bp=$('bgPick');
  if(bp){bp.innerHTML='';
    const cur=S.globalBg||'';
    const none=document.createElement('div');none.className='bgo none'+(cur===''?' on':'');none.textContent='无';
    none.onclick=()=>{S.globalBg='';setBg($('apBgThumb'),'');save();refreshTop();syncAppearance()};bp.append(none);
    BG_PRESETS.forEach(g=>{const o=document.createElement('div');o.className='bgo'+(cur===g?' on':'');o.style.background=g;o.onclick=()=>{S.globalBg=g;setBg($('apBgThumb'),'');save();refreshTop();syncAppearance()};bp.append(o)});
    (S.bgPresets||[]).forEach((p,pi)=>{
      const o=document.createElement('div');o.className='bgo img-bgo'+(cur===p.src?' on':'');
      o.style.backgroundImage='url('+p.src+')';o.style.backgroundSize='cover';o.style.backgroundPosition='center';
      o.title=p.name||('预设 '+(pi+1));
      const del=document.createElement('span');del.className='bgo-del';del.textContent='×';
      del.onclick=e=>{e.stopPropagation();S.bgPresets.splice(pi,1);if(S.globalBg===p.src){S.globalBg='';refreshTop();}save();syncAppearance()};
      o.append(del);
      o.onclick=()=>{S.globalBg=p.src;setBg($('apBgThumb'),p.src);save();refreshTop();syncAppearance()};
      bp.append(o);
    });
    if(cur&&cur.startsWith('data:')){
      const saveBtn=document.createElement('div');saveBtn.className='bgo save-bgo';saveBtn.textContent='存为预设';
      saveBtn.onclick=()=>{
        const n=prompt('给这个背景起个名字：','背景 '+(S.bgPresets.length+1));
        if(n==null)return;
        if(S.bgPresets.some(p=>p.src===cur)){toast('该背景已是预设',true);return}
        S.bgPresets.push({name:n.trim()||('背景 '+(S.bgPresets.length+1)),src:cur});
        save();syncAppearance();toast('已存为背景预设');
      };
      bp.append(saveBtn);
    }
  }
  if($('apBgThumb'))setBg($('apBgThumb'),(S.globalBg&&S.globalBg.startsWith('data:'))?S.globalBg:'');
}

let _apUserShape='circle',_apAiShape='circle';
function bindAppearance(){
  $('apUserBubble').oninput=()=>{S.appearance.userBubble=$('apUserBubble').value;applyAppearance()};
  $('apAiBubble').oninput=()=>{S.appearance.aiBubble=$('apAiBubble').value;applyAppearance()};
  $('apUserReset').onclick=()=>{S.appearance.userBubble='';applyAppearance();toast('我的气泡已恢复默认')};
  $('apAiReset').onclick=()=>{S.appearance.aiBubble='';applyAppearance();toast('对方气泡已恢复默认')};
  $('apFont').oninput=()=>{S.chatOpt.fontSize=+$('apFont').value;$('apFontVal').textContent=S.chatOpt.fontSize+'px';if($('fontSize'))$('fontSize').value=S.chatOpt.fontSize;if($('fzVal'))$('fzVal').textContent=S.chatOpt.fontSize+'px';applyAppearance()};
  $('apAvSize').oninput=()=>{S.appearance.avSize=+$('apAvSize').value;$('apAvVal').textContent=S.appearance.avSize+'px';applyAppearance()};
  const pick=(circleBtn,squareBtn,setter)=>{circleBtn.onclick=()=>{setter('circle');circleBtn.classList.add('on');squareBtn.classList.remove('on')};squareBtn.onclick=()=>{setter('square');squareBtn.classList.add('on');circleBtn.classList.remove('on')}};
  pick($('apUserCircle'),$('apUserSquare'),v=>{_apUserShape=v;const u=curUser();if(u)u.avShape=v;renderThread()});
  pick($('apAiCircle'),$('apAiSquare'),v=>{_apAiShape=v;const r=curRole();if(r)r.avShape=v;renderThread()});
  $('apAccent').oninput=()=>{S.appearance.accent=$('apAccent').value;S.appearance.accent2=$('apAccent').value;applyAppearance();syncAppearance();refreshTop&&refreshTop()};
  $('apAccentReset').onclick=()=>{S.appearance.accent='';S.appearance.accent2='';applyAppearance();syncAppearance();refreshTop&&refreshTop();toast('已恢复默认橙')};
}
document.querySelectorAll('[data-save-appearance]').forEach(b=>b.onclick=()=>{pullSettings&&pullSettings();save();applyAppearance();renderThread();refreshTop();toast('外观已保存')});

function setBg(el,src){if(!el)return;if(!src){el.style.backgroundImage='';el.style.background='';return}if(/^(linear-gradient|radial-gradient|conic-gradient)/.test(src)){el.style.backgroundImage='';el.style.background=src}else{el.style.background='';el.style.backgroundImage=`url(${src})`}el.textContent=''}
function setAvDisp(el,src,fb){if(src){el.style.backgroundImage=`url(${src})`;el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.style.backgroundRepeat='no-repeat';el.textContent=''}else{el.style.backgroundImage='';el.textContent=(fb||'?').trim().charAt(0).toUpperCase()}}


// ===== 通用模板预设 =====
function tplStore(key){S.tplPresets=S.tplPresets||{};if(!S.tplPresets[key])S.tplPresets[key]={list:[],idx:-1};return S.tplPresets[key]}
function attachTplPresets(key,taId){
  const ta=$(taId);if(!ta||ta.dataset.tplBar)return;ta.dataset.tplBar='1';
  const st=tplStore(key);
  const bar=document.createElement('div');bar.className='preset-bar';bar.style.marginBottom='8px';
  const sel=document.createElement('select');
  const bSave=document.createElement('button');bSave.className='mini';bSave.textContent='存为预设';
  const bRen=document.createElement('button');bRen.className='mini';bRen.textContent='改名';
  const bDel=document.createElement('button');bDel.className='mini danger';bDel.textContent='删';
  bar.append(sel,bSave,bRen,bDel);
  const host=ta.closest('label,.fld')||ta;host.parentNode.insertBefore(bar,host);
  function refresh(){sel.innerHTML='';const o0=document.createElement('option');o0.value='-1';o0.textContent=st.list.length?'— 选择预设 —':'（暂无预设，可存为预设）';sel.append(o0);st.list.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=p.name;sel.append(o)});sel.value=String(st.idx)}
  refresh();
  bar._refresh=refresh;
  sel.onchange=()=>{const i=+sel.value;if(i<0)return;st.idx=i;ta.value=st.list[i].text;if(typeof pullSettings==='function'){pullSettings();}save();toast('已应用：'+st.list[i].name)};
  bSave.onclick=()=>{const name=prompt('预设名称：','预设 '+(st.list.length+1));if(name==null)return;st.list.push({name:(name.trim()||('预设 '+(st.list.length+1))),text:ta.value});st.idx=st.list.length-1;save();refresh();toast('已存为预设，可在下拉里随时切换')};
  bRen.onclick=()=>{if(st.idx<0){toast('先在下拉里选一个预设',true);return}const name=prompt('改名（同时会用当前内容更新此预设）：',st.list[st.idx].name);if(name==null)return;st.list[st.idx].name=name.trim()||st.list[st.idx].name;st.list[st.idx].text=ta.value;save();refresh();toast('已更新预设')};
  bDel.onclick=()=>{if(st.idx<0){toast('先选一个预设',true);return}if(!confirm('删除预设「'+st.list[st.idx].name+'」？'))return;st.list.splice(st.idx,1);st.idx=-1;save();refresh();toast('已删除')};
}
function setupAllTplPresets(){
  attachTplPresets('sumPrompt','memSumPrompt');
  attachTplPresets('relPrompt','memRelPrompt');
  attachTplPresets('jailbreak','jbTpl');
  attachTplPresets('mind','mindPrompt');
  attachTplPresets('voice','voiceTpl');
  attachTplPresets('emo','emoTpl');
}

// ===== 初始化调用 =====
setupAllTplPresets();
$('btnTheme').onclick=()=>{S.theme=S.theme==='light'?'dark':'light';applyTheme();save()};
applyTheme();
if(typeof bindAppearance==='function')bindAppearance();
if(typeof applyAppearance==='function')applyAppearance();