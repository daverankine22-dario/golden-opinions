// Question rendering shared by the participant app and the admin preview.
import { likertLabels, likertShow, optShow, L, withUnit } from './shared.js';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function qInput(q,v,lang='en'){
  const T=(en,es)=>lang==='es'?es:en;
  const opt=(label,on,act,extra='',show)=>`<button class="opt ${act==='m'?'sq':''} ${on?'on':''}" data-act="ans" data-mode="${act}" data-v="${esc(label)}" ${extra}><span class="dot"></span><span class="notr">${esc(show??label)}</span></button>`;
  const sh=o=>optShow(q,o,'options',lang);
  switch(q.type){
    case 'single':return `<div class="opts" role="radiogroup">${(q.options||[]).map(o=>opt(o,v===o,'s','',sh(o))).join('')}</div>`;
    case 'multi':{const a=Array.isArray(v)?v:[];const full=q.max>0&&a.length>=q.max;
      return `${q.max>0?`<div class="muted small">Select up to ${q.max} · ${a.length}/${q.max} chosen</div>`:'<div class="muted small">Select all that apply</div>'}<div class="opts">${(q.options||[]).map(o=>opt(o,a.includes(o),'m',full&&!a.includes(o)?'disabled':'',sh(o))).join('')}</div>`}
    case 'dropdown':return `<div style="margin-top:16px"><select class="in" data-q="${q.id}" data-kind="select"><option value="">Choose…</option>${(q.options||[]).map(o=>`<option value="${esc(o)}" ${v===o?'selected':''} class="notr">${esc(sh(o))}</option>`).join('')}</select></div>`;
    case 'likert':return `<div class="opts">${likertLabels(q).map(o=>opt(o,v===o,'s','',likertShow(q,o,lang))).join('')}</div>`;
    case 'rating':{const n=[];for(let i=+q.min;i<=+q.max;i++)n.push(i);const cols=n.length>6?Math.ceil(n.length/2):n.length;
      return `<div class="nums" style="grid-template-columns:repeat(${cols},1fr)">${n.map(i=>`<button class="num ${v===i?'on':''}" data-act="ans" data-mode="n" data-v="${i}">${i}</button>`).join('')}</div><div class="anchors"><span class="notr">${esc(q.min)} = ${esc(L(q,'lowLabel',lang)||'')}</span><span class="notr">${esc(q.max)} = ${esc(L(q,'highLabel',lang)||'')}</span></div>`}
    case 'slider':{const has=v!==undefined&&v!=='';const mid=+q.min+Math.round((q.max-q.min)/2/(q.step||1))*(q.step||1);
      return `<div class="sliderval" id="sv">${has?esc(withUnit(v,q.unit)):'<span class="faint" style="font-size:18px">Drag to answer</span>'}</div><input type="range" min="${q.min}" max="${q.max}" step="${q.step||1}" value="${has?v:mid}" data-q="${q.id}" data-kind="range"><div class="anchors"><span>${esc(withUnit(q.min,q.unit))}</span><span>${esc(withUnit(q.max,q.unit))}</span></div>`}
    case 'matrix':{const labs=likertLabels(q);const o=v||{};
      return `<div class="card" style="margin-top:16px;padding:6px 12px">${(q.rows||[]).map(r=>`<div class="mrow"><div class="lab notr">${esc(optShow(q,r,'rows',lang))}</div><div class="seg">${labs.map(l=>`<button class="${o[r]===l?'on':''}" data-act="ans" data-mode="x" data-row="${esc(r)}" data-v="${esc(l)}" title="${esc(likertShow(q,l,lang))}"><span class="notr">${esc(likertShow(q,l,lang))}</span></button>`).join('')}</div></div>`).join('')}</div>`}
    case 'text':return `<div style="margin-top:16px"><input class="in" data-q="${q.id}" data-kind="text" maxlength="${q.maxLength||200}" placeholder="${esc(L(q,'placeholder',lang)||T('Type your answer','Escribe tu respuesta'))}" value="${esc(v||'')}" data-autofocus></div>`;
  }
  return '';
}
