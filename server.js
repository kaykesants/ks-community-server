// KS Community + Admin Center - BACKEND FINAL COMPLETO COM LIKE E COMMENT
// Coloque este arquivo como server.js no seu Render (ks-community-server.onrender.com)

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJson(file, def){
    try{
        const p = path.join(DATA_DIR, file);
        if(!fs.existsSync(p)) return def;
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }catch(e){ return def; }
}
function saveJson(file, data){
    try{
        const p = path.join(DATA_DIR, file);
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, p);
    }catch(e){ console.error("save error", e); }
}

let users = loadJson('users.json', []);
let posts = loadJson('posts.json', []);
let comments = loadJson('comments.json', []);
let reports = loadJson('reports.json', []);
let blocks = loadJson('blocks.json', []);
let notifications = loadJson('notifications.json', []);
let adminUsers = loadJson('admin_users.json', []);
let adminSessions = loadJson('admin_sessions.json', []);
let updates = loadJson('updates.json', []);
let announcements = loadJson('announcements.json', []);
let appEvents = loadJson('app_events.json', []);
let auditLogs = loadJson('audit_logs.json', []);

if(adminUsers.length === 0){
    const defaultAdmin = {
        id: uuidv4(),
        email: 'admin@kazin.com',
        passwordHash: crypto.createHash('sha256').update('kazin123').digest('hex'),
        role: 'ADMIN',
        permissions: ['all'],
        createdAt: Date.now(),
        lastLoginAt: 0
    };
    adminUsers.push(defaultAdmin);
    saveJson('admin_users.json', adminUsers);
    console.log('Admin padrao criado: admin@kazin.com / kazin123');
}

function findUserByToken(token){ return users.find(u => u.token === token); }
function findUserByFingerprint(fp){ return users.find(u => u.deviceFingerprint === fp); }
function findAdminByToken(token){
    const session = adminSessions.find(s => s.token === token && s.expiresAt > Date.now());
    if(!session) return null;
    return adminUsers.find(a => a.id === session.adminUserId);
}
function hashPassword(pass){ return crypto.createHash('sha256').update(pass).digest('hex'); }
function logAudit(adminId, action, targetId, targetType, details, result, ip){
    const log = { id: uuidv4(), adminUserId: adminId, action, targetId: targetId||null, targetType: targetType||null, details: details||null, result: result||'success', createdAt: Date.now(), ip: ip||'0.0.0.0' };
    auditLogs.push(log);
    if(auditLogs.length > 1000) auditLogs = auditLogs.slice(-1000);
    saveJson('audit_logs.json', auditLogs);
}

function authMiddleware(req, res, next){
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if(!token){ req.user = null; req.admin = null; return next(); }
    const admin = findAdminByToken(token);
    if(admin){ req.admin = admin; req.user = null; return next(); }
    const user = findUserByToken(token);
    req.user = user || null;
    req.admin = null;
    next();
}
function adminAuthMiddleware(req, res, next){
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if(!token) return res.status(401).json({ error: 'Token obrigatorio' });
    const admin = findAdminByToken(token);
    if(!admin) return res.status(401).json({ error: 'Token invalido ou expirado' });
    req.admin = admin;
    next();
}

app.use(authMiddleware);

// AUTH
app.post(['/api/auth/profile','/auth/profile'], (req, res) => {
    try{
        const { name, username, nick, bio, avatar, deviceFingerprint, appVersion } = req.body;
        const finalUsername = (username || nick || 'user').toLowerCase().replace(/[^a-z0-9_]/g,'').substring(0,20) || 'user_'+Math.floor(Math.random()*1000);
        const finalName = name || finalUsername;
        if(!deviceFingerprint) return res.status(400).json({ error: 'deviceFingerprint obrigatorio' });
        let user = findUserByFingerprint(deviceFingerprint);
        if(user){
            user.name = finalName; user.username = finalUsername; user.bio = bio || user.bio; user.avatar = avatar || user.avatar;
            user.appVersion = appVersion || user.appVersion; user.updatedAt = Date.now(); user.lastActiveAt = Date.now();
            saveJson('users.json', users);
            return res.json({ token: user.token, userId: user.id, id: user.id, user });
        } else {
            const id = uuidv4(); const token = uuidv4() + '-' + uuidv4();
            const newUser = { id, name: finalName, username: finalUsername, nick: finalUsername, bio: bio||'', avatar: avatar||'', photo: avatar||'', deviceFingerprint, token, createdAt: Date.now(), updatedAt: Date.now(), lastActiveAt: Date.now(), postsCount: 0, repliesCount: 0, likesReceived: 0, isAdmin: users.length===0, isVerified: false, badges: [], status: 'active', appVersion: appVersion||'unknown' };
            users.push(newUser); saveJson('users.json', users);
            return res.json({ token: newUser.token, userId: newUser.id, id: newUser.id, user: newUser });
        }
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post(['/api/admin/auth/login','/admin/auth/login'], (req, res) => {
    try{
        const { email, password } = req.body;
        if(!email || !password) return res.status(400).json({ error: 'Email e senha obrigatorios' });
        const admin = adminUsers.find(a => a.email.toLowerCase() === email.toLowerCase());
        if(!admin || admin.passwordHash !== hashPassword(password)) return res.status(401).json({ error: 'Credenciais invalidas' });
        const token = uuidv4() + '-' + uuidv4();
        const session = { id: uuidv4(), adminUserId: admin.id, token, createdAt: Date.now(), expiresAt: Date.now() + 24*60*60*1000, ip: req.ip };
        adminSessions.push(session); admin.lastLoginAt = Date.now();
        saveJson('admin_sessions.json', adminSessions); saveJson('admin_users.json', adminUsers);
        logAudit(admin.id, 'login', null, 'admin', { email }, 'success', req.ip);
        res.json({ success: true, token, admin: { id: admin.id, email: admin.email, role: admin.role } });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// POSTS
app.get(['/api/community/posts','/community/posts'], (req, res) => {
    try{
        let { page, limit, category } = req.query; page = parseInt(page)||1; limit = parseInt(limit)||20;
        let filtered = [...posts].filter(p => !p.isHidden);
        if(req.user){ const myBlocks = blocks.filter(b => b.userId===req.user.id).map(b=>b.blockedUserId); filtered = filtered.filter(p => !myBlocks.includes(p.userId)); }
        if(category && category!=='TODOS') filtered = filtered.filter(p => p.category===category);
        filtered.sort((a,b)=>{ if(a.isPinned && !b.isPinned) return -1; if(!a.isPinned && b.isPinned) return 1; return b.createdAt-a.createdAt; });
        const start=(page-1)*limit; const paged=filtered.slice(start,start+limit);
        const result=paged.map(p=>({ ...p, isOwner: req.user?req.user.id===p.userId:false, likedByMe: req.user?(p.likedBy && p.likedBy.includes(req.user.id)):false }));
        res.json(result);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post(['/api/community/posts','/community/posts'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: 'Precisa autenticar' });
        const { content, category } = req.body;
        if(!content || content.trim().length<1) return res.status(400).json({ error: 'Conteudo vazio' });
        if(content.length>1000) return res.status(400).json({ error: 'Conteudo muito longo' });
        const newPost = { id: uuidv4(), userId: req.user.id, name: req.user.name, username: req.user.username, avatar: req.user.avatar, content: content.trim(), category: category||'GERAL', createdAt: Date.now(), likes:0, comments:0, likedBy:[], isPinned:false, isHidden:false };
        posts.unshift(newPost); req.user.postsCount=(req.user.postsCount||0)+1;
        saveJson('posts.json', posts); saveJson('users.json', users);
        res.json({ success:true, post:newPost, ...newPost });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// LIKE - FIX 404
app.post(['/api/community/posts/:id/like','/community/posts/:id/like'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: 'Precisa autenticar' });
        const postId=req.params.id; const post=posts.find(p=>p.id===postId);
        if(!post) return res.status(404).json({ error: 'Post nao encontrado' });
        if(!post.likedBy) post.likedBy=[];
        const idx=post.likedBy.indexOf(req.user.id); let liked;
        if(idx>=0){ post.likedBy.splice(idx,1); post.likes=Math.max(0,(post.likes||1)-1); liked=false; }
        else { post.likedBy.push(req.user.id); post.likes=(post.likes||0)+1; liked=true;
            if(post.userId!==req.user.id){ notifications.push({ id:uuidv4(), type:"like", title:"Curtiu seu post", body:req.user.name+" curtiu: "+post.content.substring(0,50), postId:post.id, fromUserId:req.user.id, fromUserName:req.user.name, fromAvatar:req.user.avatar, toUserId:post.userId, createdAt:Date.now(), read:false }); saveJson('notifications.json', notifications); }
        }
        saveJson('posts.json', posts);
        res.json({ likes: post.likes, likedByMe: liked, liked });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// COMMENTS - FIX 404
app.get(['/api/community/posts/:id/comments','/community/posts/:id/comments'], (req, res) => {
    try{
        const postId=req.params.id; let postComments=comments.filter(c=>c.postId===postId).sort((a,b)=>a.createdAt-b.createdAt);
        const result=postComments.map(c=>({ ...c, isOwner: req.user?req.user.id===c.userId:false }));
        res.json(result);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post(['/api/community/posts/:id/comments','/community/posts/:id/comments'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: 'Precisa autenticar' });
        const postId=req.params.id; const post=posts.find(p=>p.id===postId);
        if(!post) return res.status(404).json({ error: 'Post nao encontrado' });
        const { content }=req.body; if(!content || content.trim().length<1) return res.status(400).json({ error: 'Conteudo vazio' });
        const newComment={ id:uuidv4(), postId, userId:req.user.id, name:req.user.name, username:req.user.username, avatar:req.user.avatar, content:content.trim(), createdAt:Date.now(), likes:0 };
        comments.push(newComment); post.comments=(post.comments||0)+1;
        saveJson('comments.json', comments); saveJson('posts.json', posts);
        if(post.userId!==req.user.id){ notifications.push({ id:uuidv4(), type:"reply", title:"Respondeu seu post", body:req.user.name+": "+content.substring(0,80), postId:post.id, fromUserId:req.user.id, fromUserName:req.user.name, fromAvatar:req.user.avatar, toUserId:post.userId, createdAt:Date.now(), read:false }); saveJson('notifications.json', notifications); }
        res.json(newComment);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get(['/api/community/notifications','/community/notifications'], (req, res) => {
    try{ if(!req.user) return res.status(401).json({ error:'Precisa autenticar' }); const myNotifs=notifications.filter(n=>n.toUserId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50); res.json(myNotifs); }catch(e){ res.status(500).json({ error:e.message }); }
});

app.post(['/api/community/reports','/community/reports'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error:'Precisa autenticar' });
        const { targetId, targetType, reason, details }=req.body;
        reports.push({ id:uuidv4(), reporterId:req.user.id, targetId, targetType, reason, details, createdAt:Date.now(), status:'open' });
        saveJson('reports.json', reports); res.json({ success:true });
    }catch(e){ res.status(500).json({ error:e.message }); }
});

app.post(['/api/community/block','/community/block'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error:'Precisa autenticar' });
        const { userId }=req.body; if(!userId) return res.status(400).json({ error:'userId obrigatorio' });
        if(userId===req.user.id) return res.status(400).json({ error:'Nao pode bloquear a si mesmo' });
        if(!blocks.find(b=>b.userId===req.user.id && b.blockedUserId===userId)){ blocks.push({ userId:req.user.id, blockedUserId:userId, createdAt:Date.now() }); saveJson('blocks.json', blocks); }
        res.json({ success:true });
    }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get(['/api/community/users/:id','/community/users/:id'], (req, res) => {
    try{ const u=users.find(x=>x.id===req.params.id); if(!u) return res.status(404).json({ error:'Usuario nao encontrado' }); const { token, deviceFingerprint, ...safe }=u; res.json(safe); }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get(['/api/community/search','/community/search'], (req, res) => {
    try{ const q=(req.query.q||"").toLowerCase(); if(!q) return res.json([]); let result=posts.filter(p=>p.content.toLowerCase().includes(q)||p.username.toLowerCase().includes(q)||p.name.toLowerCase().includes(q)).slice(0,20); res.json(result); }catch(e){ res.status(500).json({ error:e.message }); }
});

// ADMIN
app.get(['/api/admin/stats','/admin/stats'], adminAuthMiddleware, (req, res) => {
    const now=Date.now(); const sevenDaysAgo=now-7*24*60*60*1000;
    const active7=users.filter(u=>u.lastActiveAt && u.lastActiveAt>sevenDaysAgo).length;
    res.json({ users: users.length, active7, posts: posts.length, comments: comments.length, reports: reports.filter(r=>r.status==='open').length, updates: updates.length, announcements: announcements.length, events: appEvents.length });
});

app.get(['/api/admin/users','/admin/users'], adminAuthMiddleware, (req, res) => {
    const safeUsers=users.map(u=>{ const {token, deviceFingerprint, ...safe}=u; return safe; });
    res.json({ success:true, users:safeUsers, data:safeUsers });
});
app.get(['/api/admin/posts','/admin/posts'], adminAuthMiddleware, (req, res) => { res.json({ success:true, posts, data:posts }); });
app.get(['/api/admin/reports','/admin/reports'], adminAuthMiddleware, (req, res) => { res.json({ success:true, reports, data:reports }); });
app.post(['/api/admin/users/:id/suspend','/admin/users/:id/suspend'], adminAuthMiddleware, (req, res) => {
    const user=users.find(u=>u.id===req.params.id); if(!user) return res.status(404).json({ error:'Usuario nao encontrado' });
    user.status='suspended'; saveJson('users.json', users);
    logAudit(req.admin.id, 'suspend_user', user.id, 'user', req.body, 'success', req.ip);
    res.json({ success:true });
});
app.get(['/api/admin/updates','/admin/updates'], adminAuthMiddleware, (req, res) => { res.json({ success:true, updates, data:updates }); });
app.get(['/api/update/latest','/update/latest','/api/updates/latest'], (req, res) => {
    try{
        const published=updates.filter(u=>u.published).sort((a,b)=>b.versionCode-a.versionCode)[0];
        if(!published) return res.status(404).json({ error:'Nenhuma atualizacao publicada' });
        res.json({ versionCode:published.versionCode, versionName:published.versionName, title:published.title, description:published.description, changelog:published.changelog, downloadUrl:published.downloadUrl, fileSize:published.fileSize||published.size||0, sha256:published.sha256, mandatory:published.mandatory, publishedAt:published.publishedAt });
    }catch(e){ res.status(500).json({ error:e.message }); }
});
app.post(['/api/admin/updates','/admin/updates'], adminAuthMiddleware, (req, res) => {
    try{
        const { versionCode, versionName, title, description, changelog, downloadUrl, fileSize, sha256, mandatory }=req.body;
        if(!versionCode || !versionName || !downloadUrl) return res.status(400).json({ error:'versionCode, versionName e downloadUrl obrigatorios' });
        const upd={ id:uuidv4(), versionCode:parseInt(versionCode), versionName, title:title||'Atualizacao '+versionName, description:description||'', changelog:changelog||[], downloadUrl, fileSize:fileSize||0, size:fileSize||0, sha256:sha256||'', mandatory:!!mandatory, published:true, publishedAt:Date.now(), createdBy:req.admin.id, createdAt:Date.now() };
        updates.push(upd); saveJson('updates.json', updates);
        logAudit(req.admin.id, 'publish_update', upd.id, 'update', { versionName }, 'success', req.ip);
        res.json({ success:true, update:upd });
    }catch(e){ res.status(500).json({ error:e.message }); }
});
app.get(['/api/admin/announcements','/admin/announcements'], adminAuthMiddleware, (req, res) => { res.json({ success:true, announcements, data:announcements }); });
app.get(['/api/announcements','/announcements'], (req, res) => {
    const active=announcements.filter(a=>a.active && (!a.expiresAt || new Date(a.expiresAt).getTime()>Date.now())).sort((a,b)=>b.createdAt-a.createdAt);
    res.json({ success:true, announcements:active, data:active });
});
app.post(['/api/admin/announcements','/admin/announcements'], adminAuthMiddleware, (req, res) => {
    try{
        const { title, message, type, priority, active, expiresAt }=req.body;
        if(!title || !message) return res.status(400).json({ error:'Titulo e mensagem obrigatorios' });
        const ann={ id:uuidv4(), title, message, type:(type||'INFO').toUpperCase(), priority:(priority||'NORMAL').toUpperCase(), active:active!==false, createdAt:Date.now(), expiresAt:expiresAt||null, createdBy:req.admin.id };
        announcements.push(ann); saveJson('announcements.json', announcements);
        logAudit(req.admin.id, 'publish_announcement', ann.id, 'announcement', { title }, 'success', req.ip);
        res.json({ success:true, announcement:ann });
    }catch(e){ res.status(500).json({ error:e.message }); }
});
app.get(['/api/health','/health'], (req, res) => {
    res.json({ status:'ONLINE', database:'ONLINE', community:posts.length>=0?'ONLINE':'OFFLINE', updateServer:'ONLINE', uptime:process.uptime(), users:users.length, posts:posts.length, timestamp:new Date().toISOString() });
});
app.get('/', (req,res) => { res.json({ status:'KS Community + Admin API Online - FULL FIXED 404', users:users.length, posts:posts.length, comments:comments.length, updates:updates.length, announcements:announcements.length }); });
app.listen(PORT, () => { console.log('KS Community + Admin FULL FIXED 404 rodando em '+PORT); });
