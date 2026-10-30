const $ = id => document.getElementById(id);
const hostedDashboard=document.documentElement.dataset.mode==='public';
const snapshotEndpoint=document.documentElement.dataset.snapshotUrl||'/api/data';
let data, selectedKey = null, busy = false, budgetsDirty = false, savingBudgets = false, budgetRevision = 0;
let requestingCheck = false, checkPoll = null, selectedZone = 'all';
const budgetFields = [['budget2','courtside'],['budget5','rows2to5'],['budgetAll','lower'],['budgetOther','otherFront']];
const zoneColors = {courtside:'#f8c74c',rows2to5:'#73aafa',lower:'#74d8b3',otherFront:'#c3a3f5'};
const hiddenChartZones = new Set();
let budgetDrag=null;
function chartLimits(){return Object.fromEntries(budgetFields.map(([id,key])=>{
  const input=$(id), value=Number(input.value);
  return [key,budgetsDirty&&input.value.trim()!==''&&Number.isInteger(value)&&value>=0&&value<=10000?value:data.limits[key]];
}));}
function markBudgetDirty(){budgetsDirty=true;$('budget-status').textContent='Unsaved changes. Save thresholds to apply them to alerts.';budgetButtons();}
function setBudgetDraft(key,value){$(budgetFields.find(([,band])=>band===key)[0]).value=value;markBudgetDirty();}
function inZone(x){return selectedZone==='all'||x.band===selectedZone;}
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const time = t => new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'});
function el(tag, text, cls) {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function selectedRows() {return data.listings.filter(x=>inZone(x)&&($('section').value==='all'||x.section===$('section').value)&&($('rows').value==='all'||x.row<=Number($('rows').value))&&(!$('deals').checked||x.qualifies));}
function render() {
  const all=data.listings, lower=all.filter(x=>x.level==='Lower'), first=lower.filter(x=>x.row<=5).sort((a,b)=>a.price-b.price)[0], low=lower[0];
  $('low').textContent=low?money(low.price):'—';$('low-seat').textContent=low?`Section ${low.section} · Row ${low.row}`:'No seated inventory captured';
  $('front').textContent=first?money(first.price):'—';$('front-seat').textContent=first?`Section ${first.section} · Row ${first.row}`:'No front-row inventory captured';
  $('qualifying').textContent=all.filter(x=>x.qualifies).length;$('last').textContent=data.capturedAt?time(data.capturedAt):'—';$('capture-count').textContent=`${all.length} tracked listings observed`;
  const age=data.capturedAt?Math.max(0,(Date.now()-new Date(data.capturedAt))/1000):Infinity;
  const stale=age>data.maxAgeSeconds;
  const standalone=data.runner==='standalone', runtime=data.runtime||{};
  renderCheckState();renderZones();
  const workerError=standalone&&(!runtime.processAlive||runtime.state==='error'||runtime.state==='warning');
  $('health').textContent=data.finished?'Monitoring window ended':workerError?'Standalone monitor needs attention':standalone?'Standalone monitor running':stale?'Browser data needs a refresh':'Recent browser observation';
  $('notice').className='notice'+(stale||workerError?' warning':'');
  $('notice').textContent=data.finished?'Tipoff cutoff reached. Showing the last recorded snapshot.':stale?'The browser snapshot is over 10 minutes old. Displayed listings may be outdated; check the monitor in Codex.':`Snapshot from ${time(data.capturedAt)} Pacific. Browser checks are scheduled every ${data.intervalMinutes} minutes; availability can change between checks.`;
  if(workerError&&!data.finished)$('notice').textContent=!runtime.processAlive?'Standalone worker is not running. Start it with start-monitor.ps1. Displaying the last saved ticket data.':`The last browser check needs attention: ${runtime.error||'verification incomplete'}. The worker will retry; displayed prices may be outdated.`;
  else if(standalone&&stale&&!data.finished)$('notice').textContent='The last successful browser snapshot is over 10 minutes old. The worker is running, but displayed listings may be outdated.';
  if(data.readOnly){
    $('health').textContent=data.finished?'Monitoring window ended':stale?'Shared prices are outdated':'Shared dashboard';
    $('notice').textContent=data.finished?'The monitoring window has ended. Showing the last shared snapshot.':stale?`Last ticket check ${time(data.capturedAt)} Pacific. These prices are over ${Math.round(data.maxAgeSeconds/60)} minutes old; the home computer may be offline.`:`Ticket check ${time(data.capturedAt)} Pacific · Uploaded ${time(data.publishedAt)} Pacific. Availability can change between checks.`;
    $('check-now').hidden=true;$('budget-status').textContent='View-only. Budgets are managed on the computer running the monitor.';
    budgetButtons();
  }
  if(!budgetsDirty&&!savingBudgets)fillBudgets();
  $('monitor-description').textContent=standalone?`Windows notifications · checks every ${data.intervalMinutes} minutes until tipoff. No AI tokens. Keep this computer awake and online; Codex can be closed.`:`Alerts in Codex · checks every ${data.intervalMinutes} minutes until tipoff. Keep Codex open and this computer awake.`;
  if(data.readOnly)$('monitor-description').textContent=`The home computer checks tickets about every ${data.intervalMinutes} minutes and uploads snapshots here. Monitoring and Windows notifications run on that computer.`;
  $('next-check').textContent=standalone&&runtime.nextCheckAt&&!data.finished?`Next check around ${time(runtime.nextCheckAt)} Pacific.`:'';
  $('sharing-status').replaceChildren();
  if(!data.readOnly&&data.sharing?.url){const link=el('a','Open shared dashboard ↗');link.href=data.sharing.url;link.target='_blank';link.rel='noopener noreferrer';$('sharing-status').append(link,el('span',data.sharing.state==='error'?' · Upload failed; monitoring continues locally.':` · Last upload ${time(data.sharing.publishedAt)} Pacific`));}
  const rows=selectedRows(), sort=$('sort').value;
  rows.sort((a,b)=>sort==='price'?a.price-b.price:sort==='row'?a.row-b.row||a.price-b.price:sort==='drop'?a.change-b.change||a.price-b.price:Number(b.qualifies)-Number(a.qualifies)||Object.keys(data.zones).indexOf(a.band)-Object.keys(data.zones).indexOf(b.band)||a.price-b.price);
  $('listings').replaceChildren();
  for(const x of rows){const tr=el('tr',undefined,`${x.qualifies?'qualified ':''}${selectedKey===x.key?'selected':''}`);tr.tabIndex=0;tr.setAttribute('aria-label',`Show price history for section ${x.section}, row ${x.row}`);
    const seat=el('td');seat.append(el('b',`${x.level} ${x.section}`),el('small',`Row ${x.row}${x.row<=5?' · FRONT ROWS':''}`));tr.append(seat);
    const price=el('td');price.append(el('span',money(x.price),'price'),el('small','1 ticket · includes fees'));tr.append(price);
    const change=el('td',x.change===0?'—':`${x.change>0?'+':'−'}${money(Math.abs(x.change))}`,x.change<0?'drop':x.change>0?'rise':'flat');tr.append(change);
    const status=el('td');status.append(el('span',x.qualifies?'Within budget':x.zone,`badge ${x.qualifies?'good':x.row<=5?'front':''}`));if(x.verifiedAt)status.append(el('small',`Verified ${time(x.verifiedAt)}`));else status.append(el('small','From listing page'));tr.append(status);
    const action=el('td'), a=el('a','View ↗','ticket-link');a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',`View section ${x.section} row ${x.row} on Gametime`);a.addEventListener('click',e=>e.stopPropagation());action.append(a);tr.append(action);
    const choose=()=>{selectedKey=x.key;render();};tr.addEventListener('click',choose);tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});$('listings').append(tr);
  }
  $('empty').hidden=rows.length!==0;$('result-count').textContent=`${rows.length} listings`;drawChart();
}
function drawChart(){
  if(budgetDrag)return;
  const limits=chartLimits();
  const section=$('section').value, rowMax=$('rows').value==='all'?Infinity:Number($('rows').value);
  const zones=Object.keys(data.zones);
  const points=data.history.map(p=>{
    const rows=p.rows.filter(x=>inZone(x)&&(section==='all'||x.section===section)&&x.row<=rowMax&&(!selectedKey||x.key===selectedKey));
    const values={};for(const key of zones){const prices=rows.filter(x=>x.band===key).map(x=>x.price);values[key]=prices.length?Math.min(...prices):null;}
    return {at:p.at,...values};
  });
  $('chart-subtitle').textContent=selectedKey?`Section ${selectedKey.split(':')[0]} · Row ${selectedKey.split(':')[1]}`:section==='all'?(selectedZone==='all'?'Cheapest tracked tickets':data.zones[selectedZone]):`Cheapest observed in Section ${section}`;
  $('clear-chart').hidden=!selectedKey;const target=$('chart');target.replaceChildren();
  $('chart-legend').replaceChildren();
  for(const key of zones){
    const visible=!hiddenChartZones.has(key), last=points.at(-1)?.[key], button=el('button',undefined,'chart-legend-item');
    button.type='button';button.dataset.chartZone=key;button.setAttribute('aria-pressed',String(visible));
    button.setAttribute('aria-label',`${visible?'Hide':'Show'} ${data.zones[key]} price and budget lines`);
    const swatch=el('i');swatch.style.background=zoneColors[key];
    const copy=el('div',undefined,'chart-legend-copy'), gap=last==null?null:last-limits[key];
    const distance=gap===null?'No current offer':gap===0?'At budget':`${money(Math.abs(gap))} ${gap>0?'over':'below'} budget`;
    copy.append(el('span',data.zones[key]),el('small',`Budget ${money(limits[key])} · ${distance}`,'chart-budget-summary'+(gap!==null&&gap<=0?' within-budget':'')));
    button.append(swatch,copy,el('strong',last==null?'—':money(last)));
    button.addEventListener('click',()=>{if(hiddenChartZones.has(key))hiddenChartZones.delete(key);else hiddenChartZones.add(key);drawChart();});
    $('chart-legend').append(button);
  }
  $('chart-legend').append(el('p',`Solid = asking prices · Dashed = ${budgetsDirty?'unsaved budget preview':'saved budgets'}.${data.readOnly?' View-only shared snapshot.':' Drag a colored handle; release to save that zone.'}`,'chart-line-key'));
  const active=zones.filter(key=>!hiddenChartZones.has(key)), valid=points.flatMap(p=>active.map(key=>p[key])).filter(x=>x!==null);
  if(!valid.length){target.append(el('p',active.length?'No matching price history yet.':'Select a zone in the legend to show its price history.','footnote'));$('chart-detail').textContent='Each line tracks the cheapest observed ticket in its zone.';return;}
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 360 240');svg.setAttribute('role','group');svg.setAttribute('aria-label','Cheapest all-in ticket prices over time by seat zone');
  const node=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;};
  const budgetZones=active.filter(key=>(selectedZone==='all'||selectedZone===key)&&(!selectedKey||points.some(p=>p[key]!==null)));
  const domain=[...valid,...budgetZones.map(key=>limits[key])];
  const min=Math.max(0,Math.floor(Math.min(...domain)*.9/10)*10), max=Math.ceil(Math.max(...domain)*1.08/10)*10||10;
  const first=new Date(points[0].at).getTime(),last=new Date(points.at(-1).at).getTime();const X=p=>49+(last===first?144:288*(new Date(p.at).getTime()-first)/(last-first)),Y=v=>192-168*(v-min)/(max-min);
  for(let i=0;i<4;i++){const value=min+(max-min)*i/3;node('line',{x1:49,y1:Y(value),x2:337,y2:Y(value),stroke:'#2b3a50','stroke-dasharray':'3 4'});node('text',{x:2,y:Y(value)+3},money(value));}
  const budgetControls=[];
  for(const key of budgetZones){
    const budget=limits[key], shared=budgetZones.filter(other=>limits[other]===budget);
    // Interleave colors when multiple zones have the same threshold.
    const dash=shared.length>1?`5 ${shared.length*7-5}`:'6 5';
    const label=`${data.zones[key]} budget: ${money(budget)} including fees. Drag its handle to adjust.`;
    const line=node('line',{x1:49,y1:Y(budget),x2:337,y2:Y(budget),stroke:zoneColors[key],'stroke-width':1.8,'stroke-dasharray':dash,'stroke-dashoffset':shared.indexOf(key)*7,'data-budget-zone':key,'data-budget':budget});
    const title=document.createElementNS(ns,'title');title.textContent=label;line.append(title);
    if(data.readOnly){title.textContent=`${data.zones[key]} saved budget: ${money(budget)}`;line.setAttribute('tabindex','0');line.setAttribute('role','img');line.setAttribute('aria-label',title.textContent);line.addEventListener('focus',()=>{$('chart-detail').textContent=title.textContent;});continue;}
    const x=78+zones.indexOf(key)*76;
    // Separate handles keep zones independently selectable at equal budgets.
    const hit=node('line',{x1:49,y1:Y(budget),x2:337,y2:Y(budget),stroke:'transparent','stroke-width':14,'vector-effect':'non-scaling-stroke','data-budget-hit':key});
    const handle=node('circle',{cx:x,cy:Y(budget),r:5,fill:zoneColors[key],stroke:'#0b101a','stroke-width':1.5,'data-budget-handle-visual':key});
    const grip=node('circle',{cx:x,cy:Y(budget),r:12,fill:'transparent',tabindex:0,role:'slider','aria-label':`${data.zones[key]} budget`,'aria-orientation':'vertical','aria-valuemin':0,'aria-valuemax':10000,'aria-valuenow':budget,'aria-valuetext':`${money(budget)}, ${budgetsDirty?'unsaved':'saved'}`,'data-budget-handle':key});
    const update=value=>{
      const y=Y(value);line.setAttribute('y1',y);line.setAttribute('y2',y);line.setAttribute('data-budget',value);hit.setAttribute('y1',y);hit.setAttribute('y2',y);
      for(const dot of [handle,grip])dot.setAttribute('cy',y);
      grip.setAttribute('aria-valuenow',value);grip.setAttribute('aria-valuetext',`${money(value)}, unsaved`);
      const last=points.at(-1)?.[key], gap=last==null?null:last-value;
      const summary=$('chart-legend').querySelector(`[data-chart-zone="${key}"] small`);
      summary.textContent=`Budget ${money(value)} · ${gap===null?'No current offer':gap===0?'At budget':`${money(Math.abs(gap))} ${gap>0?'over':'below'} budget`}`;
      summary.classList.toggle('within-budget',gap!==null&&gap<=0);
      $('chart-legend').querySelector('.chart-line-key').textContent='Release the handle to save this zone automatically.';
      $('chart-detail').textContent=`${data.zones[key]} budget: ${money(value)} · Release to save`;
      $('budget-status').textContent=`Release to save ${data.zones[key]} at ${money(value)}. Escape cancels this drag.`;
    };
    const start=event=>{
      if(savingBudgets||budgetDrag||event.button!==0)return;
      event.preventDefault();budgetRevision++;
      const input=$(budgetFields.find(([,band])=>band===key)[0]);
      budgetDrag={svg,key,pointerId:event.pointerId,oldValue:input.value,wasDirty:budgetsDirty,oldStatus:$('budget-status').textContent,update};
      document.body.classList.add('budget-dragging');svg.setPointerCapture(event.pointerId);
    };
    for(const control of [line,hit,grip])control.addEventListener('pointerdown',start);
    grip.addEventListener('focus',()=>{$('chart-detail').textContent=`${data.zones[key]} budget: ${money(chartLimits()[key])}. Use arrow keys to adjust; Shift changes by $10.`;});
    grip.addEventListener('keydown',event=>{
      if(savingBudgets||budgetDrag)return;
      const step=event.shiftKey?10:1, changes={ArrowUp:step,ArrowRight:step,ArrowDown:-step,ArrowLeft:-step,PageUp:25,PageDown:-25};
      if(!(event.key in changes)&&!['Home','End'].includes(event.key))return;
      event.preventDefault();const value=event.key==='Home'?0:event.key==='End'?10000:Math.max(0,Math.min(10000,chartLimits()[key]+changes[event.key]));
      setBudgetDraft(key,value);drawChart();$('chart').querySelector(`[data-budget-handle="${key}"]`)?.focus({preventScroll:true});
    });
    budgetControls.push(hit,handle,grip);
  }
  for(const key of active){
    const color=zoneColors[key];let segment=[];
    const flush=()=>{if(segment.length>1)node('polyline',{points:segment.join(' '),fill:'none',stroke:color,'stroke-width':2.5,'data-zone':key});segment=[];};
    for(const p of points){
      if(p[key]===null){flush();continue;}
      segment.push(`${X(p)},${Y(p[key])}`);
      const label=`${time(p.at)} · ${data.zones[key]}: ${money(p[key])} including fees`;
      const dot=node('circle',{cx:X(p),cy:Y(p[key]),r:3.5,fill:color,tabindex:0,role:'img','aria-label':label,'data-zone':key});
      const title=document.createElementNS(ns,'title');title.textContent=label;dot.append(title);
      for(const event of ['pointerenter','focus','click'])dot.addEventListener(event,()=>{$('chart-detail').textContent=label;});
    }
    flush();
  }
  // Keep targets above price lines; SVG coordinates account for scaling in both views.
  for(const control of budgetControls.filter(node=>node.hasAttribute('data-budget-hit')))svg.append(control);
  for(const control of budgetControls.filter(node=>!node.hasAttribute('data-budget-hit')))svg.append(control);
  svg.addEventListener('pointermove',event=>{
    if(!budgetDrag||budgetDrag.pointerId!==event.pointerId)return;
    event.preventDefault();const matrix=svg.getScreenCTM();if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const value=Math.max(0,Math.min(10000,Math.round(max-(Math.max(24,Math.min(192,point.y))-24)*(max-min)/168)));
    setBudgetDraft(budgetDrag.key,value);budgetDrag.update(value);
  });
  svg.addEventListener('pointerup',event=>{if(budgetDrag?.pointerId===event.pointerId)finishBudgetDrag(false);});
  for(const event of ['pointercancel','lostpointercapture'])svg.addEventListener(event,eventData=>{if(budgetDrag?.svg===svg&&budgetDrag.pointerId===eventData.pointerId)finishBudgetDrag(true);});
  node('text',{x:49,y:222},time(points[0].at));if(points.length>1)node('text',{x:337,y:222,'text-anchor':'end'},time(points.at(-1).at));target.append(svg);
  $('chart-detail').textContent=`${points.length} browser snapshots. ${points.length<2?'More history will appear after the next check.':'Hover or tap a point for its zone and price. Toggle legend entries to compare lines.'}`;
}
async function load(){if(busy||savingBudgets||requestingCheck||budgetDrag)return;busy=true;const revision=budgetRevision;$('refresh').disabled=true;try{const response=await fetch(hostedDashboard?snapshotEndpoint+(snapshotEndpoint.includes('?')?'&':'?')+'updated='+Date.now():snapshotEndpoint,{cache:'no-store'});if(!response.ok)throw Error('Data unavailable');const fresh=await response.json();if(revision!==budgetRevision)return;data=fresh;if(hostedDashboard){data.readOnly=true;data.finished=Date.now()>=new Date(data.tipoff).getTime();}const prior=$('section').value;const sections=[...new Set(data.listings.map(x=>x.section))].sort();$('section').replaceChildren(new Option('All tracked sections','all'),...sections.map(s=>new Option(`Section ${s}`,s)));$('section').value=sections.includes(prior)?prior:'all';render();}catch(error){$('health').textContent='Dashboard disconnected';$('notice').className='notice warning';$('notice').textContent='Cannot read the monitor data. Showing the previous display, which may be outdated. Refresh to retry.';}finally{busy=false;$('refresh').disabled=false;}}
for(const id of ['section','rows','sort','deals'])$(id).addEventListener('change',()=>{if(id==='section'||id==='rows')selectedKey=null;if(data)render();});
function fillBudgets(){for(const [id,key]of [...budgetFields])$(id).value=data.limits[key];}
function budgetButtons(){ const readOnly=hostedDashboard||data?.readOnly;$('save-budgets').hidden=readOnly;$('save-budgets').disabled=!budgetsDirty||savingBudgets||readOnly;$('cancel-budgets').hidden=!budgetsDirty||readOnly;$('cancel-budgets').disabled=savingBudgets;for(const id of budgetFields.map(([id])=>id))$(id).disabled=savingBudgets||readOnly;}
for(const id of budgetFields.map(([id])=>id))$(id).addEventListener('input',()=>{markBudgetDirty();if(data)drawChart();});
$('cancel-budgets').addEventListener('click',()=>{budgetsDirty=false;fillBudgets();budgetButtons();if(data)drawChart();$('budget-status').textContent='Changes canceled. Saved thresholds are unchanged.';});

function finishBudgetDrag(cancel){
  const drag=budgetDrag;if(!drag)return;budgetDrag=null;
  const input=$(budgetFields.find(([,key])=>key===drag.key)[0]), changed=input.value!==drag.oldValue;
  if(cancel||!changed){input.value=drag.oldValue;budgetsDirty=drag.wasDirty;$('budget-status').textContent=drag.oldStatus;budgetButtons();}
  if(drag.svg.hasPointerCapture(drag.pointerId))drag.svg.releasePointerCapture(drag.pointerId);
  document.body.classList.remove('budget-dragging');drawChart();
  if(!cancel&&changed)saveBudgets(drag.key);
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&budgetDrag){event.preventDefault();event.stopPropagation();finishBudgetDrag(true);}},true);
async function saveBudgets(onlyKey=null){
  if(!data||hostedDashboard||data.readOnly||savingBudgets||budgetDrag||(!onlyKey&&!$('budget-form').reportValidity()))return;
  const limits=onlyKey?{...data.limits,[onlyKey]:chartLimits()[onlyKey]}:Object.fromEntries(budgetFields.map(([id,key])=>[key,Number($(id).value)]));
  if(!Object.values(limits).every(x=>Number.isInteger(x)&&x>=0&&x<=10000)){$('budget-status').textContent='Enter whole-dollar amounts from $0 to $10,000.';return;}
  savingBudgets=true;budgetRevision++;budgetButtons();$('budget-status').textContent=onlyKey?`Saving ${data.zones[onlyKey]}…`:'Saving…';
  try{const response=await fetch('/api/limits',{method:'POST',headers:{'Content-Type':'application/json','X-Dub-Watch':'dashboard'},body:JSON.stringify(limits)});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save thresholds.');data.limits=result.limits;
    for(const listing of data.listings){listing.limit=result.limits[listing.band];listing.qualifies=listing.price<=listing.limit;}
    if(onlyKey){$(budgetFields.find(([,key])=>key===onlyKey)[0]).value=result.limits[onlyKey];budgetsDirty=budgetFields.some(([id,key])=>$(id).value!==String(result.limits[key]));}
    else budgetsDirty=false;
    $('budget-status').textContent=onlyKey?`Saved ${data.zones[onlyKey]} at ${money(result.limits[onlyKey])}. Alerts use it on the next check.${budgetsDirty?' Other edits remain unsaved.':''}`:'Saved. Deal highlights updated; Windows alerts use these thresholds on the next check.';render();
  }catch(error){$('budget-status').textContent=`${onlyKey?'Auto-save failed. ':''}${error.message||'Could not save.'} Changes remain unsaved; use Save thresholds to retry.`;}
  finally{savingBudgets=false;budgetButtons();if(!budgetsDirty)fillBudgets();}
}
$('budget-form').addEventListener('submit',event=>{event.preventDefault();saveBudgets();});
$('clear-chart').addEventListener('click',()=>{selectedKey=null;render();});$('refresh').addEventListener('click',load);load();setInterval(load,15000);

function renderCheckState(){
  const runtime=data.runtime||{}, running=runtime.checking||runtime.checkRequested;
  $('check-now').disabled=requestingCheck||running||data.finished||data.runner!=='standalone'||!runtime.processAlive;
  $('check-now').textContent=running||requestingCheck?'Checking…':'Check now';
  if(running){
    $('check-status').textContent=runtime.checking?'Checking live ticket prices and verifying new deals…':'Check requested. Starting the ticket browser…';
    if(!checkPoll)checkPoll=setInterval(load,2000);
  }else if(checkPoll){
    clearInterval(checkPoll);checkPoll=null;
    $('check-status').textContent=runtime.state==='error'?`Check failed: ${runtime.error||'Please try again.'}`:runtime.state==='warning'?'Prices updated. Some potential deals could not be verified; see monitor status.':data.finished?'Tipoff cutoff reached. Ticket checks have ended.':!runtime.processAlive?'The monitor stopped. Start it with the Dub Watch desktop shortcut.':`Fresh prices loaded. Last check ${time(data.capturedAt)} Pacific.`;
  }
}
$('check-now').addEventListener('click',async()=>{
  if(!data||$('check-now').disabled)return;
  requestingCheck=true;budgetRevision++;renderCheckState();$('check-status').textContent='Requesting a fresh ticket check…';
  try{
    const response=await fetch('/api/check',{method:'POST',headers:{'Content-Type':'application/json','X-Dub-Watch':'dashboard'},body:'{}'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not start the check.');
    data.runtime.checkRequested=result.status==='queued';data.runtime.checking=result.status==='checking';
  }catch(error){$('check-status').textContent=error.message||'Could not start the check. Please retry.';}
  finally{requestingCheck=false;renderCheckState();}
});

function renderZones(){
  $('zone-cards').replaceChildren();
  for(const [key,label]of Object.entries(data.zones)){
    const rows=data.listings.filter(x=>x.band===key), button=el('button',undefined,'zone-card'+(selectedZone===key?' active':''));
    button.type='button';button.setAttribute('aria-pressed',String(selectedZone===key));button.dataset.zone=key;
    button.append(el('span',label),el('strong',rows.length?money(Math.min(...rows.map(x=>x.price))):'No listings'),el('small',`${rows.length} listings | ${rows.filter(x=>x.qualifies).length} within budget`));
    button.addEventListener('click',()=>{selectedZone=selectedZone===key?'all':key;selectedKey=null;$('section').value='all';$('rows').value='all';render();});
    $('zone-cards').append(button);
  }
}
$('all-zones').addEventListener('click',()=>{selectedZone='all';selectedKey=null;$('section').value='all';$('rows').value='all';if(data)render();});

const marketDialog=$('market-dialog');
const marketPanels=[document.querySelector('.trend'),document.querySelector('.budgets')].map(panel=>{
  const marker=document.createComment('Market panel position');panel.before(marker);return {panel,marker};
});
let marketOpener=null, marketScrollY=0;
function expandMarket(event){
  if(marketDialog.open)return;
  marketOpener=event.currentTarget;marketScrollY=window.scrollY;
  for(const {panel}of marketPanels)$('market-dialog-panels').append(panel);
  document.body.classList.add('market-expanded');marketDialog.showModal();
}
for(const id of ['expand-market','expand-budgets'])$(id).addEventListener('click',expandMarket);
$('close-market').addEventListener('click',()=>marketDialog.close());
marketDialog.addEventListener('close',()=>{
  for(const {panel,marker}of marketPanels)marker.after(panel);
  document.body.classList.remove('market-expanded');marketOpener?.focus({preventScroll:true});
  window.scrollTo({top:marketScrollY,behavior:'instant'});
});
