// ===== ui-drawer.js =====
// 顶栏状态栏 / 抽屉 / 角色列表 / 对话列表 / 角色面板 / 用户面板
// =========================

function refreshTop(){
  const a=curApi(),r=curRole();
  $('topName').textContent=r?(r.roleName||'角色'):'未选择角色';
  const ready=a.apiKey&&a.model;
  const customStatus=r&&r.customStatus;
  if(customStatus){$('topStatus').textContent=customStatus;$('topStatus').className=ready?'':'off'}
  else{$('topStatus').textContent=ready?a.provider+' · 在线':'未连接';$('topStatus').className=ready?'':'off'}
  setBg($('bgwrap'),(r&&r.bg)||S.globalBg||'');
}
// 点顶部状态文字可自定义
$('topStatus').onclick=e=>{
  e.stopPropagation();
  if(!curRole()){toast('先选个角色',true);return}
  const r=curRole();
  const cur=r.customStatus||'';
  const n=prompt('自定义状态文字（留空恢复默认）：',cur);
  if(n===null)return;
  r.customStatus=n.trim();
  save();refreshTop();
};
// ===== 抽屉：角色列表 / 对话列表 双视图 =====
let drMode='roles'; // roles | convos
let drRoleI=0; // 进入对话列表时针对的角色 index
function openDrawer(){drMode='roles';showRolesView();renderRoleList();refreshMe();$('drawer').classList.add('show');$('scrim').classList.add('show')}
function closeDrawer(){$('drawer').classList.remove('show');$('scrim').classList.remove('show')}
$('btnMenu').onclick=openDrawer;$('scrim').onclick=closeDrawer;
function showRolesView(){$('drRolesView').style.display='flex';$('drConvosView').style.display='none'}
function showConvosView(){$('drRolesView').style.display='none';$('drConvosView').style.display='flex'}

function renderRoleList(){
  const box=$('roleList');box.innerHTML='';
  if(!S.roleCards.length){box.innerHTML='<div class="empty-roles">还没有角色<br>点上方「新建角色」开始</div>';return}
  S.roleCards.forEach((r,i)=>{
    const slot=document.createElement('div');slot.className='swipe-slot';
    const el=document.createElement('div');el.className='card-item swipe-item'+(i===S.roleIdx?' active':'');
    const av=document.createElement('div');av.className='ci-av';setAvDisp(av,r.avatar,r.roleName);av.style.borderRadius=r.avShape==='square'?'12px':'50%';
    const meta=document.createElement('div');meta.className='ci-meta';
    const nConvo=(r.convos&&r.convos.length)||0;
    meta.innerHTML=`<b>${r.roleName||'未命名'}</b><small>${nConvo} 段对话</small>`;
    const ed=document.createElement('button');ed.className='ci-edit';ed.innerHTML='<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
    ed.onclick=e=>{e.stopPropagation();enterConvos(i)};
    el.append(av,meta,ed);
    el.onclick=()=>{if(el.dataset.swiped==='1'){el.style.transform='';el.dataset.swiped='0';return}enterConvos(i)};
    const delBtn=document.createElement('button');delBtn.className='swipe-del';delBtn.innerHTML='<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/></svg>删除';delBtn.onclick=e=>{e.stopPropagation();deleteRole(i)};
    let sx=0,dx=0,sw=false;
    el.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;dx=0;sw=true},{passive:true});
    el.addEventListener('touchmove',e=>{if(!sw)return;dx=e.touches[0].clientX-sx;el.style.transform='translateX('+Math.min(0,Math.max(dx,-80))+'px)'},{passive:true});
    el.addEventListener('touchend',()=>{sw=false;if(dx<-45){el.style.transform='translateX(-80px)';el.dataset.swiped='1'}else{el.style.transform='translateX(0)';el.dataset.swiped='0'}dx=0});
    slot.append(delBtn,el);box.append(slot);
  });
}
function refreshMe(){const u=curUser();setAvDisp($('meAv'),u.avatar,u.userName);$('meName').textContent=u.userName||'我'}

// 进入某角色的对话列表
function enterConvos(i){drRoleI=i;drMode='convos';const r=S.roleCards[i];if(!r.convos||!r.convos.length){r.convos=[newConvo('对话 1')];r.curConvo=r.convos[0].id;save()}convoSelMode=false;convoSelSet.clear();showConvosView();renderConvoList()}
$('convoBack').onclick=()=>{drMode='roles';showRolesView();renderRoleList()};
$('convoEditRole').onclick=()=>{S.roleIdx=drRoleI;save();closeDrawer();openRolePanel()};
let convoSelMode=false;const convoSelSet=new Set();
function renderConvoList(){
  const r=S.roleCards[drRoleI];
  setAvDisp($('convoHeroAv'),r.avatar,r.roleName);$('convoHeroAv').style.borderRadius=r.avShape==='square'?'12px':'50%';
  $('convoHeroName').textContent=r.roleName||'角色';
  $('convoSelBar').style.display=convoSelMode?'flex':'none';
  $('convoSelBtn').textContent=convoSelMode?'完成':'选择';
  const box=$('convoList');box.innerHTML='';
  if(!r.convos.length){box.innerHTML='<div class="empty-roles">还没有对话<br>点上方「新建对话」</div>';return}
  r.convos.forEach((c,ci)=>{
    const active=(S.roleIdx===drRoleI&&r.curConvo===c.id);
    const slot=document.createElement('div');slot.className='swipe-slot';
    const el=document.createElement('div');el.className='card-item swipe-item'+(active?' active':'');
    const av=document.createElement('div');av.className='ci-av convo-av';setAvDisp(av,r.avatar,r.roleName);av.style.borderRadius=r.avShape==='square'?'12px':'50%';
    const cnt=(c.msgs||[]).filter(m=>!m.hidden).length;
    const lc=c.msgs&&c.msgs.length?c.msgs[c.msgs.length-1]:null;
    const preview=lc?sanitizeForAI(stripTrans(lc.content)).replace(/\n/g,' ').slice(0,18):'未开始';
    const meta=document.createElement('div');meta.className='ci-meta';meta.innerHTML=`<b>${c.title||'对话'}</b><small>${cnt} 条 · ${preview}</small>`;
    if(convoSelMode){
      const ck=document.createElement('div');
      const on=convoSelSet.has(c.id);
      ck.style.cssText='width:22px;height:22px;border-radius:50%;border:2px solid var(--accent);flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-right:4px;'+(on?'background:var(--accent)':'');
      ck.innerHTML=on?'<svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:none;stroke:#fff;stroke-width:3"><path d="M5 12l5 5 9-9"/></svg>':'';
      el.append(ck,av,meta);
      el.onclick=()=>{if(convoSelSet.has(c.id))convoSelSet.delete(c.id);else convoSelSet.add(c.id);renderConvoList()};
      slot.append(el);box.append(slot);
      return;
    }
    const ed=document.createElement('button');ed.className='ci-edit';ed.innerHTML='<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
    ed.onclick=e=>{e.stopPropagation();const n=prompt('对话名称：',c.title);if(n!=null&&n.trim()){c.title=n.trim();save();renderConvoList()}};
    el.append(av,meta,ed);
    el.onclick=()=>{if(el.dataset.swiped==='1'){el.style.transform='';el.dataset.swiped='0';return}
      S.roleIdx=drRoleI;r.curConvo=c.id;save();renderThread();refreshTop();closeDrawer()};
    const delBtn=document.createElement('button');delBtn.className='swipe-del';delBtn.innerHTML='<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/></svg>删除';
    delBtn.onclick=e=>{e.stopPropagation();deleteConvo(drRoleI,ci)};
    let sx=0,dx=0,sw=false,lp=null;
    el.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;dx=0;sw=true;lp=setTimeout(()=>{convoSelMode=true;convoSelSet.clear();convoSelSet.add(c.id);renderConvoList()},550)},{passive:true});
    el.addEventListener('touchmove',e=>{if(!sw)return;dx=e.touches[0].clientX-sx;if(Math.abs(dx)>6&&lp){clearTimeout(lp);lp=null}el.style.transform='translateX('+Math.min(0,Math.max(dx,-80))+'px)'},{passive:true});
    el.addEventListener('touchend',()=>{sw=false;if(lp){clearTimeout(lp);lp=null}if(dx<-45){el.style.transform='translateX(-80px)';el.dataset.swiped='1'}else{el.style.transform='translateX(0)';el.dataset.swiped='0'}dx=0});
    slot.append(delBtn,el);box.append(slot);
  });
}
$('convoSelBtn').onclick=()=>{convoSelMode=!convoSelMode;convoSelSet.clear();renderConvoList()};
$('convoSelCancel').onclick=()=>{convoSelMode=false;convoSelSet.clear();renderConvoList()};
$('convoExportSel').onclick=()=>{
  const r=S.roleCards[drRoleI];const picks=r.convos.filter(c=>convoSelSet.has(c.id));
  if(!picks.length){toast('先选至少一段对话',true);return}
  const data={app:'语音聊天',type:'convos',role:r.roleName||'角色',exportedAt:Date.now(),convos:JSON.parse(JSON.stringify(picks))};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const ts=new Date();const pad=n=>('0'+n).slice(-2);
  const stamp=ts.getFullYear()+pad(ts.getMonth()+1)+pad(ts.getDate())+'_'+pad(ts.getHours())+pad(ts.getMinutes())+pad(ts.getSeconds());
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=(r.roleName||'对话')+'_对话导出_'+picks.length+'段_'+stamp+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('已导出 '+picks.length+' 段对话');convoSelMode=false;convoSelSet.clear();renderConvoList();
};
function importConvosFromFile(f){
  const rd=new FileReader();
  rd.onload=()=>{try{
    const data=JSON.parse(rd.result);
    let arr=Array.isArray(data)?data:(data.convos||(data.type==='convo'?[data]:null));
    if(!arr||!arr.length){toast('文件里没有对话数据',true);return}
    const r=S.roleCards[drRoleI];let n=0;
    arr.forEach(c=>{
      if(!c||!Array.isArray(c.msgs))return;
      const nc=newConvo((c.title||'导入对话')+'');
      nc.msgs=c.msgs;nc.memories=c.memories||[];nc.relation=c.relation||'';nc.sumDone=0;nc.relDone=0;
      r.convos.push(nc);n++;
    });
    if(n){S.roleIdx=drRoleI;r.curConvo=r.convos[r.convos.length-1].id;save();renderConvoList();renderThread();refreshTop();toast('导入了 '+n+' 段对话')}
    else toast('没有可导入的对话',true);
  }catch(err){toast('文件解析失败：'+err.message,true)}};
  rd.readAsText(f);
}
$('convoImportFile').onchange=e=>{const f=e.target.files[0];if(f)importConvosFromFile(f);e.target.value=''};
function openConvoNew(){$('convoNewScrim').classList.add('show');$('convoNewModal').classList.add('show')}
function closeConvoNew(){$('convoNewScrim').classList.remove('show');$('convoNewModal').classList.remove('show')}
$('convoNew').onclick=openConvoNew;
$('convoNewScrim').onclick=closeConvoNew;
$('convoNewBlank').onclick=()=>{const r=S.roleCards[drRoleI];const n=prompt('新对话名称：','对话 '+(r.convos.length+1));if(n==null)return;const c=newConvo(n||('对话 '+(r.convos.length+1)));r.convos.push(c);S.roleIdx=drRoleI;r.curConvo=c.id;save();renderConvoList();renderThread();refreshTop();closeConvoNew();toast('已创建对话')};
$('convoNewImport').onclick=()=>{closeConvoNew();$('convoImportFile').click()};
function deleteConvo(ri,ci){const r=S.roleCards[ri];if(r.convos.length<=1){toast('至少保留一段对话',true);return}if(!confirm('删除对话「'+(r.convos[ci].title||'')+'」？此对话的消息和记忆都会删掉。'))return;const delId=r.convos[ci].id;r.convos.splice(ci,1);if(r.curConvo===delId)r.curConvo=r.convos[0].id;save();renderConvoList();renderThread();refreshTop()}

function newRole(o){o=o||{};const r={id:newId('r'),name:o.name||'新角色',roleName:o.roleName||o.name||'新角色',gender:o.gender||'',genderCustom:o.genderCustom||'',avatar:o.avatar||'',avShape:o.avShape||'round',greeting:'',greetings:o.greetings||[],persona:o.persona||'',lang:o.lang||'',inject:o.inject||'head',depth:o.depth||0,order:o.order!=null?o.order:100,worldIdx:0,wbIds:o.wbIds||[],bg:o.bg||''};r.convos=[newConvo('对话 1')];r.curConvo=r.convos[0].id;return r}
// ===== 新建角色交互修复 =====
$('drNew').onclick=()=>{
  $('newRoleScrim').classList.add('show');
  $('newRoleModal').classList.add('show');
};
$('btnNewRoleCancel').onclick=()=>{
  $('newRoleModal').classList.remove('show');
  $('newRoleScrim').classList.remove('show');
};
$('newRoleScrim').onclick=$('btnNewRoleCancel').onclick;

$('btnNewRoleManual').onclick=()=>{
  $('newRoleModal').classList.remove('show');
  $('newRoleScrim').classList.remove('show');
  const n=prompt('新角色名称：','');
  if(n==null)return;
  const r=newRole({name:n||'新角色'});
  S.roleCards.push(r);
  S.roleIdx=S.roleCards.length-1;
  save();renderThread();refreshTop();closeDrawer();openRolePanel();toast('已创建');
};

$('btnNewRoleImport').onclick=()=>{
  $('newRoleModal').classList.remove('show');
  $('newRoleScrim').classList.remove('show');
  closeDrawer();
  $('cardImportFile').click();
};

$('meBtn').onclick=()=>{closeDrawer();openUserPanel()};
$('topId').onclick=()=>{if(hasRole())openRolePanel();else openDrawer()};
let pickTarget=null,pickMode='plain',cropCb=null;
function pickImage(cb){pickTarget=cb;pickMode='plain';$('imgPick').click()}
function pickAvatar(cb){cropCb=cb;pickMode='crop';$('imgPick').click()}
$('imgPick').onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{if(pickMode==='crop'){openCrop(rd.result)}else{const img=new Image();img.onload=()=>{const max=512;let{width:w,height:h}=img;if(w>h&&w>max){h=h*max/w;w=max}else if(h>max){w=w*max/h;h=max}const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(img,0,0,w,h);pickTarget&&pickTarget(cv.toDataURL('image/jpeg',0.82));pickTarget=null};img.src=rd.result}};rd.readAsDataURL(f);e.target.value=''};

let cropState={scale:1,minScale:1,x:0,y:0,natW:0,natH:0,stageW:0,hole:0,holeOff:0};
function openCrop(src){
  const im=$('cropImg');const st=$('cropStage');
  im.onload=()=>{
    const sw=st.clientWidth;cropState.stageW=sw;cropState.natW=im.naturalWidth;cropState.natH=im.naturalHeight;
    cropState.holeOff=sw*0.08;cropState.hole=sw*0.84;
    const hole=cropState.hole;
    const base=Math.max(hole/im.naturalWidth,hole/im.naturalHeight);
    cropState.minScale=base;cropState.scale=base;
    $('cropZoom').min=base;$('cropZoom').max=base*3.5;$('cropZoom').step=base/120;$('cropZoom').value=base;
    cropState.x=cropState.holeOff+(hole-im.naturalWidth*base)/2;
    cropState.y=cropState.holeOff+(hole-im.naturalHeight*base)/2;
    applyCropTransform();
  };
  im.src=src;
  $('cropScrim').classList.add('show');$('cropModal').classList.add('show');
}
function closeCrop(){$('cropModal').classList.remove('show');$('cropScrim').classList.remove('show')}
function applyCropTransform(){const im=$('cropImg');clampCrop();im.style.width=cropState.natW*cropState.scale+'px';im.style.height=cropState.natH*cropState.scale+'px';im.style.transform=`translate(${cropState.x}px,${cropState.y}px)`}
function clampCrop(){const off=cropState.holeOff,hole=cropState.hole;const iw=cropState.natW*cropState.scale,ih=cropState.natH*cropState.scale;const minX=off+hole-iw,maxX=off;const minY=off+hole-ih,maxY=off;cropState.x=Math.min(maxX,Math.max(minX,cropState.x));cropState.y=Math.min(maxY,Math.max(minY,cropState.y))}
$('cropZoom').oninput=()=>{const cx=cropState.holeOff+cropState.hole/2,cy=cx;const old=cropState.scale,ns=+$('cropZoom').value,k=ns/old;cropState.x=cx-(cx-cropState.x)*k;cropState.y=cy-(cy-cropState.y)*k;cropState.scale=ns;applyCropTransform()};
(function(){const st=$('cropStage');let drag=false,lx=0,ly=0,pinch=false,pd=0,ps=1;
  st.addEventListener('pointerdown',e=>{if(pinch)return;drag=true;lx=e.clientX;ly=e.clientY;try{st.setPointerCapture(e.pointerId)}catch(_){}});
  st.addEventListener('pointermove',e=>{if(!drag)return;cropState.x+=e.clientX-lx;cropState.y+=e.clientY-ly;lx=e.clientX;ly=e.clientY;applyCropTransform()});
  st.addEventListener('pointerup',()=>drag=false);st.addEventListener('pointercancel',()=>drag=false);
  st.addEventListener('touchstart',e=>{if(e.touches.length===2){pinch=true;drag=false;pd=tdist(e);ps=cropState.scale}},{passive:false});
  st.addEventListener('touchmove',e=>{if(pinch&&e.touches.length===2){e.preventDefault();const nd=tdist(e);let ns=ps*nd/pd;ns=Math.max(cropState.minScale,Math.min(cropState.minScale*3.5,ns));const cx=cropState.holeOff+cropState.hole/2,cy=cx,k=ns/cropState.scale;cropState.x=cx-(cx-cropState.x)*k;cropState.y=cy-(cy-cropState.y)*k;cropState.scale=ns;$('cropZoom').value=ns;applyCropTransform()}},{passive:false});
  st.addEventListener('touchend',e=>{if(e.touches.length<2)pinch=false});
  function tdist(e){const a=e.touches[0],b=e.touches[1];return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)}
})();
$('cropCancel').onclick=closeCrop;
$('cropOk').onclick=()=>{
  const off=cropState.holeOff,hole=cropState.hole;
  const sx=(off-cropState.x)/cropState.scale, sy=(off-cropState.y)/cropState.scale, sSize=hole/cropState.scale;
  const out=320;const cv=document.createElement('canvas');cv.width=out;cv.height=out;const ctx=cv.getContext('2d');
  ctx.drawImage($('cropImg'),sx,sy,sSize,sSize,0,0,out,out);
  const data=cv.toDataURL('image/jpeg',0.85);cropCb&&cropCb(data);cropCb=null;closeCrop();
};
const CAM='<div class="cam"><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>';
function setAvEdit(el,src,fb){el.innerHTML=CAM;el.insertBefore(document.createTextNode(src?'':(fb||'?').charAt(0).toUpperCase()),el.firstChild);if(src){el.style.backgroundImage=`url(${src})`;el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.style.backgroundRepeat='no-repeat'}else{el.style.backgroundImage='';el.style.backgroundColor=''}}
function fillInject(sel,val){sel.innerHTML='';INJECT_OPTS.forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;sel.append(o)});sel.value=val||'tail'}
function fillSel(sel,names,idx){sel.innerHTML='';names.forEach((n,i)=>{const o=document.createElement('option');o.value=i;o.textContent=n;sel.append(o)});sel.value=idx}
function bindDepth(injSel,depthIn){const upd=()=>{depthIn.style.display=injSel.value==='depth'?'block':'none'};injSel.addEventListener('change',upd);upd()}

let tmpRoleAv=null,tmpRoleBg=null,tmpRoleCallBg=null,tmpShape='round';
function applyShapePreview(){$('roleAvPic').style.borderRadius=tmpShape==='square'?'18px':'50%';$('shapeRound').style.borderColor=tmpShape==='round'?'var(--accent)':'var(--line)';$('shapeRound').style.color=tmpShape==='round'?'var(--accent)':'var(--ink-dim)';$('shapeSquare').style.borderColor=tmpShape==='square'?'var(--accent)':'var(--line)';$('shapeSquare').style.color=tmpShape==='square'?'var(--accent)':'var(--ink-dim)'}
$('shapeRound').onclick=()=>{tmpShape='round';applyShapePreview()};
$('shapeSquare').onclick=()=>{tmpShape='square';applyShapePreview()};
function openRolePanel(){if(!hasRole()){return}syncRoleForm();$('rolePanel').classList.add('show')}
function closeRolePanel(){pullRoleForm();save();$('rolePanel').classList.remove('show');renderThread();refreshTop()}
$('btnSettingsTop').onclick=()=>openSettings();
$('roleBack').onclick=closeRolePanel;$('roleSave').onclick=closeRolePanel;$('roleSaveBig').onclick=()=>{pullRoleForm();save();refreshTop();toast('已保存');closeRolePanel()};
$('btnExportRole')&&($('btnExportRole').onclick=()=>{pullRoleForm();save();exportRoleCard()});
function syncRoleForm(){const r=curRole();tmpRoleAv=r.avatar;tmpRoleBg=r.bg;tmpRoleCallBg=r.callBg||'';tmpShape=r.avShape||'round';$('roleName').value=r.roleName||'';$('roleGender').value=r.gender||'';$('roleGenderCustom').value=r.genderCustom||'';updGenderCustom();$('roleLang').value=r.lang||'';$('persona').value=r.persona||'';setAvEdit($('roleAvPic'),r.avatar,r.roleName);applyShapePreview();fillInject($('roleInject'),r.inject);$('roleDepth').value=r.depth??0;$('roleOrder').value=r.order??100;bindDepth($('roleInject'),$('roleDepth'));setBg($('roleBgThumb'),r.bg);
  if($('roleCallBgThumb')) setBg($('roleCallBgThumb'),r.callBg);refreshGreetCount();refreshRoleWbCount()}
function refreshGreetCount(){const r=curRole();if(!r)return;const n=(r.greetings||[]).filter(s=>(s||'').trim()).length;$('greetCount').textContent=n+' 条'}
function refreshRoleWbCount(){const r=curRole();if(!r)return;const ids=r.wbIds||[];const n=ids.filter(id=>(S.worldBook||[]).some(w=>w.id===id)).length;$('roleWbCount').textContent=n?('已绑定 '+n+' 条'):'未绑定'}
function updGenderCustom(){$('roleGenderCustomWrap').style.display=$('roleGender').value==='其他'?'block':'none'}
function pullRoleForm(){const r=curRole();if(!r)return;r.roleName=$('roleName').value;r.name=r.roleName||r.name;r.gender=$('roleGender').value;r.genderCustom=$('roleGenderCustom').value;r.lang=$('roleLang').value;r.persona=$('persona').value;r.avShape=tmpShape;r.inject=$('roleInject').value;r.depth=+$('roleDepth').value||0;r.order=+$('roleOrder').value||0;r.avatar=tmpRoleAv||'';r.bg=tmpRoleBg||'';r.callBg=tmpRoleCallBg||''}
$('roleAvPic').onclick=()=>pickAvatar(d=>{tmpRoleAv=d;setAvEdit($('roleAvPic'),d,'')});
$('roleGender').onchange=updGenderCustom;
function deleteRole(i){
  if(!confirm('删除「'+(S.roleCards[i].roleName||'')+'」及其全部对话？'))return;
  const delId=S.roleCards[i].id;if(delId&&S.stickers.perRole[delId])delete S.stickers.perRole[delId];
  // 清理该角色专属世界书条目
  if(delId&&Array.isArray(S.worldBook))S.worldBook=S.worldBook.filter(w=>!(w.scope==='role'&&w.roleId===delId));
  S.roleCards.splice(i,1);
  if(S.roleIdx>=S.roleCards.length)S.roleIdx=Math.max(0,S.roleCards.length-1);
  save();renderThread();refreshTop();
  if(drMode==='convos'){drMode='roles';showRolesView()}
  renderRoleList();
}
$('roleDelBig').onclick=()=>{const i=S.roleIdx;$('rolePanel').classList.remove('show');deleteRole(i);if(!hasRole())openDrawer()};
$('roleBgPick').onclick=()=>pickImage(d=>{tmpRoleBg=d;setBg($('roleBgThumb'),d)});
$('roleBgClear').onclick=()=>{tmpRoleBg='';setBg($('roleBgThumb'),'')};
if($('roleCallBgPick')) {
  $('roleCallBgPick').onclick=()=>pickImage(d=>{tmpRoleCallBg=d;setBg($('roleCallBgThumb'),d)});
  $('roleCallBgClear').onclick=()=>{tmpRoleCallBg='';setBg($('roleCallBgThumb'),'')};
}

let tmpUserAv=null;
function openUserPanel(){syncUserForm();$('userPanel').classList.add('show')}
function closeUserPanel(){pullUserForm();save();$('userPanel').classList.remove('show');refreshMe()}
$('userBack').onclick=closeUserPanel;$('userSave').onclick=closeUserPanel;$('userSaveBig').onclick=()=>{pullUserForm();save();refreshMe();toast('已保存');closeUserPanel()};
function syncUserForm(){fillSel($('userPreset'),S.userCards.map(u=>u.userName||u.name),S.userIdx);const u=curUser();tmpUserAv=u.avatar;$('userName').value=u.userName||'';$('userPersona').value=u.persona||'';setAvEdit($('userAvPic'),u.avatar,u.userName);fillInject($('userInject'),u.inject);$('userDepth').value=u.depth??0;$('userOrder').value=u.order??100;bindDepth($('userInject'),$('userDepth'))}
function pullUserForm(){const u=curUser();u.userName=$('userName').value;u.name=u.userName||u.name;u.persona=$('userPersona').value;u.inject=$('userInject').value;u.depth=+$('userDepth').value||0;u.order=+$('userOrder').value||0;u.avatar=tmpUserAv||''}
$('userAvPic').onclick=()=>pickAvatar(d=>{tmpUserAv=d;setAvEdit($('userAvPic'),d,'')});
$('userPreset').onchange=()=>{pullUserForm();save();S.userIdx=+$('userPreset').value;save();syncUserForm()};
$('userNew').onclick=()=>{const n=prompt('新身份名称：','');if(n==null)return;pullUserForm();S.userCards.push({name:n||'我',userName:n||'我',avatar:'',persona:'',inject:'tail',depth:0,order:100});S.userIdx=S.userCards.length-1;save();syncUserForm();toast('已新建')};
$('userRename').onclick=()=>{const n=prompt('改名：',curUser().name);if(n==null||!n.trim())return;curUser().name=n.trim();curUser().userName=n.trim();save();syncUserForm()};
$('userDel').onclick=()=>{if(S.userCards.length<=1){toast('至少保留一个',true);return}if(!confirm('删除此身份？'))return;S.userCards.splice(S.userIdx,1);S.userIdx=0;save();syncUserForm();toast('已删除')};
