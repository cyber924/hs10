const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const hex = bytes => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
const slugify = s => (s||"story").toLowerCase().normalize("NFKD").replace(/[^a-z0-9가-힣]+/g,"-").replace(/^-|-$/g,"").slice(0,70)||"story";
async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:100000,hash:"SHA-256"},key,256));
}
function cookie(request,name){return (request.headers.get("Cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";}
function cookieHeader(value,maxAge){return `hs10_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
async function userFor(request,env){
  const token=cookie(request,"hs10_session"); if(!token)return null;
  const row=await env.DB.prepare("SELECT u.id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?").bind(token,now()).first();
  return row||null;
}

async function settingsKey(env){
  if(!env.APP_ENCRYPTION_KEY)throw new Error("Cloudflare에 APP_ENCRYPTION_KEY 보안 변수를 먼저 등록해야 합니다.");
  const digest=await crypto.subtle.digest("SHA-256",enc.encode(env.APP_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encryptSecret(value,env){
  const iv=crypto.getRandomValues(new Uint8Array(12)),key=await settingsKey(env);
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(value));
  return JSON.stringify({iv:b64(iv),data:b64(encrypted)});
}
async function decryptSecret(value,env){
  const item=JSON.parse(value),key=await settingsKey(env);
  const raw=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:raw(item.iv)},key,raw(item.data));
  return new TextDecoder().decode(plain);
}

const safePost = p => ({id:p.id,title:p.title,slug:p.slug,excerpt:p.excerpt,body:p.body,category:p.category,coverUrl:p.cover_url,status:p.status,createdAt:p.created_at,updatedAt:p.updated_at,publishedAt:p.published_at});
async function handleApi(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(method==="GET"&&path==="/api/posts"){
    const rows=await env.DB.prepare("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 30").all();
    return json({posts:rows.results.map(safePost)});
  }
  if(method==="GET"&&path.startsWith("/api/posts/")){
    const slug=decodeURIComponent(path.slice(11));
    const p=await env.DB.prepare("SELECT * FROM posts WHERE slug=? AND status='published'").bind(slug).first();
    return p?json({post:safePost(p)}):json({error:"글을 찾을 수 없습니다."},404);
  }
  if(path==="/api/auth/register"&&method==="POST"){
    const b=await request.json(); const email=String(b.email||"").trim().toLowerCase(),password=String(b.password||""),name=String(b.name||"").trim();
    if(!/^\S+@\S+\.\S+$/.test(email)||password.length<12||!name)return json({error:"이름, 올바른 이메일, 12자 이상의 비밀번호를 입력하세요."},400);
    const uid=id(),salt=b64(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(password,salt),token=id(),time=now();
    const created=await env.DB.prepare("INSERT INTO users(id,email,display_name,password_hash,password_salt,role,created_at) SELECT ?,?,?,?,?,'admin',? WHERE NOT EXISTS (SELECT 1 FROM users)").bind(uid,email,name,hash,salt,time).run();
    if(!created.meta.changes)return json({error:"최초 관리자 계정이 이미 생성되었습니다."},403);
    await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(token,uid,new Date(Date.now()+30*86400000).toISOString(),time).run();
    return json({user:{id:uid,email,name,role:"admin"}},201,{"set-cookie":cookieHeader(token,2592000)});
  }
  if(path==="/api/auth/login"&&method==="POST"){
    const b=await request.json(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
    const u=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if(!u||await passwordHash(password,u.password_salt)!==u.password_hash)return json({error:"이메일 또는 비밀번호를 확인하세요."},401);
    const token=id(),time=now(); await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(token,u.id,new Date(Date.now()+30*86400000).toISOString(),time).run();
    return json({user:{id:u.id,email:u.email,name:u.display_name,role:u.role}},200,{"set-cookie":cookieHeader(token,2592000)});
  }
  if(path==="/api/auth/logout"&&method==="POST"){
    const token=cookie(request,"hs10_session"); if(token)await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(token).run();
    return json({ok:true},200,{"set-cookie":cookieHeader("",0)});
  }
  if(path==="/api/auth/me"&&method==="GET")return json({user:await userFor(request,env)});

  if(path==="/api/ai/settings"&&method==="GET"){
    const user=await userFor(request,env);if(!user)return json({error:"로그인이 필요합니다."},401);
    if(user.role!=="admin")return json({error:"관리자 권한이 필요합니다."},403);
    const row=await env.DB.prepare("SELECT value FROM app_settings WHERE key='gemini_api_key'").first();
    return json({configured:!!row?.value});
  }
  if(["POST","PUT","DELETE","PATCH"].includes(method)){
    const origin=request.headers.get("Origin");
    if(!origin||new URL(origin).origin!==url.origin)return json({error:"요청 출처를 확인할 수 없습니다."},403);
  }
  const user=await userFor(request,env); if(!user)return json({error:"로그인이 필요합니다."},401);
  if(path==="/api/ai/settings"&&method==="POST"){
    if(user.role!=="admin")return json({error:"관리자 권한이 필요합니다."},403);
    const b=await request.json(),key=String(b.apiKey||"").trim();
    if(key.length<20||key.length>300)return json({error:"Gemini API 키를 확인해 주세요."},400);
    try{
      const encrypted=await encryptSecret(key,env);
      await env.DB.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('gemini_api_key',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(encrypted,now()).run();
      return json({ok:true,configured:true});
    }catch(e){console.error("AI key save error",e);return json({error:e.message.includes("APP_ENCRYPTION_KEY")?e.message:"AI 키 저장에 실패했습니다."},500)}
  }
  if(path==="/api/ai/test"&&method==="POST"){
    if(user.role!=="admin")return json({error:"관리자 권한이 필요합니다."},403);
    const row=await env.DB.prepare("SELECT value FROM app_settings WHERE key='gemini_api_key'").first();
    if(!row)return json({error:"먼저 Gemini API 키를 저장해 주세요."},400);
    try{
      const apiKey=await decryptSecret(row.value,env);
      const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key="+encodeURIComponent(apiKey),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"Reply with exactly: HS10 연결 성공"}]}]})});
      const data=await response.json();
      if(!response.ok)return json({error:data.error?.message||"Gemini API 연결에 실패했습니다."},502);
      return json({ok:true,message:data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"응답을 받았습니다."});
    }catch(e){console.error("Gemini test error",e);return json({error:"API 키 복호화 또는 연결에 실패했습니다. 암호화 키 설정을 확인해 주세요."},500)}
  }
  if(path==="/api/ai/generate"&&method==="POST"){
    const b=await request.json(),prompt=String(b.prompt||"").trim(),title=String(b.title||"").trim(),existing=String(b.body||"").slice(0,12000),model=String(b.model||"gemini-3.8-flash");
    if(!/^[a-zA-Z0-9.-]{3,80}$/.test(model))return json({error:"모델 이름을 확인해 주세요."},400);
    if(!prompt)return json({error:"AI에게 요청할 내용을 입력해 주세요."},400);
    if(prompt.length>5000)return json({error:"요청 내용은 5,000자 이내로 입력해 주세요."},400);
    const row=await env.DB.prepare("SELECT value FROM app_settings WHERE key='gemini_api_key'").first();
    if(!row)return json({error:"관리자 메뉴에서 Gemini API 키를 먼저 설정해 주세요."},400);
    try{
      const apiKey=await decryptSecret(row.value,env);
      const instruction="당신은 한국어 전문 콘텐츠 에디터입니다. 자연스럽고 정확한 한국어로 작성하고, 과장이나 허위 사실을 만들지 마세요. 사용자가 요청한 결과물만 출력하세요.\n\n제목: "+title+"\n기존 본문:\n"+existing+"\n\n요청: "+prompt;
      const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(apiKey),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:instruction}]}]})});
      const data=await response.json();
      if(!response.ok)return json({error:data.error?.message||"Gemini 글 생성에 실패했습니다."},502);
      const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
      if(!text)return json({error:"Gemini에서 생성된 본문이 없습니다."},502);
      return json({text});
    }catch(e){console.error("Gemini generate error",e);return json({error:"AI 글 생성 중 오류가 발생했습니다. API 키와 암호화 설정을 확인해 주세요."},500)}
  }

  if(path==="/api/manage/posts"&&method==="GET"){
    const rows=await env.DB.prepare("SELECT * FROM posts WHERE user_id=? ORDER BY updated_at DESC").bind(user.id).all();
    return json({posts:rows.results.map(safePost)});
  }
  if(path==="/api/manage/posts"&&method==="POST"){
    const b=await request.json(),title=String(b.title||"").trim(),body=String(b.body||"").trim();
    if(!title||!body||title.length>180||body.length>200000||String(b.excerpt||"").length>500)return json({error:"제목, 본문 또는 소개의 길이를 확인하세요."},400);
    if(b.coverUrl){try{const u=new URL(b.coverUrl);if(u.protocol!=="https:"||u.username||u.password||b.coverUrl.length>2048)throw Error()}catch{return json({error:"대표 이미지 URL은 https:// 주소만 사용할 수 있습니다."},400)}}
    const pid=id(),time=now(),slug=slugify(b.slug||title)+"-"+pid.slice(0,6);
    const status=b.status==="published"?"published":"draft";
    await env.DB.prepare("INSERT INTO posts(id,user_id,title,slug,excerpt,body,category,cover_url,status,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(pid,user.id,title,slug,String(b.excerpt||""),body,String(b.category||"에세이"),String(b.coverUrl||"")||null,status,time,time,status==="published"?time:null).run();
    return json({id:pid,slug},201);
  }
  if(path.startsWith("/api/manage/posts/")&&method==="PUT"){
    const pid=path.split("/").pop(),b=await request.json(),p=await env.DB.prepare("SELECT * FROM posts WHERE id=? AND user_id=?").bind(pid,user.id).first();
    if(!p)return json({error:"문서를 찾을 수 없습니다."},404);
    const status=b.status==="published"?"published":"draft",time=now();
    const coverUrl=b.coverUrl===undefined?p.cover_url:String(b.coverUrl||"")||null;
    if(coverUrl){try{const u=new URL(coverUrl);if(u.protocol!=="https:"||u.username||u.password||coverUrl.length>2048)throw Error()}catch{return json({error:"대표 이미지 URL은 https:// 주소만 사용할 수 있습니다."},400)}}
    await env.DB.prepare("UPDATE posts SET title=?,excerpt=?,body=?,category=?,cover_url=?,status=?,updated_at=?,published_at=? WHERE id=? AND user_id=?").bind(String(b.title||p.title),String(b.excerpt??p.excerpt),String(b.body??p.body),String(b.category||p.category),coverUrl,status,time,status==="published"?(p.published_at||time):null,pid,user.id).run();
    return json({ok:true});
  }
  if(path.startsWith("/api/manage/posts/")&&method==="DELETE"){
    const pid=path.split("/").pop(); await env.DB.prepare("DELETE FROM posts WHERE id=? AND user_id=?").bind(pid,user.id).run(); return json({ok:true});
  }
  return json({error:"지원하지 않는 요청입니다."},404);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/")){try{return await handleApi(request,env)}catch(e){console.error("API error",e);return json({error:"서버 오류가 발생했습니다."},500)}}
  return env.ASSETS.fetch(request);
 }
};
