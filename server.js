// KS ADMIN BACKEND - Extensao do server.js existente
// Para suportar KS ADMIN CENTER com.kazin.admin
// Adicione este codigo ao seu server.js atual ou use este arquivo completo
// Compatível com Render, Java 7 client, sem dependencias pesadas

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
        // Escrita atomica para evitar corrupcao com 20-50 usuarios
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, p);
    }catch(e){ console.error("save error", e); }
}

// Dados existentes
let users = loadJson('users.json', []);
let posts = loadJson('posts.json', []);
let comments = loadJson('comments.json', []);
let reports = loadJson('reports.json', []);
let blocks = loadJson('blocks.json', []);
let notifications = loadJson('notifications.json', []);

// Novos dados para Admin Center
let adminUsers = loadJson('admin_users.json', []);
let adminSessions = loadJson('admin_sessions.json', []);
let updates = loadJson('updates.json', []);
let announcements = loadJson('announcements.json', []);
let appEvents = loadJson('app_events.json', []);
let auditLogs = loadJson('audit_logs.json', []);

// Cria admin padrao se nao existir
if(adminUsers.length === 0){
    const defaultAdmin = {
        id: uuidv4(),
        email: 'admin@kazin.com',
        passwordHash: crypto.createHash('sha256').update('kazin123').digest('hex'), // Em producao use bcrypt
        role: 'ADMIN',
        permissions: ['all'],
        createdAt: Date.now(),
        lastLoginAt: 0
    };
    adminUsers.push(defaultAdmin);
    saveJson('admin_users.json', adminUsers);
    console.log('Admin padrao criado: admin@kazin.com / kazin123');
}

// Helpers
function findUserByToken(token){ return users.find(u => u.token === token); }
function findUserByFingerprint(fp){ return users.find(u => u.deviceFingerprint === fp); }
function findAdminByToken(token){
    const session = adminSessions.find(s => s.token === token && s.expiresAt > Date.now());
    if(!session) return null;
    return adminUsers.find(a => a.id === session.adminUserId);
}
function hashPassword(pass){
    return crypto.createHash('sha256').update(pass).digest('hex');
}
function logAudit(adminId, action, targetId, targetType, details, result, ip){
    const log = {
        id: uuidv4(),
        adminUserId: adminId,
        action: action,
        targetId: targetId || null,
        targetType: targetType || null,
        details: details || null,
        result: result || 'success',
        createdAt: Date.now(),
        ip: ip || '0.0.0.0'
    };
    auditLogs.push(log);
    if(auditLogs.length > 1000) auditLogs = auditLogs.slice(-1000); // Mantem ultimos 1000
    saveJson('audit_logs.json', auditLogs);
}

// Middleware auth geral (para community)
function authMiddleware(req, res, next){
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if(!token){
        req.user = null;
        req.admin = null;
        return next();
    }
    // Tenta admin primeiro
    const admin = findAdminByToken(token);
    if(admin){
        req.admin = admin;
        req.user = null;
        return next();
    }
    const user = findUserByToken(token);
    req.user = user || null;
    req.admin = null;
    next();
}

// Middleware admin only
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

// ==================== AUTH EXISTENTE (Community) ====================
app.post(['/api/auth/profile','/auth/profile'], (req, res) => {
    try{
        const { name, username, nick, bio, avatar, deviceFingerprint, appVersion } = req.body;
        const finalUsername = (username || nick || 'user').toLowerCase().replace(/[^a-z0-9_]/g,'').substring(0,20) || 'user_'+Math.floor(Math.random()*1000);
        const finalName = name || finalUsername;
        if(!deviceFingerprint) return res.status(400).json({ error: 'deviceFingerprint obrigatorio' });
        let user = findUserByFingerprint(deviceFingerprint);
        if(user){
            user.name = finalName;
            user.username = finalUsername;
            user.bio = bio || user.bio;
            user.avatar = avatar || user.avatar;
            user.appVersion = appVersion || user.appVersion;
            user.updatedAt = Date.now();
            user.lastActiveAt = Date.now();
            saveJson('users.json', users);
            return res.json({ token: user.token, userId: user.id, id: user.id, user: user });
        } else {
            const id = uuidv4();
            const token = uuidv4() + '-' + uuidv4();
            const newUser = {
                id, name: finalName, username: finalUsername, nick: finalUsername,
                bio: bio || '', avatar: avatar || '', photo: avatar || '',
                deviceFingerprint, token, createdAt: Date.now(), updatedAt: Date.now(),
                lastActiveAt: Date.now(), postsCount: 0, commentsCount: 0, likesReceived: 0,
                isAdmin: users.length===0, isVerified: false, badges: [], status: 'active',
                appVersion: appVersion || 'unknown'
            };
            users.push(newUser);
            saveJson('users.json', users);
            return res.json({ token: newUser.token, userId: newUser.id, id: newUser.id, user: newUser });
        }
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN LOGIN ====================
app.post(['/api/admin/login','/admin/login'], (req, res) => {
    try{
        const { email, password } = req.body;
        if(!email || !password) return res.status(400).json({ error: 'Email e senha obrigatorios' });
        const admin = adminUsers.find(a => a.email.toLowerCase() === email.toLowerCase());
        if(!admin) return res.status(401).json({ error: 'Credenciais invalidas' });
        const hash = hashPassword(password);
        if(admin.passwordHash !== hash) return res.status(401).json({ error: 'Credenciais invalidas' });
        
        // Cria sessao
        const token = uuidv4() + '-' + uuidv4();
        const session = {
            id: uuidv4(),
            adminUserId: admin.id,
            token: token,
            createdAt: Date.now(),
            expiresAt: Date.now() + (7*24*60*60*1000) // 7 dias
        };
        adminSessions.push(session);
        admin.lastLoginAt = Date.now();
        saveJson('admin_users.json', adminUsers);
        saveJson('admin_sessions.json', adminSessions);
        logAudit(admin.id, 'admin_login', null, null, { email: email }, 'success', req.ip);
        
        res.json({ success: true, token: token, role: admin.role, user: { id: admin.id, email: admin.email, role: admin.role } });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get(['/api/admin/me','/admin/me'], adminAuthMiddleware, (req, res) => {
    res.json({ id: req.admin.id, email: req.admin.email, role: req.admin.role, permissions: req.admin.permissions });
});

// ==================== ADMIN DASHBOARD ====================
app.get(['/api/admin/dashboard','/admin/dashboard'], adminAuthMiddleware, (req, res) => {
    try{
        const now = Date.now();
        const sevenDaysAgo = now - (7*24*60*60*1000);
        const active7d = users.filter(u => (u.lastActiveAt || 0) > sevenDaysAgo).length;
        
        // Versoes em uso (agregado)
        const versionMap = {};
        users.forEach(u => {
            const v = u.appVersion || 'unknown';
            versionMap[v] = (versionMap[v] || 0) + 1;
        });
        
        const totalInstalls = users.length;
        const totalPosts = posts.length;
        const totalComments = comments.length;
        const pendingReports = reports.filter(r => r.status === 'open' || r.status === 'pending').length;
        
        const latestUpdate = updates.filter(u => u.status === 'published').sort((a,b) => b.versionCode - a.versionCode)[0];
        
        res.json({
            success: true,
            stats: {
                users: users.length,
                totalUsers: users.length,
                installs: totalInstalls,
                totalInstalls: totalInstalls,
                active: active7d,
                activeUsers: active7d,
                active7d: active7d,
                posts: totalPosts,
                totalPosts: totalPosts,
                comments: totalComments,
                totalComments: totalComments,
                reports: pendingReports,
                totalReports: reports.length,
                pendingReports: pendingReports,
                version: latestUpdate ? latestUpdate.versionName : '--',
                currentVersion: latestUpdate ? latestUpdate.versionName : '--',
                server: 'ONLINE',
                installs_total: totalInstalls,
                errors: appEvents.filter(e => e.event === 'operation_error' || e.event === 'update_error').length,
                versionsInUse: Object.keys(versionMap).length,
                versions: versionMap
            }
        });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN USERS ====================
app.get(['/api/admin/users','/admin/users'], adminAuthMiddleware, (req, res) => {
    try{
        let filtered = [...users];
        const search = (req.query.search || '').toLowerCase();
        const filter = req.query.filter || 'TODOS';
        
        if(search){
            filtered = filtered.filter(u => u.name.toLowerCase().includes(search) || u.username.toLowerCase().includes(search));
        }
        if(filter === 'ATIVOS'){
            const sevenDaysAgo = Date.now() - (7*24*60*60*1000);
            filtered = filtered.filter(u => (u.lastActiveAt || 0) > sevenDaysAgo);
        } else if(filter === 'INATIVOS'){
            const sevenDaysAgo = Date.now() - (7*24*60*60*1000);
            filtered = filtered.filter(u => (u.lastActiveAt || 0) <= sevenDaysAgo);
        } else if(filter === 'SUSPENSOS'){
            filtered = filtered.filter(u => u.status === 'suspended' || u.status === 'blocked');
        }
        
        // Remove dados sensiveis
        const safe = filtered.map(u => {
            const { token, deviceFingerprint, ...rest } = u;
            return rest;
        });
        
        res.json({ success: true, users: safe, data: safe, total: safe.length });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get(['/api/admin/users/:id','/admin/users/:id'], adminAuthMiddleware, (req, res) => {
    const u = users.find(x => x.id === req.params.id);
    if(!u) return res.status(404).json({ error: 'Usuario nao encontrado' });
    const { token, deviceFingerprint, ...safe } = u;
    res.json(safe);
});

app.post(['/api/admin/users/:id/suspend','/admin/users/:id/suspend'], adminAuthMiddleware, (req, res) => {
    const u = users.find(x => x.id === req.params.id);
    if(!u) return res.status(404).json({ error: 'Usuario nao encontrado' });
    u.status = 'suspended';
    u.suspendedAt = Date.now();
    u.suspendedBy = req.admin.id;
    u.suspendReason = req.body.reason || 'Acao administrativa';
    saveJson('users.json', users);
    logAudit(req.admin.id, 'suspend_user', u.id, 'user', { reason: u.suspendReason }, 'success', req.ip);
    res.json({ success: true, user: u });
});

app.post(['/api/admin/users/:id/unsuspend','/admin/users/:id/unsuspend'], adminAuthMiddleware, (req, res) => {
    const u = users.find(x => x.id === req.params.id);
    if(!u) return res.status(404).json({ error: 'Usuario nao encontrado' });
    u.status = 'active';
    saveJson('users.json', users);
    logAudit(req.admin.id, 'unsuspend_user', u.id, 'user', {}, 'success', req.ip);
    res.json({ success: true });
});

// ==================== ADMIN POSTS ====================
app.get(['/api/admin/posts','/admin/posts'], adminAuthMiddleware, (req, res) => {
    try{
        let filtered = [...posts];
        if(req.query.category && req.query.category !== 'TODOS'){
            filtered = filtered.filter(p => p.category === req.query.category);
        }
        filtered.sort((a,b) => b.createdAt - a.createdAt);
        res.json({ success: true, posts: filtered, data: filtered });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post(['/api/admin/posts/:id/hide','/admin/posts/:id/hide'], adminAuthMiddleware, (req, res) => {
    const p = posts.find(x => x.id === req.params.id);
    if(!p) return res.status(404).json({ error: 'Post nao encontrado' });
    p.isHidden = true;
    p.hiddenBy = req.admin.id;
    p.hiddenAt = Date.now();
    saveJson('posts.json', posts);
    logAudit(req.admin.id, 'hide_post', p.id, 'post', {}, 'success', req.ip);
    res.json({ success: true });
});

app.post(['/api/admin/posts/:id/restore','/admin/posts/:id/restore'], adminAuthMiddleware, (req, res) => {
    const p = posts.find(x => x.id === req.params.id);
    if(!p) return res.status(404).json({ error: 'Post nao encontrado' });
    p.isHidden = false;
    saveJson('posts.json', posts);
    logAudit(req.admin.id, 'restore_post', p.id, 'post', {}, 'success', req.ip);
    res.json({ success: true });
});

// ==================== ADMIN REPORTS ====================
app.get(['/api/admin/reports','/admin/reports'], adminAuthMiddleware, (req, res) => {
    let filtered = [...reports];
    if(req.query.status){
        filtered = filtered.filter(r => r.status === req.query.status);
    }
    filtered.sort((a,b) => b.createdAt - a.createdAt);
    res.json({ success: true, reports: filtered, data: filtered });
});

app.post(['/api/admin/reports/:id/resolve','/admin/reports/:id/resolve'], adminAuthMiddleware, (req, res) => {
    const r = reports.find(x => x.id === req.params.id);
    if(!r) return res.status(404).json({ error: 'Denuncia nao encontrada' });
    r.status = 'resolved';
    r.resolvedAt = Date.now();
    r.resolvedBy = req.admin.id;
    saveJson('reports.json', reports);
    logAudit(req.admin.id, 'resolve_report', r.id, 'report', {}, 'success', req.ip);
    res.json({ success: true });
});

// ==================== UPDATE CENTER ====================
app.get(['/api/admin/updates','/admin/updates'], adminAuthMiddleware, (req, res) => {
    const sorted = [...updates].sort((a,b) => b.versionCode - a.versionCode);
    res.json({ success: true, updates: sorted, data: sorted });
});

app.post(['/api/admin/updates','/admin/updates'], adminAuthMiddleware, (req, res) => {
    try{
        const { versionCode, versionName, title, description, changelog, downloadUrl, fileSize, size, sha256, mandatory, publishedAt } = req.body;
        if(!versionCode || !versionName || !downloadUrl) return res.status(400).json({ error: 'versionCode, versionName e downloadUrl obrigatorios' });
        
        // Verifica duplicado
        if(updates.find(u => u.versionCode === versionCode)){
            return res.status(400).json({ error: 'VersionCode ja existe' });
        }
        
        const newUpdate = {
            id: uuidv4(),
            versionCode: parseInt(versionCode),
            versionName: versionName,
            title: title || 'KS APK Editor X',
            description: description || '',
            changelog: changelog || [],
            downloadUrl: downloadUrl,
            fileSize: fileSize || size || 0,
            size: fileSize || size || 0,
            sha256: sha256 || '',
            mandatory: mandatory || false,
            status: 'draft',
            publishedAt: publishedAt || new Date().toISOString(),
            createdBy: req.admin.id,
            createdAt: Date.now()
        };
        updates.push(newUpdate);
        saveJson('updates.json', updates);
        logAudit(req.admin.id, 'create_update', newUpdate.id, 'update', { versionName: versionName }, 'success', req.ip);
        res.json({ success: true, update: newUpdate });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post(['/api/admin/updates/:id/publish','/admin/updates/:id/publish'], adminAuthMiddleware, (req, res) => {
    const u = updates.find(x => x.id === req.params.id);
    if(!u) return res.status(404).json({ error: 'Update nao encontrado' });
    u.status = 'published';
    u.publishedAt = new Date().toISOString();
    saveJson('updates.json', updates);
    logAudit(req.admin.id, 'publish_update', u.id, 'update', { versionName: u.versionName }, 'success', req.ip);
    res.json({ success: true, update: u });
});

// PUBLICO - APK Editor consulta
app.get(['/api/update/latest','/update/latest'], (req, res) => {
    try{
        const published = updates.filter(u => u.status === 'published').sort((a,b) => b.versionCode - a.versionCode)[0];
        if(!published){
            return res.status(404).json({ success: false, error: 'Nenhuma atualizacao publicada' });
        }
        res.json({
            success: true,
            versionCode: published.versionCode,
            versionName: published.versionName,
            title: published.title,
            description: published.description,
            changelog: published.changelog,
            downloadUrl: published.downloadUrl,
            size: published.fileSize || published.size || 0,
            fileSize: published.fileSize || published.size || 0,
            sha256: published.sha256,
            mandatory: published.mandatory,
            publishedAt: published.publishedAt
        });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== ANNOUNCEMENTS ====================
app.get(['/api/admin/announcements','/admin/announcements'], adminAuthMiddleware, (req, res) => {
    res.json({ success: true, announcements: announcements, data: announcements });
});

app.get(['/api/announcements','/announcements'], (req, res) => {
    const active = announcements.filter(a => a.active && (!a.expiresAt || new Date(a.expiresAt).getTime() > Date.now())).sort((a,b) => b.createdAt - a.createdAt);
    res.json({ success: true, announcements: active, data: active });
});

app.post(['/api/admin/announcements','/admin/announcements'], adminAuthMiddleware, (req, res) => {
    try{
        const { title, message, type, priority, active, expiresAt } = req.body;
        if(!title || !message) return res.status(400).json({ error: 'Titulo e mensagem obrigatorios' });
        const ann = {
            id: uuidv4(),
            title: title,
            message: message,
            type: (type || 'INFO').toUpperCase(),
            priority: (priority || 'NORMAL').toUpperCase(),
            active: active !== false,
            createdAt: Date.now(),
            expiresAt: expiresAt || null,
            createdBy: req.admin.id
        };
        announcements.push(ann);
        saveJson('announcements.json', announcements);
        logAudit(req.admin.id, 'publish_announcement', ann.id, 'announcement', { title: title }, 'success', req.ip);
        res.json({ success: true, announcement: ann });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== TELEMETRY ====================
app.post(['/api/telemetry/event','/telemetry/event'], (req, res) => {
    try{
        const { event, versionCode, versionName, androidVersion, deviceModel } = req.body;
        const allowedEvents = ['app_started','app_updated','update_check','update_download','update_install','editor_opened','project_opened','operation_success','operation_error','update_error'];
        if(!allowedEvents.includes(event)) return res.status(400).json({ error: 'Evento nao permitido' });
        
        // Anonimiza deviceModel
        let anonModel = 'unknown';
        if(deviceModel){
            anonModel = deviceModel.toLowerCase().replace(/[^a-z0-9]/g,'-').substring(0,20);
        }
        
        const ev = {
            id: uuidv4(),
            event: event,
            versionCode: versionCode || 0,
            versionName: versionName || 'unknown',
            androidVersion: androidVersion || 'unknown',
            deviceModel: anonModel,
            createdAt: Date.now(),
            deviceFingerprintHash: req.headers['x-device-fingerprint'] ? crypto.createHash('sha256').update(req.headers['x-device-fingerprint']).digest('hex').substring(0,16) : null
        };
        appEvents.push(ev);
        if(appEvents.length > 5000) appEvents = appEvents.slice(-5000); // Mantem ultimos 5k
        saveJson('app_events.json', appEvents);
        res.json({ success: true });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== HEALTH ====================
app.get(['/api/health','/health'], (req, res) => {
    res.json({
        status: 'ONLINE',
        database: 'ONLINE',
        community: posts.length >= 0 ? 'ONLINE' : 'OFFLINE',
        updateServer: 'ONLINE',
        uptime: process.uptime(),
        latency: 0,
        users: users.length,
        posts: posts.length,
        timestamp: new Date().toISOString()
    });
});

// ==================== EXISTENTES (Community) ====================
app.get(['/api/community/posts','/community/posts'], (req, res) => {
    try{
        let { page, limit, category } = req.query;
        page = parseInt(page) || 1;
        limit = parseInt(limit) || 20;
        let filtered = [...posts].filter(p => !p.isHidden);
        if(req.user){
            const myBlocks = blocks.filter(b => b.userId === req.user.id).map(b => b.blockedUserId);
            filtered = filtered.filter(p => !myBlocks.includes(p.userId));
        }
        if(category && category !== 'TODOS') filtered = filtered.filter(p => p.category === category);
        filtered.sort((a,b) => {
            if(a.isPinned && !b.isPinned) return -1;
            if(!a.isPinned && b.isPinned) return 1;
            return b.createdAt - a.createdAt;
        });
        const start = (page-1)*limit;
        const paged = filtered.slice(start, start+limit);
        const result = paged.map(p => {
            const isOwner = req.user ? req.user.id === p.userId : false;
            const likedByMe = req.user ? (p.likedBy && p.likedBy.includes(req.user.id)) : false;
            return { ...p, isOwner, likedByMe };
        });
        res.json(result);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post(['/api/community/posts','/community/posts'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: 'Precisa autenticar' });
        const { content, category } = req.body;
        if(!content || content.trim().length < 1) return res.status(400).json({ error: 'Conteudo vazio' });
        const newPost = {
            id: uuidv4(),
            userId: req.user.id,
            name: req.user.name,
            username: req.user.username,
            avatar: req.user.avatar,
            content: content.trim(),
            category: category || 'GERAL',
            createdAt: Date.now(),
            likes: 0,
            comments: 0,
            likedBy: []
        };
        posts.unshift(newPost);
        req.user.postsCount = (req.user.postsCount||0)+1;
        saveJson('posts.json', posts);
        saveJson('users.json', users);
        res.json({ success: true, post: newPost });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/', (req,res) => {
    res.json({ status: 'KS Community + Admin API Online', users: users.length, posts: posts.length, updates: updates.length, announcements: announcements.length, adminUsers: adminUsers.length });
});

app.listen(PORT, () => {
    console.log('KS Community + Admin Server rodando em http://localhost:'+PORT);
    console.log('Admin padrao: admin@kazin.com / kazin123');
});
