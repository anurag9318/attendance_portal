document.getElementById("login").onsubmit=async e=>{
 e.preventDefault(); const b=document.getElementById("submit"),err=document.getElementById("error");b.disabled=true;err.classList.add("hidden");
 try{const r=await fetch(`/api/auth/${window.LOGIN_ROLE}/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:username.value,password:password.value})});
 const d=await r.json();if(!r.ok)throw Error(d.message);location.href=window.LOGIN_ROLE==="admin"?"/admin/dashboard.html":"/student/dashboard.html";
 }catch(x){err.textContent=x.message;err.classList.remove("hidden")}finally{b.disabled=false}
};
