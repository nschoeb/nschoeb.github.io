import {nearest,polygons} from './geo.js';
const $=id=>document.getElementById(id), cities={'Seattle':[-122.33,47.61],'Denver':[-104.99,39.74],'Austin':[-97.74,30.27],'New York':[-74.01,40.71]};
let data,current,results,km=false,watch=null,fixAccuracy=0;
const ns='http://www.w3.org/2000/svg';
function el(tag,attrs,parent){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent.appendChild(e);return e;}
const number=d=>Math.round(km?d:d/1.609344).toLocaleString();
function render(){
 const c=results.Canada.km,m=results.Mexico.km,delta=Math.abs(c-m),tie=delta<Math.max(1,fixAccuracy/1000),winner=c<m?'Canada':'Mexico';
 $('winner').textContent=tie?'Almost a tie!':winner;
 $('resultLabel').textContent=tie?'RIGHT IN THE MIDDLE':'YOU’RE CLOSER TO';
 $('difference').innerHTML=tie?'The two countries are about equally close.':`By about <b>${number(delta)} ${km?'km':'miles'}</b>. Curiosity, settled.`;
 $('canada').textContent=number(c);$('mexico').textContent=number(m);
 document.querySelectorAll('.unit').forEach(e=>e.textContent=km?' km':' mi');
 $('canadaCard').classList.toggle('active',!tie&&winner==='Canada');$('mexicoCard').classList.toggle('active',!tie&&winner==='Mexico');
 $('units').innerHTML=km?'Kilometers / <span>mi</span>':'Miles / <span>km</span>';$('units').setAttribute('aria-label',km?'Switch to miles':'Switch to kilometers');
 draw();
}
function setPoint(point,label,accuracy=0){current=point;fixAccuracy=accuracy;results={Canada:nearest(point,data.Canada),Mexico:nearest(point,data.Mexico)};$('location').textContent=label;render();}
function draw(){
 const inLower=current[0]>=-130&&current[0]<=-60&&current[1]>=20&&current[1]<=55;
 const bounds=inLower?[-130,-59,20,57]:[Math.min(-130,current[0]-8),Math.max(-59,current[0]+8),Math.min(20,current[1]-8),Math.max(57,current[1]+8)];
 const [west,east,south,north]=bounds, scale=Math.min(620/((east-west)*.75),420/(north-south)), dx=(660-(east-west)*.75*scale)/2,dy=(480-(north-south)*scale)/2;
 const xy=p=>[dx+(p[0]-west)*.75*scale,dy+(north-p[1])*scale];
 for(const id of ['geography','routes','labels'])$(id).replaceChildren();
 const colors={'Canada':'#c5d9c2','Mexico':'#e5d3b6','United States of America':'#fbfbf6'};
 for(const name of ['Canada','Mexico','United States of America']){const path=polygons(data[name]).map(poly=>poly.map(r=>r.map((p,i)=>(i?'L':'M')+xy(p).join(',')).join('')+'Z').join('')).join('');el('path',{d:path,fill:colors[name],stroke:'#9caf9b','stroke-width':.8,'fill-rule':'evenodd'},$('geography'));}
 for(const [label,p] of [['CANADA',[-106,53]],['UNITED STATES',[-99,38]],['MEXICO',[-105,25]]]){const [x,y]=xy(p);const t=el('text',{x,y,fill:'#81927f','text-anchor':'middle','font-size':11,'font-family':'sans-serif','letter-spacing':3},$('labels'));t.textContent=label;}
 const [x,y]=xy(current);
 for(const [name,result] of Object.entries(results)){const [tx,ty]=xy(result.point);el('line',{x1:x,y1:y,x2:tx,y2:ty,stroke:name==='Canada'?'#5e8966':'#bb9060','stroke-width':1.7,'stroke-dasharray':'5 5'},$('routes'));el('circle',{cx:tx,cy:ty,r:3,fill:name==='Canada'?'#5e8966':'#bb9060'},$('routes'));}
 el('circle',{cx:x,cy:y,r:14,fill:'#d58a54',opacity:.15},$('routes'));el('circle',{cx:x,cy:y,r:6,fill:'#d58a54',stroke:'white','stroke-width':3},$('routes'));
}
function stop(){if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;$('track').textContent='Start live updates';}
function error(e){stop();$('locate').disabled=false;$('locate').innerHTML='<span>◎</span> Use my location <span class="arrow">↗</span>';$('message').textContent=e.code===1?'Location access is off. Allow it in your browser settings, or try an example city.':e.code===3?'Location took too long. Try again outdoors or choose an example city.':'Couldn’t get your location. Try again or choose an example city.';}
function success(p){setPoint([p.coords.longitude,p.coords.latitude],`YOUR LOCATION · ${p.coords.latitude.toFixed(2)}°, ${p.coords.longitude.toFixed(2)}°`,p.coords.accuracy);document.querySelectorAll('#examples button').forEach(e=>e.classList.remove('selected'));$('message').textContent=`${watch!==null?'Live updates on · ':''}Updated ${new Date(p.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · GPS accuracy ±${Math.round(p.coords.accuracy)} m`;$('locate').disabled=false;$('locate').innerHTML='<span>◎</span> Refresh my location <span class="arrow">↗</span>';}
function available(){if(!navigator.geolocation){$('message').textContent='This browser doesn’t support location. Try an example city.';return false;}return true;}
const options={enableHighAccuracy:true,timeout:20000,maximumAge:10000};
 $('locate').onclick=()=>{if(!available())return;$('locate').disabled=true;$('locate').textContent='Finding your location…';$('message').textContent='Allow location access when your browser asks.';navigator.geolocation.getCurrentPosition(success,error,options);};
 $('track').onclick=()=>{if(watch!==null){stop();$('message').textContent='Live updates paused. Your last location is shown.';return;}if(!available())return;watch=navigator.geolocation.watchPosition(success,error,options);$('track').textContent='Pause live updates';$('message').textContent='Waiting for location. Keep this page open for live updates.';};
 $('units').onclick=()=>{km=!km;if(results)render();};
 document.querySelectorAll('#examples button').forEach(b=>b.onclick=()=>{if(!data)return;stop();document.querySelectorAll('#examples button').forEach(e=>e.classList.toggle('selected',e===b));setPoint(cities[b.dataset.city],'EXAMPLE · '+b.textContent.toUpperCase());$('message').textContent='Example location. Tap “Use my location” for your own result.';});
try{const response=await fetch('./countries.json');if(!response.ok)throw Error();data=await response.json();setPoint(cities.Denver,'EXAMPLE · DENVER, CO');$('locate').disabled=false;$('track').disabled=false;}catch{$('winner').textContent='Oops.';$('difference').textContent='The map data didn’t load. Refresh to try again.';$('message').textContent='An internet connection is needed for the first load.';}
