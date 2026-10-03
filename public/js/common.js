async function api(url,opt={}){const r=await fetch(url,{credentials:"include",...opt});if(r.status===401){location.href="/";throw Error("Session expired.")}const d=r.headers.get("content-type")?.includes("json")?await r.json():r;if(!r.ok)throw Error(d.message||"Request failed");return d}
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function badge(s){return `<span class="badge ${s==="Present"?"present":s==="Absent"?"absent":"none"}">${esc(s)}</span>`}
function toast(m,err=false){const x=document.createElement("div");x.className="alert "+(err?"error":"success");x.textContent=m;x.style.cssText="position:fixed;right:20px;bottom:20px;z-index:100";document.body.appendChild(x);setTimeout(()=>x.remove(),3000)}
function menu(){document.getElementById("menu")?.addEventListener("click",()=>document.querySelector(".side").classList.toggle("open"))}
async function logout(e){e.preventDefault();await api("/api/auth/logout",{method:"POST"});location.href="/"}
