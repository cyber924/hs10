const $=s=>document.querySelector(s);let currentUser=null;
async function api(path,options={}){const headers={...(options.headers||{})};if(options.body&&!(options.body instanceof FormData))headers["content-type"]="application/json";const r=await fetch(path,{...options,headers,credentials:"same-origin"});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||"요청을 처리하지 못했습니다.");return data}
function openModal(html,wide=false){$("#modalContent").innerHTML=html;$("#modal .modal").classList.toggle("wide-editor",wide);$("#modal").classList.add("open")}
function closeModal(){$("#modal").classList.remove("open");$("#modal .modal").classList.remove("wide-editor")}
$("#modalClose").onclick=closeModal;$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
function loginView(){openModal(`<p class="eyebrow">YOUR PRIVATE STUDIO</p><h2>작업실에 로그인</h2><p class="hint">계정이 없다면 첫 관리자 계정을 생성할 수 있습니다. 최초 1개 계정만 공개 가입으로 생성됩니다.</p><form id="loginForm"><div class="field"><label>이메일</label><input name="email" type="email" required autocomplete="username"></div><div class="field"><label>비밀번호</label><input name="password" type="password" required autocomplete="current-password"></div><button class="btn lime">로그인</button><div class="message" id="authMsg"></div></form><button class="small-btn" id="registerOpen">첫 관리자 계정 만들기</button>`);
$("#loginForm").onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));try{await api("/api/auth/login",{method:"POST",body:JSON.stringify(b)});await refreshUser();closeModal();manageView()}catch(err){$("#authMsg").textContent=err.message}};
$("#registerOpen").onclick=registerView}
function registerView(){openModal(`<p class="eyebrow">INITIAL SETUP</p><h2>관리자 계정 만들기</h2><p class="hint">첫 계정은 관리자 권한을 가집니다. 비밀번호는 12자 이상이어야 합니다.</p><form id="registerForm"><div class="field"><label>이름</label><input name="name" required></div><div class="field"><label>이메일</label><input name="email" type="email" required></div><div class="field"><label>비밀번호</label><input name="password" type="password" minlength="12" required></div><button class="btn lime">관리자 계정 생성</button><div class="message" id="authMsg"></div></form>`);$("#registerForm").onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));try{await api("/api/auth/register",{method:"POST",body:JSON.stringify(b)});await refreshUser();closeModal();manageView()}catch(err){$("#authMsg").textContent=err.message}}}
async function refreshUser(){const d=await api("/api/auth/me");currentUser=d.user;$("#loginOpen").textContent=currentUser?"작업실 열기":"로그인하기"}
async function loadPosts(){try{const d=await api("/api/posts");$("#postGrid").innerHTML=d.posts.length?d.posts.map(p=>`<a class="post-card" href="#post/${encodeURIComponent(p.slug)}"><span class="category">${escapeHtml(p.category)}</span><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.excerpt)}</p><time>${new Date(p.publishedAt||p.createdAt).toLocaleDateString("ko-KR")}</time></a>`).join(""):'<div class="empty">아직 공개된 이야기가 없습니다. 첫 번째 글을 기다리고 있어요.</div>'}catch{$("#postGrid").innerHTML='<div class="empty">글을 불러오지 못했습니다.</div>'}}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function manageView(){if(!currentUser){loginView();return}openModal(`<p class="eyebrow">PRIVATE WRITING STUDIO</p><h2>나의 보관함</h2><p class="hint">${escapeHtml(currentUser.email)} · ${escapeHtml(currentUser.role)}</p><div class="manage-toolbar"><button class="btn lime" id="newPost">+ 새 글 작성</button>${currentUser.role==="admin"?'<button class="btn light" id="aiSettings">Gemini AI 설정</button>':""}</div><div class="manage-list" id="manageList">불러오는 중…</div><button class="small-btn" id="logout">로그아웃</button>`);$("#newPost").onclick=()=>editorView();if($("#aiSettings"))$("#aiSettings").onclick=aiSettingsView;$("#logout").onclick=async()=>{await api("/api/auth/logout",{method:"POST",body:"{}"});await refreshUser();closeModal()};try{const d=await api("/api/manage/posts");$("#manageList").innerHTML=d.posts.length?d.posts.map(p=>`<div class="manage-item"><div><b>${escapeHtml(p.title)}</b><br><small>${p.status==="published"?"공개":"초안"} · ${new Date(p.updatedAt).toLocaleDateString("ko-KR")}</small></div><div class="manage-actions"><button class="small-btn ${p.status==="published"?"":"primary"}" data-publish="${p.id}" data-status="${p.status}">${p.status==="published"?"공개 중 · 비공개 전환":"공개웹진 배포"}</button><button class="small-btn primary" data-edit="${p.id}">수정</button><button class="small-btn" data-delete="${p.id}">삭제</button></div></div>`).join(""):'<div class="empty">저장된 글이 없습니다.</div>';$("#manageList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editorView(d.posts.find(p=>p.id===b.dataset.edit)));$("#manageList").querySelectorAll("[data-publish]").forEach(b=>b.onclick=async()=>{const post=d.posts.find(p=>p.id===b.dataset.publish);const next=post.status==="published"?"draft":"published";const label=b.textContent;b.disabled=true;b.textContent=next==="published"?"배포 중…":"전환 중…";try{await api("/api/manage/posts/"+post.id,{method:"PUT",body:JSON.stringify({title:post.title,excerpt:post.excerpt,body:post.body,category:post.category,coverUrl:post.coverUrl,status:next})});await loadPosts();manageView()}catch(e){b.disabled=false;b.textContent=label;alert(e.message)}});$("#manageList").querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("이 글을 삭제할까요?")){await api("/api/manage/posts/"+b.dataset.delete,{method:"DELETE"});manageView()}})}catch(e){$("#manageList").textContent=e.message}}

async function aiSettingsView(){
 openModal(`<p class="eyebrow">AI WRITING ENGINE</p><h2>Gemini AI 설정</h2><p class="hint">Google AI Studio에서 발급한 API 키를 등록하세요. 키는 암호화되어 D1에 저장되며 화면에 다시 표시되지 않습니다.</p><form id="aiSettingsForm"><div class="field"><label>Gemini API Key</label><input name="apiKey" type="password" placeholder="AIza..." minlength="20" required autocomplete="new-password"></div><button class="btn lime">API 키 안전하게 저장</button><div class="message" id="aiSettingsMsg"></div></form><button class="small-btn" id="testGemini">저장된 API 연결 테스트</button><div class="message" id="aiTestMsg"></div><p class="hint">API 키 발급: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a></p>`);
 try{const d=await api("/api/ai/settings");$("#aiSettingsMsg").textContent=d.configured?"저장된 API 키가 있습니다. 새 키를 입력하면 교체됩니다.":"아직 API 키가 등록되지 않았습니다."}catch(e){$("#aiSettingsMsg").textContent=e.message}
 $("#aiSettingsForm").onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));try{await api("/api/ai/settings",{method:"POST",body:JSON.stringify({apiKey:b.apiKey})});$("#aiSettingsForm").reset();$("#aiSettingsMsg").textContent="API 키를 암호화해 저장했습니다."}catch(err){$("#aiSettingsMsg").textContent=err.message}};
 $("#testGemini").onclick=async()=>{const el=$("#aiTestMsg");el.textContent="Gemini 연결 확인 중…";try{const d=await api("/api/ai/test",{method:"POST",body:"{}"});el.textContent="연결 성공: "+d.message}catch(e){el.textContent=e.message}};
}
function editorView(post=null){
 openModal(`<div class="editor-heading"><div><p class="eyebrow">WRITE WITH INTENTION</p><h2>${post?"글 수정":"새 이야기 쓰기"}</h2></div><span class="editor-note">HS10 PROFESSIONAL EDITOR</span></div>
 <form id="postForm" class="editor-form">
 <div class="editor-main">
  <div class="editor-content">
  <div class="field"><label>제목</label><input name="title" required maxlength="180" placeholder="이야기의 제목을 입력하세요" value="${escapeHtml(post?.title||"")}"></div>
  <div class="field"><label>한 줄 소개</label><input name="excerpt" maxlength="500" placeholder="독자에게 소개할 짧은 문장" value="${escapeHtml(post?.excerpt||"")}"></div>
  <div class="field"><label>본문</label><textarea name="body" required placeholder="당신의 이야기를 시작하세요…">${escapeHtml(post?.body||"")}</textarea></div>
 </div>
 <aside class="editor-side">
  <div class="field"><label>카테고리</label><input name="category" value="${escapeHtml(post?.category||"에세이")}"></div>
  <div class="field"><label>대표 이미지 URL (선택)</label><input name="coverUrl" type="url" placeholder="https://" value="${escapeHtml(post?.coverUrl?.startsWith("http")?post.coverUrl:"")}"><small>이미지 호스팅 주소를 입력하세요. R2는 필요 없습니다.</small></div>
  <div class="field"><label>발행 상태</label><select name="status"><option value="draft" ${post?.status!=="published"?"selected":""}>초안 저장</option><option value="published" ${post?.status==="published"?"selected":""}>공개 발행</option></select></div>
  <div class="ai-panel"><p class="eyebrow">GEMINI AI ASSISTANT</p><h3>AI 글쓰기 도우미</h3><p>주제나 작성 지시를 입력하면 본문 초안을 생성합니다.</p><textarea id="aiPrompt" placeholder="예: 2026년 데이터센터 전력시장 전망을 전문 보고서 형식으로 1,500자 작성해줘"></textarea><div class="field"><label>AI 모델</label><select id="aiModel"><option value="gemini-3.8-flash">Gemini 3.8 Flash (기본)</option><option value="gemini-3.6-flash">Gemini 3.6 Flash</option></select></div><button type="button" class="btn ai-button" id="generateAI">AI로 본문 생성</button><div class="message" id="aiMsg"></div></div>
 </aside>
 </div>
 <div class="editor-footer"><div class="message" id="postMsg"></div><button class="btn lime" type="submit">저장하기</button></div>
 </form>`,true);
 $("#generateAI").onclick=async()=>{const msg=$("#aiMsg"),btn=$("#generateAI");const prompt=$("#aiPrompt").value.trim();if(!prompt){msg.textContent="AI 작성 지시를 입력해 주세요.";return}btn.disabled=true;btn.textContent="Gemini가 작성 중입니다…";msg.textContent="잠시만 기다려 주세요.";try{const form=$("#postForm"),payload=Object.fromEntries(new FormData(form));const d=await api("/api/ai/generate",{method:"POST",body:JSON.stringify({prompt,title:payload.title,body:payload.body,model:$("#aiModel").value})});form.elements.body.value=d.text;msg.textContent="생성 완료! 본문에 반영했습니다."}catch(e){msg.textContent=e.message}finally{btn.disabled=false;btn.textContent="AI로 본문 생성"}};
 $("#postForm").onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent="저장 중…";try{if(post)await api("/api/manage/posts/"+post.id,{method:"PUT",body:JSON.stringify(b)});else await api("/api/manage/posts",{method:"POST",body:JSON.stringify(b)});await loadPosts();manageView()}catch(err){$("#postMsg").textContent=err.message;btn.disabled=false;btn.textContent="저장하기"}};
}
$("#loginOpen").onclick=()=>currentUser?manageView():loginView();$("#startWriting").onclick=()=>currentUser?editorView():loginView();$("#studioOpen").onclick=()=>currentUser?manageView():loginView();$("#archiveLink").onclick=()=>currentUser?manageView():loginView();
function renderArticleBody(source){
 let out=escapeHtml(source||"");
 out=out.replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>");
 out=out.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/^---$/gm,"<hr>");
 return out.split(/\n{2,}/).map(block=>{const t=block.trim();if(!t)return "";if(/^<(h[1-3]|hr)/.test(t))return t;return "<p>"+t.replace(/\n/g,"<br>")+"</p>"}).join("");
}
async function showArticle(){
 const m=location.hash.match(/^#post\/(.+)$/);if(!m)return;
 try{
  const d=await api("/api/posts/"+m[1]),p=d.post;
  const date=new Date(p.publishedAt||p.createdAt).toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric"});
  openModal(\`<article class="webzine-article">
   <div class="article-topline"><a href="#webzine" id="articleBack">HUB STUDIO 10 <span>/</span> WEBZINE</a><span>STORIES THAT STAY</span></div>
   <header class="article-header"><p class="article-category">\${escapeHtml(p.category)}</p><h1>\${escapeHtml(p.title)}</h1><p class="article-deck">\${escapeHtml(p.excerpt||"")}</p><div class="article-byline"><span>HUB STUDIO 10 EDITION</span><time>\${date}</time></div></header>
   \${p.coverUrl?\`<figure class="article-cover"><img src="\${escapeHtml(p.coverUrl)}" alt="\${escapeHtml(p.title)}"><figcaption>\${escapeHtml(p.title)}</figcaption></figure>\`:""}
   <div class="article-layout"><aside class="article-aside"><span>READING</span><b>HUB<br>STUDIO<br>10</b><span>\${date}</span></aside><div class="article-body">\${renderArticleBody(p.body)}</div></div>
   <footer class="article-footer"><span>END OF STORY</span><a href="#webzine">다른 이야기 읽기 ↗</a></footer>
  </article>\`,true);
  $("#modal .modal").classList.add("webzine-detail");
  $("#articleBack").onclick=()=>{closeModal();location.hash="webzine"};
 }catch(e){openModal("<h2>글을 찾을 수 없습니다.</h2>")}
}
window.addEventListener("hashchange",showArticle);
if(location.hash.startsWith("#post/"))showArticle();
(async()=>{try{await refreshUser()}catch{}await loadPosts()})();
