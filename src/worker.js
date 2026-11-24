const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const hex = bytes => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
const slugify = s => (s||"story").toLowerCase().normalize("NFKD").replace(/[^a-z0-9가-힣]+/g,"-").replace(/^-|-$/g,"").slice(0,70)||"story";
async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:180000,hash:"SHA-256"},key,256));
}
function cookie(request,name){return (request.headers.get("Cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";}
function cookieHeader(value,maxAge){return `hs10_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
async function userFor(request,env){
  const token=cookie(request,"hs10_session"); if(!token)return null;
  const row=await env.DB.prepare("SELECT u.id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?").bind(token,now()).first();
  return row||null;
}
const safePost = p => ({id:p.id,title:p.title,slug:p.slug,excerpt:p.excerpt,body:p.body,category:p.category,coverUrl:p.cover_key?"/media/"+p.cover_key:p.cover_url,status:p.status,createdAt:p.created_at,updatedAt:p.updated_at,publishedAt:p.published_at});
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
  if(["POST","PUT","DELETE","PATCH"].includes(method)){
    const origin=request.headers.get("Origin");
    if(!origin||new URL(origin).origin!==url.origin)return json({error:"요청 출처를 확인할 수 없습니다."},403);
  }
  const user=await userFor(request,env); if(!user)return json({error:"로그인이 필요합니다."},401);
  if(path==="/api/manage/posts"&&method==="GET"){
    const rows=await env.DB.prepare("SELECT * FROM posts WHERE user_id=? ORDER BY updated_at DESC").bind(user.id).all();
    return json({posts:rows.results.map(safePost)});
  }
  if(path==="/api/manage/posts"&&method==="POST"){
    const b=await request.json(),title=String(b.title||"").trim(),body=String(b.body||"").trim();
    if(!title||!body||title.length>180||body.length>200000||String(b.excerpt||"").length>500)return json({error:"제목, 본문 또는 소개의 길이를 확인하세요."},400);
    if(b.coverUrl){try{const u=new URL(b.coverUrl);if(!["https:","http:"].includes(u.protocol)||u.username||u.password||b.coverUrl.length>2048)throw Error()}catch{return json({error:"대표 이미지 URL이 올바르지 않습니다."},400)}}
    const pid=id(),time=now(),slug=slugify(b.slug||title)+"-"+pid.slice(0,6);
    const status=b.status==="published"?"published":"draft";
    await env.DB.prepare("INSERT INTO posts(id,user_id,title,slug,excerpt,body,category,cover_key,cover_url,status,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(pid,user.id,title,slug,String(b.excerpt||""),body,String(b.category||"에세이"),String(b.coverKey||"")||null,String(b.coverUrl||"")||null,status,time,time,status==="published"?time:null).run();
    return json({id:pid,slug},201);
  }
  if(path.startsWith("/api/manage/posts/")&&method==="PUT"){
    const pid=path.split("/").pop(),b=await request.json(),p=await env.DB.prepare("SELECT * FROM posts WHERE id=? AND user_id=?").bind(pid,user.id).first();
    if(!p)return json({error:"문서를 찾을 수 없습니다."},404);
    const status=b.status==="published"?"published":"draft",time=now();
    const coverUrl=b.coverUrl===undefined?p.cover_url:String(b.coverUrl||"")||null,coverKey=b.coverKey===undefined?p.cover_key:String(b.coverKey||"")||null;
    if(coverUrl){try{const u=new URL(coverUrl);if(!["https:","http:"].includes(u.protocol)||u.username||u.password||coverUrl.length>2048)throw Error()}catch{return json({error:"대표 이미지 URL이 올바르지 않습니다."},400)}}
    await env.DB.prepare("UPDATE posts SET title=?,excerpt=?,body=?,category=?,cover_key=?,cover_url=?,status=?,updated_at=?,published_at=? WHERE id=? AND user_id=?").bind(String(b.title||p.title),String(b.excerpt??p.excerpt),String(b.body??p.body),String(b.category||p.category),coverKey,coverUrl,status,time,status==="published"?(p.published_at||time):null,pid,user.id).run();
    return json({ok:true});
  }
  if(path.startsWith("/api/manage/posts/")&&method==="DELETE"){
    const pid=path.split("/").pop(); await env.DB.prepare("DELETE FROM posts WHERE id=? AND user_id=?").bind(pid,user.id).run(); return json({ok:true});
  }
  if(path==="/api/media"&&method==="POST"){
    if(!env.MEDIA)return json({error:"R2 바인딩을 확인하세요."},503);
    const form=await request.formData(),file=form.get("file");
    if(!(file instanceof File)||file.size>8*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type))return json({error:"8MB 이하 JPG, PNG, WebP 이미지만 업로드할 수 있습니다."},400);
    const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
    const valid=file.type==="image/jpeg"?head[0]===255&&head[1]===216&&head[2]===255:file.type==="image/png"?head[0]===137&&head[1]===80&&head[2]===78&&head[3]===71:String.fromCharCode(...head.slice(0,4))==="RIFF"&&String.fromCharCode(...head.slice(8,12))==="WEBP";
    if(!valid)return json({error:"파일 내용이 이미지 형식과 일치하지 않습니다."},400);
    const key=user.id+"/"+id(); await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
    return json({url:"/media/"+key,key},201);
  }
  return json({error:"지원하지 않는 요청입니다."},404);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/")){try{return await handleApi(request,env)}catch(e){console.error("API error",e);return json({error:"서버 오류가 발생했습니다."},500)}}
  if(url.pathname.startsWith("/media/")){
    if(!env.MEDIA)return new Response("Not found",{status:404});
    const key=decodeURIComponent(url.pathname.slice(7)),obj=await env.MEDIA.get(key);
    if(!obj)return new Response("Not found",{status:404});
    const owner=await userFor(request,env);
    const allowed=!!(owner&&key.startsWith(owner.id+"/"))||!!(await env.DB.prepare("SELECT 1 AS ok FROM posts WHERE cover_key=? AND status='published'").bind(key).first());
    if(!allowed)return new Response("Not found",{status:404});
    return new Response(obj.body,{headers:{"content-type":obj.httpMetadata?.contentType||"application/octet-stream","cache-control":"public, max-age=86400","x-content-type-options":"nosniff"}});
  }
  return env.ASSETS.fetch(request);
 }
};
