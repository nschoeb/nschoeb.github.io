const $ = id => document.getElementById(id);
const hostedDashboard=document.documentElement.dataset.mode==='public';
const snapshotEndpoint=document.documentElement.dataset.snapshotUrl||'/api/data';
let data, selectedKey = null, busy = false, budgetsDirty = false, savingBudgets = false, budgetRevision = 0;
let upcomingGames=[],upcomingFetchedAt=null,upcomingLoaded=false,upcomingBusy=false,upcomingError='',addingUpcoming=null;
let activeGameId=new URLSearchParams(location.search).get('game'), reloadRequested=false;
function postHeaders(){return {'Content-Type':'application/json','X-Dub-Watch':'dashboard',...(activeGameId?{'X-Dub-Watch-Game':activeGameId}:{})};}
let requestingCheck = false, checkPoll = null, selectedZone = 'all';
const budgetFields = [['budgetCourt','courtside'],['budget2','row1'],['budget5','rows2to5'],['budgetAll','lower'],['budgetOther','otherFront']];
const zoneColors = {courtside:'#ef9b99',row1:'#f8c74c',rows2to5:'#73aafa',lower:'#74d8b3',otherFront:'#c3a3f5'};
const hiddenChartZones = new Set();
let budgetDrag=null;
function normalizeSeatZones(snapshot){
  // Older cached public snapshots used 'courtside' for ordinary lower row 1.
  // Correct those records before rendering while the CDN catches up.
  if(snapshot.zones&&!snapshot.zones.row1&&snapshot.zones.courtside){
    const {courtside,...otherZones}=snapshot.zones;
    snapshot.zones={courtside:'Court-side',row1:'Row 1',...otherZones};
    snapshot.limits={...snapshot.limits,row1:snapshot.limits.courtside};
    for(const row of [...snapshot.listings,...snapshot.history.flatMap(point=>point.rows)]){
      if(row.band==='courtside'){row.band='row1';row.zone='Row 1';}
    }
  }
  return snapshot;
}
function chartLimits(){return Object.fromEntries(budgetFields.map(([id,key])=>{
  const input=$(id), value=Number(input.value);
  return [key,budgetsDirty&&input.value.trim()!==''&&Number.isInteger(value)&&value>=0&&value<=10000?value:data.limits[key]];
}));}
function markBudgetDirty(){budgetsDirty=true;$('budget-status').textContent='Unsaved changes. Save thresholds to apply them to alerts.';budgetButtons();}
function setBudgetDraft(key,value){$(budgetFields.find(([,band])=>band===key)[0]).value=value;markBudgetDirty();}
function matchesRow(x){return $('rows').value==='all'||(typeof x.row==='number'&&x.row<=Number($('rows').value));}
function inZone(x){return selectedZone==='all'||x.band===selectedZone;}
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const time = t => t?new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'}):'—';
function el(tag, text, cls) {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function selectedRows() {return data.listings.filter(x=>inZone(x)&&($('section').value==='all'||x.section===$('section').value)&&matchesRow(x)&&(!$('deals').checked||(x.withinCap??x.price<=x.limit))&&(!$('exceptional').checked||x.exceptional));}
function render() {
  renderWatches();
  const automatic=data.dealScoring?.mode==='automatic';
  const all=data.listings, lower=all.filter(x=>x.level==='Lower'), first=lower.filter(x=>x.row<=5).sort((a,b)=>a.price-b.price)[0], low=lower[0];
  $('low').textContent=low?money(low.price):'—';$('low-seat').textContent=low?`Section ${low.section} · Row ${low.row}`:'No seated inventory captured';
  $('front').textContent=first?money(first.price):'—';$('front-seat').textContent=first?`Section ${first.section} · Row ${first.row}`:'No front-row inventory captured';
  $('qualifying').textContent=all.filter(x=>x.qualifies).length;$('last').textContent=data.capturedAt?time(data.capturedAt):'—';$('capture-count').textContent=`${all.length} tracked listings observed`;
  $('qualifying-label').textContent=automatic?'AUTOMATIC ALERT MATCHES':'WITHIN YOUR BUDGETS';
  $('budget-panel-title').textContent=automatic?'Spending caps':'Your deal zone';
  $('exceptional-filter').hidden=!automatic;$('deal-policy').hidden=!automatic;
  if(automatic)$('deal-policy').textContent=`Automatic deals: at least ${data.dealScoring.discountPercent}% below a same-section asking-price reference. Targets adjust with this game's market; dollar settings are spending caps. ${all.filter(x=>x.exceptional).length} exceptional offers, ${all.filter(x=>x.qualifies).length} within caps. Learning = insufficient comparisons. These are asking prices, not completed sales.`;
  const age=data.capturedAt?Math.max(0,(Date.now()-new Date(data.capturedAt))/1000):Infinity;
  const stale=age>data.maxAgeSeconds;
  const standalone=data.runner==='standalone', runtime=data.runtime||{};
  renderCheckState();renderZones();
  const workerError=standalone&&(!runtime.processAlive||runtime.state==='error'||runtime.state==='warning');
  $('health').textContent=data.finished?'Monitoring window ended':workerError?'Standalone monitor needs attention':standalone?'Standalone monitor running':stale?'Browser data needs a refresh':'Recent browser observation';
  $('notice').className='notice'+(stale||workerError?' warning':'');
  $('notice').textContent=data.finished?'Tipoff cutoff reached. Showing the last recorded snapshot.':stale?`This snapshot is over ${Math.round(data.maxAgeSeconds/60)} minutes old. Displayed listings may be outdated; check the standalone monitor.`:`Snapshot from ${time(data.capturedAt)} Pacific. Browser checks are scheduled every ${data.intervalMinutes} minutes; availability can change between checks.`;
  if(workerError&&!data.finished)$('notice').textContent=!runtime.processAlive?'Standalone worker is not running. Start it with start-monitor.ps1. Displaying the last saved ticket data.':`The last browser check needs attention: ${runtime.error||'verification incomplete'}. The worker will retry; displayed prices may be outdated.`;
  else if(standalone&&stale&&!data.finished)$('notice').textContent='The last successful browser snapshot is over 10 minutes old. The worker is running, but displayed listings may be outdated.';
  if(!data.capturedAt)$('notice').textContent='No ticket check recorded for this game yet. Its prices and deal targets will start learning after its first check.';
  if(data.readOnly){
    $('health').textContent=data.finished?'Monitoring window ended':stale?'Shared prices are outdated':'Shared dashboard';
    $('notice').textContent=data.finished?'The monitoring window has ended. Showing the last shared snapshot.':stale?`Last ticket check ${time(data.capturedAt)} Pacific. These prices are over ${Math.round(data.maxAgeSeconds/60)} minutes old; the home computer may be offline.`:`Ticket check ${time(data.capturedAt)} Pacific · Uploaded ${time(data.publishedAt)} Pacific. Availability can change between checks.`;
    $('check-now').hidden=true;$('budget-status').textContent='View-only. Budgets are managed on the computer running the monitor.';
    budgetButtons();
  }
  if(data.readOnly&&!data.capturedAt)$('notice').textContent='No ticket snapshot has been shared for this game yet. The home computer will upload its first check.';
  if(!data.capturedAt)$('health').textContent='Waiting for first check';
  if(data.watchEnabled===false&&!data.finished){$('health').textContent='Watch paused';$('notice').textContent='This watch is paused. Showing its last saved prices; automatic checks resume when the owner restarts this watch.';}
  if(!budgetsDirty&&!savingBudgets)fillBudgets();
  budgetButtons();
  $('monitor-description').textContent=standalone?`Windows notifications · checks every ${data.intervalMinutes} minutes until tipoff. No AI tokens. Keep this computer awake and online; Codex can be closed.`:`Alerts in Codex · checks every ${data.intervalMinutes} minutes until tipoff. Keep Codex open and this computer awake.`;
  if(data.readOnly)$('monitor-description').textContent=`The home computer checks tickets about every ${data.intervalMinutes} minutes and uploads snapshots here. Monitoring and Windows notifications run on that computer.`;
  $('next-check').textContent=standalone&&runtime.nextCheckAt&&!data.finished?`Next check around ${time(runtime.nextCheckAt)} Pacific.`:'';
  $('sharing-status').replaceChildren();
  if(!data.readOnly&&data.sharing?.url){const link=el('a','Open shared dashboard ↗');link.href=data.sharing.url+(activeGameId?'?game='+encodeURIComponent(activeGameId):'');link.target='_blank';link.rel='noopener noreferrer';$('sharing-status').append(link,el('span',data.sharing.state==='error'?' · Upload failed; monitoring continues locally.':` · Last upload ${time(data.sharing.publishedAt)} Pacific`));}
  if(!data.readOnly&&data.ownerAccess?.enabled){const link=el('a','Private owner dashboard ↗');link.href=data.ownerAccess.url+(activeGameId?'?game='+encodeURIComponent(activeGameId):'');link.target='_blank';link.rel='noopener noreferrer';$('sharing-status').append(el('span',' · '),link);}
  const rows=selectedRows(), sort=$('sort').value;
  rows.sort((a,b)=>sort==='price'?a.price-b.price:sort==='row'?String(a.row).localeCompare(String(b.row),'en',{numeric:true})||a.price-b.price:sort==='drop'?a.change-b.change||a.price-b.price:sort==='deal'?(b.discountPercent??-Infinity)-(a.discountPercent??-Infinity)||a.price-b.price:Number(b.qualifies)-Number(a.qualifies)||Number(!!b.exceptional)-Number(!!a.exceptional)||Object.keys(data.zones).indexOf(a.band)-Object.keys(data.zones).indexOf(b.band)||a.price-b.price);
  $('listings').replaceChildren();
  for(const x of rows){const tr=el('tr',undefined,`${x.qualifies?'qualified ':''}${selectedKey===x.key?'selected':''}`);tr.tabIndex=0;tr.setAttribute('aria-label',`Show price history for section ${x.section}, row ${x.row}`);
    tr.dataset.seatKey=x.key;
    const seat=el('td');seat.append(el('b',`${x.level} ${x.section}`),el('small',`Row ${x.row}${x.row<=5?' · FRONT ROWS':''}`));tr.append(seat);
    const price=el('td');price.append(el('span',money(x.price),'price'),el('small','1 ticket · includes fees'));tr.append(price);
    const change=el('td',x.change===0?'—':`${x.change>0?'+':'−'}${money(Math.abs(x.change))}`,x.change<0?'drop':x.change>0?'rise':'flat');tr.append(change);
    const status=el('td');status.append(el('span',x.qualifies?'Within budget':x.zone,`badge ${x.qualifies?'good':x.row<=5?'front':''}`));if(x.verifiedAt)status.append(el('small',`Verified ${time(x.verifiedAt)}`));else status.append(el('small','From listing page'));tr.append(status);
    if(automatic){
      status.replaceChildren(el('span',x.exceptional?(x.withinCap?'Exceptional · alert match':'Exceptional · over cap'):x.confidence==='insufficient'?'Learning':'Watching',`badge ${x.exceptional?'good':''}`));
      status.append(el('small',x.dealTarget==null?'No automatic target yet':`Auto target ${money(x.dealTarget)} · ${Math.abs(x.discountPercent).toFixed(0)}% ${x.discountPercent>=0?'below':'above'} reference`));
      status.append(el('small',x.comparisonBasis==='same-row history'?`${x.historySamples} spaced checks · same section & row`:x.comparisonBasis==='nearby-row offers'?`${x.comparableCount} offers · same section, nearby rows`:'Waiting for comparable offers or same-row history'));
      if(x.referencePrice!=null)status.title=`Asking-price reference ${money(x.referencePrice)}; alert ceiling ${money(x.alertCeiling)} including your spending cap. ${x.confidence} confidence. Not a sold-price estimate.`;
    }
    const action=el('td'), a=el('a','View ↗','ticket-link');a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',`View section ${x.section} row ${x.row} on Gametime`);a.addEventListener('click',e=>e.stopPropagation());action.append(a);tr.append(action);
    const choose=()=>{selectedKey=x.key;render();};tr.addEventListener('click',choose);tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});$('listings').append(tr);
  }
  $('empty').hidden=rows.length!==0;$('result-count').textContent=`${rows.length} listings`;drawChart();
}
function drawChart(){
  if(budgetDrag)return;
  const limits=chartLimits();
  const automatic=data.dealScoring?.mode==='automatic';
  const section=$('section').value, rowMax=$('rows').value==='all'?Infinity:Number($('rows').value);
  const zones=Object.keys(data.zones);
  const points=data.history.map(p=>{
    const rows=p.rows.filter(x=>inZone(x)&&(section==='all'||x.section===section)&&matchesRow(x)&&(!selectedKey||x.key===selectedKey));
    const values={};for(const key of zones){const prices=rows.filter(x=>x.band===key).map(x=>x.price);values[key]=prices.length?Math.min(...prices):null;}
    return {at:p.at,...values};
  });
  $('chart-subtitle').textContent=selectedKey?`Section ${selectedKey.split(':').at(-2)} · Row ${selectedKey.split(':').at(-1)}`:section==='all'?(selectedZone==='all'?'Cheapest tracked tickets':data.zones[selectedZone]):`Cheapest observed in Section ${section}`;
  $('clear-chart').hidden=!selectedKey;const target=$('chart');target.replaceChildren();
  $('chart-legend').replaceChildren();
  for(const key of zones){
    const visible=!hiddenChartZones.has(key), last=points.at(-1)?.[key], button=el('button',undefined,'chart-legend-item');
    button.type='button';button.dataset.chartZone=key;button.setAttribute('aria-pressed',String(visible));
    button.setAttribute('aria-label',`${visible?'Hide':'Show'} ${data.zones[key]} price and budget lines`);
    const swatch=el('i');swatch.style.background=zoneColors[key];
    const copy=el('div',undefined,'chart-legend-copy'), gap=last==null?null:last-limits[key];
    const distance=gap===null?'No current offer':gap===0?'At budget':`${money(Math.abs(gap))} ${gap>0?'over':'below'} budget`;
    copy.append(el('span',data.zones[key]),el('small',`${automatic?'Cap':'Budget'} ${money(limits[key])} · ${distance}`,'chart-budget-summary'+(gap!==null&&gap<=0?' within-budget':'')));
    button.append(swatch,copy,el('strong',last==null?'—':money(last)));
    button.addEventListener('click',()=>{if(hiddenChartZones.has(key))hiddenChartZones.delete(key);else hiddenChartZones.add(key);drawChart();});
    $('chart-legend').append(button);
  }
  $('chart-legend').append(el('p',`Solid = asking prices · Dashed = ${budgetsDirty?'unsaved cap preview':automatic?'spending caps':'saved budgets'}.${automatic?' Select a table row to see its automatic target.':''}${data.readOnly?' View-only shared snapshot.':' Drag a colored handle; release to save that zone.'}`,'chart-line-key'));
  const active=zones.filter(key=>!hiddenChartZones.has(key)), valid=points.flatMap(p=>active.map(key=>p[key])).filter(x=>x!==null);
  if(!valid.length){target.append(el('p',active.length?'No matching price history yet.':'Select a zone in the legend to show its price history.','footnote'));$('chart-detail').textContent='Each line tracks the cheapest observed ticket in its zone.';return;}
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 360 240');svg.setAttribute('role','group');svg.setAttribute('aria-label','Cheapest all-in ticket prices over time by seat zone');
  const node=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;};
  const budgetZones=active.filter(key=>(selectedZone==='all'||selectedZone===key)&&(!selectedKey||points.some(p=>p[key]!==null)));
  const selectedOffer=automatic&&selectedKey?data.listings.find(x=>x.key===selectedKey&&active.includes(x.band)):null;
  const autoTarget=selectedOffer?.dealTarget;
  const domain=[...valid,...budgetZones.map(key=>limits[key]),...(autoTarget==null?[]:[autoTarget])];
  const min=Math.max(0,Math.floor(Math.min(...domain)*.9/10)*10), max=Math.ceil(Math.max(...domain)*1.08/10)*10||10;
  const first=new Date(points[0].at).getTime(),last=new Date(points.at(-1).at).getTime();const X=p=>49+(last===first?144:288*(new Date(p.at).getTime()-first)/(last-first)),Y=v=>192-168*(v-min)/(max-min);
  for(let i=0;i<4;i++){const value=min+(max-min)*i/3;node('line',{x1:49,y1:Y(value),x2:337,y2:Y(value),stroke:'#2b3a50','stroke-dasharray':'3 4'});node('text',{x:2,y:Y(value)+3},money(value));}
  if(autoTarget!=null){
    const label=`Current automatic deal target for section ${selectedOffer.section}, row ${selectedOffer.row}: ${money(autoTarget)}. Spending cap ${money(limits[selectedOffer.band])}.`;
    const line=node('line',{x1:49,y1:Y(autoTarget),x2:337,y2:Y(autoTarget),stroke:zoneColors[selectedOffer.band],'stroke-width':2.5,'stroke-dasharray':'2 4','data-auto-target':autoTarget,tabindex:0,role:'img','aria-label':label});
    const title=document.createElementNS(ns,'title');title.textContent=label;line.append(title);
    line.addEventListener('focus',()=>{$('chart-detail').textContent=label;});
    $('chart-legend').querySelector('.chart-line-key').textContent=`Solid = asking prices · Dashed = spending cap · Dotted = current automatic target ${money(autoTarget)}. This target adapts to comparable asking prices.`;
  }
  const budgetControls=[];
  for(const key of budgetZones){
    const budget=limits[key], shared=budgetZones.filter(other=>limits[other]===budget);
    // Interleave colors when multiple zones have the same threshold.
    const dash=shared.length>1?`5 ${shared.length*7-5}`:'6 5';
    const label=`${data.zones[key]} budget: ${money(budget)} including fees. Drag its handle to adjust.`;
    const line=node('line',{x1:49,y1:Y(budget),x2:337,y2:Y(budget),stroke:zoneColors[key],'stroke-width':1.8,'stroke-dasharray':dash,'stroke-dashoffset':shared.indexOf(key)*7,'data-budget-zone':key,'data-budget':budget});
    const title=document.createElementNS(ns,'title');title.textContent=label;line.append(title);
    if(data.readOnly){title.textContent=`${data.zones[key]} saved budget: ${money(budget)}`;line.setAttribute('tabindex','0');line.setAttribute('role','img');line.setAttribute('aria-label',title.textContent);line.addEventListener('focus',()=>{$('chart-detail').textContent=title.textContent;});continue;}
    const x=66+zones.indexOf(key)*(254/Math.max(1,zones.length-1));
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
async function load(){
  if(busy){reloadRequested=true;return;}if(savingBudgets||requestingCheck||budgetDrag)return;
  busy=true;const revision=budgetRevision;$('refresh').disabled=true;
  try{
    let endpoint=hostedDashboard?snapshotEndpoint+(snapshotEndpoint.includes('?')?'&':'?')+'updated='+Date.now():snapshotEndpoint+(activeGameId?'?game='+encodeURIComponent(activeGameId):'');
    const response=await fetch(endpoint,{cache:'no-store'});if(!response.ok)throw Error('Data unavailable');let fresh=await response.json();
    if(hostedDashboard&&fresh.formatVersion===2){
      const catalog=fresh, id=activeGameId||catalog.defaultGameId;
      if(!catalog.games.some(game=>game.id===id))throw Error('This game is not in the shared watch list.');
      if(id!==catalog.gameId){
        const url=new URL('games/'+id+'.json',new URL(snapshotEndpoint,location.href));url.searchParams.set('updated',Date.now());
        const selected=await fetch(url,{cache:'no-store'});if(!selected.ok)throw Error('This game snapshot is not available yet.');fresh=await selected.json();
      }
      if(fresh.gameId!==id)throw Error('The snapshot does not match the selected game. Refresh to retry.');
      fresh.games=catalog.games;fresh.defaultGameId=catalog.defaultGameId;fresh.upcoming=catalog.upcoming;
    }
    else if(hostedDashboard&&activeGameId&&fresh.gameId!==activeGameId)throw Error('The shared game list is updating. Refresh shortly.');
    if(revision!==budgetRevision)return;
    data=normalizeSeatZones(fresh);activeGameId=data.gameId||activeGameId;
    if(hostedDashboard){data.readOnly=true;data.finished=Date.now()>=new Date(data.tipoff).getTime();}
    const prior=$('section').value, sections=[...new Set(data.listings.map(x=>x.section))].sort();
    $('section').replaceChildren(new Option('All tracked sections','all'),...sections.map(s=>new Option(`Section ${s}`,s)));
    $('section').value=sections.includes(prior)?prior:'all';render();
  }catch(error){$('health').textContent='Dashboard disconnected';$('notice').className='notice warning';$('notice').textContent=error.message==='Data unavailable'?'Cannot read monitor data. Showing the previous display, which may be outdated. Refresh to retry.':error.message;}
  finally{busy=false;$('refresh').disabled=false;if(reloadRequested){reloadRequested=false;queueMicrotask(load);}}
}
for(const id of ['section','rows','sort','deals','exceptional'])$(id).addEventListener('change',()=>{if(id==='section'||id==='rows')selectedKey=null;if(data)render();});
function fillBudgets(){for(const [id,key]of [...budgetFields])$(id).value=data.limits[key];}
function budgetButtons(){ if(data)renderUpcoming();const readOnly=hostedDashboard||data?.readOnly;$('game-picker').disabled=savingBudgets||budgetsDirty;$('add-watch').disabled=savingBudgets||budgetsDirty;$('save-defaults').hidden=readOnly;$('save-defaults').disabled=savingBudgets||budgetsDirty||!data?.gameId;if(budgetsDirty)$('watch-status').textContent='Save or cancel cap edits before switching games.';$('save-budgets').hidden=readOnly;$('save-budgets').disabled=!budgetsDirty||savingBudgets||readOnly;$('cancel-budgets').hidden=!budgetsDirty||readOnly;$('cancel-budgets').disabled=savingBudgets;for(const id of budgetFields.map(([id])=>id))$(id).disabled=savingBudgets||readOnly||!data;}
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
  if(!data||data.gameId&&data.gameId!==activeGameId||hostedDashboard||data.readOnly||savingBudgets||budgetDrag||(!onlyKey&&!$('budget-form').reportValidity()))return;
  const limits=onlyKey?{...data.limits,[onlyKey]:chartLimits()[onlyKey]}:Object.fromEntries(budgetFields.map(([id,key])=>[key,Number($(id).value)]));
  const otherDrafts=new Map(budgetFields.filter(([id,key])=>key!==onlyKey&&$(id).value!==String(data.limits[key])).map(([id,key])=>[key,$(id).value]));
  if(!Object.values(limits).every(x=>Number.isInteger(x)&&x>=0&&x<=10000)){$('budget-status').textContent='Enter whole-dollar amounts from $0 to $10,000.';return;}
  savingBudgets=true;budgetRevision++;budgetButtons();$('budget-status').textContent=onlyKey?`Saving ${data.zones[onlyKey]}…`:'Saving…';
  try{const response=await fetch('/api/limits',{method:'POST',headers:postHeaders(),body:JSON.stringify(onlyKey?{zone:onlyKey,value:limits[onlyKey]}:limits)});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save thresholds.');data.limits=result.limits;
    for(const listing of data.listings){listing.limit=result.limits[listing.band];listing.withinCap=listing.price<=listing.limit;listing.qualifies=listing.withinCap&&(data.dealScoring?.mode==='automatic'?listing.exceptional:true);listing.alertCeiling=listing.dealTarget==null?null:Math.min(listing.dealTarget,listing.limit);}
    if(onlyKey){for(const [id,key]of budgetFields)$(id).value=otherDrafts.has(key)?otherDrafts.get(key):result.limits[key];budgetsDirty=budgetFields.some(([id,key])=>$(id).value!==String(result.limits[key]));}
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
    const response=await fetch('/api/check',{method:'POST',headers:postHeaders(),body:'{}'});
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
    button.append(el('span',label),el('strong',rows.length?money(Math.min(...rows.map(x=>x.price))):'No listings'),el('small',`${rows.length} listings | ${rows.filter(x=>x.qualifies).length} ${data.dealScoring?.mode==='automatic'?'alert matches':'within budget'}`));
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

function renderWatches(){
  if(hostedDashboard||data.readOnly){upcomingGames=data.upcoming?.games||[];upcomingFetchedAt=data.upcoming?.fetchedAt;upcomingLoaded=true;}
  renderUpcoming();if(!upcomingLoaded&&!hostedDashboard&&!data.readOnly)loadUpcoming();
  const games=data.games||[], picker=$('game-picker'), prior=activeGameId;
  picker.replaceChildren();
  for(const status of ['watching','paused','finished']){
    const matching=games.filter(game=>game.status===status);if(status==='finished')matching.reverse();if(!matching.length)continue;
    const group=document.createElement('optgroup');group.label={watching:'Watching',paused:'Paused',finished:'Archive'}[status];
    for(const game of matching){const date=new Date(game.tipoff).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Los_Angeles'});group.append(new Option(`${game.title} | ${date}`,game.id));}
    picker.append(group);
  }
  if(!games.length)picker.append(new Option(data.event,activeGameId||''));else picker.value=prior||data.gameId;
  $('add-watch').hidden=hostedDashboard||data.readOnly||!data.gameId;
  $('toggle-watch').hidden=hostedDashboard||data.readOnly||!data.gameId;
  $('toggle-watch').textContent=data.watchEnabled===false?'Resume watch':'Pause watch';
  $('toggle-watch').disabled=data.finished||savingBudgets||budgetsDirty;
  if(!budgetsDirty)$('watch-status').textContent=data.finished?'Archived: history is preserved. Other active games continue.':data.watchEnabled===false?'Paused: automatic checks are off for this game.':`Checks adapt to tipoff: about every ${data.intervalMinutes} minutes for this game.`;
  $('watch-list').replaceChildren();$('watch-count').textContent=`Game watches (${games.length})`;
  for(const game of games){const button=el('button',undefined,'watch-row');button.type='button';button.dataset.watchId=game.id;button.setAttribute('aria-pressed',String(game.id===activeGameId));button.append(el('span',game.title),el('small',`${game.status} | ${new Date(game.tipoff).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'})} Pacific | Last check: ${time(game.capturedAt)}`));button.addEventListener('click',()=>switchGame(game.id));$('watch-list').append(button);}
  $('game-heading').textContent=data.finished?'ARCHIVED GAME':data.watchEnabled===false?'WATCH PAUSED':'WARRIORS HOME GAME';
  $('game-matchup').textContent=data.event;
  $('game-tipoff').textContent=new Date(data.tipoff).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:'America/Los_Angeles'})+' | '+data.venue;
  $('game-date').textContent=new Date(data.tipoff).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'America/Los_Angeles'});
  document.title=data.event+' | Dub Watch';
}
function switchGame(id){
  if(savingBudgets||budgetsDirty||budgetDrag||requestingCheck){$('watch-status').textContent=requestingCheck?'Wait for the check request before switching games.':'Save or cancel cap edits before switching games.';if(data)$('game-picker').value=data.gameId;return;}
  activeGameId=id;budgetRevision++;data=null;selectedKey=null;selectedZone='all';hiddenChartZones.clear();
  const url=new URL(location.href);url.searchParams.set('game',id);history.replaceState(null,'',url);
  $('section').value='all';$('rows').value='all';$('listings').replaceChildren();$('chart').replaceChildren();$('zone-cards').replaceChildren();$('check-status').textContent='';$('notice').textContent='Loading selected game…';$('check-now').disabled=true;budgetButtons();load();
}
$('game-picker').addEventListener('change',event=>switchGame(event.target.value));
$('add-watch').addEventListener('click',()=>{if(!hostedDashboard&&!data?.readOnly)$('add-watch-dialog').showModal();});
$('close-add-watch').addEventListener('click',()=>$('add-watch-dialog').close());
let eventLookupTimer=null,eventLookupAbort=null,eventLookupRevision=0,eventLookupBusy=false;
let lookupNameEdited=false,lookupTimeEdited=false;
$('watch-title').addEventListener('input',()=>{lookupNameEdited=true;});
$('watch-tipoff').addEventListener('input',()=>{lookupTimeEdited=true;});
function cancelEventLookup(){clearTimeout(eventLookupTimer);eventLookupTimer=null;eventLookupAbort?.abort();eventLookupAbort=null;eventLookupRevision++;eventLookupBusy=false;$('submit-watch').disabled=false;}
$('add-watch-dialog').addEventListener('close',cancelEventLookup);
$('watch-url').addEventListener('input',()=>{
  if(hostedDashboard||data?.readOnly)return;
  cancelEventLookup();const revision=eventLookupRevision,url=$('watch-url').value.trim();
  lookupNameEdited=false;lookupTimeEdited=false;$('watch-title').value='';$('watch-tipoff').value='';
  const match=url.match(/\/([^/]+)\/(\d{1,2})-(\d{1,2})-(\d{4})-san-francisco-ca-chase-center\/events\/[a-f0-9]{24}/i);
  if(!match){$('add-watch-status').textContent='Paste a complete Gametime Warriors home-game link.';return;}
  $('watch-title').value=match[1].replace(/-tickets$/,'').replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  $('add-watch-status').textContent='Looking up the game name and actual tipoff on Gametime…';eventLookupBusy=true;$('submit-watch').disabled=true;
  eventLookupTimer=setTimeout(async()=>{
    eventLookupTimer=null;eventLookupAbort=new AbortController();
    try{
      const response=await fetch('/api/event-lookup',{method:'POST',headers:postHeaders(),body:JSON.stringify({url}),signal:eventLookupAbort.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Could not look up this game. Enter the details manually.');
      if(revision!==eventLookupRevision)return;
      if(!lookupNameEdited)$('watch-title').value=result.title;
      if(!lookupTimeEdited)$('watch-tipoff').value=result.tipoffPacific;
      $('add-watch-status').textContent=lookupNameEdited||lookupTimeEdited?'Game details loaded from Gametime; your manual edits were kept.':'Game name and actual tipoff loaded from Gametime. Times are Pacific; you can edit them if needed.';
    }catch(error){if(revision===eventLookupRevision&&error.name!=='AbortError')$('add-watch-status').textContent=error.message||'Lookup unavailable. Enter the game name and Pacific tipoff manually.';}
    finally{if(revision===eventLookupRevision){eventLookupBusy=false;eventLookupAbort=null;$('submit-watch').disabled=false;}}
  },450);
});
$('add-watch-form').addEventListener('submit',async event=>{
  event.preventDefault();if(hostedDashboard||data?.readOnly||eventLookupBusy)return;
  $('submit-watch').disabled=true;$('add-watch-status').textContent='Adding game…';
  try{const response=await fetch('/api/watches',{method:'POST',headers:postHeaders(),body:JSON.stringify({url:$('watch-url').value,title:$('watch-title').value,tipoffPacific:$('watch-tipoff').value})});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not add this watch.');$('add-watch-dialog').close();$('add-watch-form').reset();$('add-watch-status').textContent='';switchGame(result.gameId);}
  catch(error){$('add-watch-status').textContent=error.message;}finally{$('submit-watch').disabled=false;}
});
$('toggle-watch').addEventListener('click',async()=>{
  if(!data||hostedDashboard||data.readOnly)return;
  $('toggle-watch').disabled=true;
  try{const response=await fetch('/api/watch-state',{method:'POST',headers:postHeaders(),body:JSON.stringify({enabled:data.watchEnabled===false})});const result=await response.json();if(!response.ok)throw Error(result.error);await load();}
  catch(error){$('watch-status').textContent=error.message;$('toggle-watch').disabled=false;}
});
$('save-defaults').addEventListener('click',async()=>{
  if(!data||hostedDashboard||data.readOnly)return;
  try{const response=await fetch('/api/defaults',{method:'POST',headers:postHeaders(),body:'{}'});const result=await response.json();if(!response.ok)throw Error(result.error);$('budget-status').textContent='Saved as defaults for future watches. Existing game caps are unchanged.';}
  catch(error){$('budget-status').textContent=error.message;}
});

function renderUpcoming(){
  const readOnly=hostedDashboard||data?.readOnly;
  $('upcoming-help').textContent=readOnly?'Chase Center · All times Pacific. The owner chooses which games to watch.':'Chase Center · All times Pacific. Pick a game to start its own watch.';
  $('browse-games').hidden=readOnly;$('refresh-schedule').hidden=readOnly;
  $('browse-games').disabled=savingBudgets||budgetsDirty||!!addingUpcoming;
  $('refresh-schedule').disabled=upcomingBusy||!!addingUpcoming;
  const filter=$('upcoming-search').value.trim().toLowerCase();
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'});
  const games=upcomingGames.filter(game=>(game.tipoff?new Date(game.tipoff).getTime()>Date.now():game.eventDate>=today)&&game.title.toLowerCase().includes(filter));
  $('upcoming-count').textContent=upcomingGames.length?`(${games.length})`:'';
  $('upcoming-list').replaceChildren();
  $('upcoming-status').textContent=upcomingBusy?'Loading the Warriors home schedule…':addingUpcoming?'Verifying the selected game and starting its watch…':upcomingError||(!upcomingLoaded?'Loading upcoming home games…':!upcomingGames.length?'No schedule has been shared yet.':!games.length?'No upcoming games match this filter.':`Schedule checked ${new Date(upcomingFetchedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'})} Pacific · ${readOnly?'Watch controls are available on the private owner dashboard.':'Tipoff is rechecked when you add a watch.'}`);
  for(const game of games){
    const card=el('article',undefined,'upcoming-game');card.dataset.upcomingId=game.id;
    const date=new Date(game.eventDate+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'America/Los_Angeles'});
    const info=el('div');info.append(el('strong',game.title),el('small',date+' · '+(game.tipoff?time(game.tipoff)+' Pacific':'Time TBD')));card.append(info);
    const existing=data?.games?.find(watch=>watch.id===game.id);
    if(!readOnly||existing){
      const button=el('button',addingUpcoming===game.id?'Adding…':existing?'Open watch':'Watch game');button.type='button';button.disabled=savingBudgets||budgetsDirty||!!addingUpcoming||requestingCheck;
      if(existing)button.title=existing.enabled?'Already watching this game':'This watch is paused';
      button.addEventListener('click',()=>existing?switchGame(game.id):watchUpcoming(game));card.append(button);
    }else{const link=el('a','View on Gametime ↗');link.href=game.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
    $('upcoming-list').append(card);
  }
}
async function loadUpcoming(force=false){
  if(upcomingBusy||hostedDashboard||data?.readOnly)return;
  upcomingBusy=true;upcomingLoaded=true;upcomingError='';renderUpcoming();
  try{const response=await fetch('/api/upcoming'+(force?'?refresh=1':''),{cache:'no-store'});if(!response.ok)throw Error('Could not load the schedule. Use Add game to paste a link or retry later.');const result=await response.json();upcomingGames=result.games||[];upcomingFetchedAt=result.fetchedAt;upcomingError=result.error||'';}
  catch(error){upcomingError=error.message;}
  finally{upcomingBusy=false;renderUpcoming();}
}
async function watchUpcoming(game){
  if(hostedDashboard||data?.readOnly||savingBudgets||budgetsDirty||addingUpcoming||requestingCheck)return;
  addingUpcoming=game.id;upcomingError='';renderUpcoming();
  try{const response=await fetch('/api/watches',{method:'POST',headers:postHeaders(),body:JSON.stringify({url:game.url})});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not start this watch.');addingUpcoming=null;switchGame(result.gameId);}
  catch(error){upcomingError=error.message;}
  finally{addingUpcoming=null;renderUpcoming();}
}
$('upcoming-search').addEventListener('input',renderUpcoming);
$('refresh-schedule').addEventListener('click',()=>loadUpcoming(true));
$('browse-games').addEventListener('click',()=>{$('upcoming-panel').open=true;$('upcoming-panel').scrollIntoView({behavior:'smooth',block:'start'});$('upcoming-search').focus();if(!upcomingLoaded)loadUpcoming();});
setInterval(()=>{if(!document.hidden&&!hostedDashboard&&data&&!data.readOnly)loadUpcoming();},900000);
