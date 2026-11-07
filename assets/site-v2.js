(function(){
var d=document.getElementById('drawer');
if(d){
  var set=function(o){d.classList.toggle('open',o);document.body.style.overflow=o?'hidden':''};
  document.querySelectorAll('[data-menu]').forEach(function(b){b.addEventListener('click',function(){set(!d.classList.contains('open'))})});
  d.querySelectorAll('.scrim,.close').forEach(function(x){x.addEventListener('click',function(){set(false)})});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')set(false)});
  d.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){set(false)})});
}
var pb=document.querySelector('.progress'),top=document.querySelector('.totop'),art=document.querySelector('article');
if(pb||top){
  var on=function(){var y=window.scrollY||0;
    if(pb&&art){var r=art.getBoundingClientRect(),h=art.offsetHeight-window.innerHeight;pb.style.width=Math.max(0,Math.min(100,(-r.top)/Math.max(h,1)*100))+'%'}
    if(top)top.classList.toggle('show',y>700)};
  window.addEventListener('scroll',on,{passive:true});on();
  if(top)top.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'})});
}
var cp=document.querySelector('[data-copy]');
if(cp)cp.addEventListener('click',function(){var u=cp.getAttribute('data-copy');var ok=function(){cp.textContent='已複製';setTimeout(function(){cp.textContent='複製連結'},1600)};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(u).then(ok,function(){window.prompt('複製連結',u)});else window.prompt('複製連結',u)});
var openHash=function(){var h=location.hash.slice(1);if(!h)return;var el;try{el=document.getElementById(decodeURIComponent(h))}catch(e){return}
  if(el&&el.tagName==='DETAILS'){el.open=true;el.scrollIntoView({block:'center',behavior:'instant'})}};
window.addEventListener('hashchange',openHash);openHash();
})();
