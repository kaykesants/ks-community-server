// KS Community Server - Backend REAL para APK Editor X
// Node.js + Express - Compativel com KSCommunityApi.java
// Salva em arquivos JSON simples (sem banco) pra começar rapido

// KS Community Server - Backend REAL para APK Editor X
// Node.js + Express - Compativel com KSCommunityApi.java
// Salva em arquivos JSON simples (sem banco) pra começar rapido

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// Pastas de dados
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
        fs.writeFileSync(p, JSON.stringify(data, null, 2));
    }catch(e){ console.error("save error", e); }
}

let users = loadJson('users.json', []); // {id, name, username, bio, avatar, deviceFingerprint, token, createdAt, postsCount, isAdmin}
let posts = loadJson('posts.json', []); // {id, userId, name, username, avatar, content, category, createdAt, likes, comments, likedBy: []}
let comments = loadJson('comments.json', []); // {id, postId, userId, name, username, avatar, content, createdAt}
let reports = loadJson('reports.json', []);
let blocks = loadJson('blocks.json', []); // {userId, blockedUserId}
let notifications = loadJson('notifications.json', []);

function findUserByToken(token){
    return users.find(u => u.token === token);
}
function findUserByFingerprint(fp){
    return users.find(u => u.deviceFingerprint === fp);
}
function authMiddleware(req, res, next){
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if(!token){
        // Algumas rotas permitem anonimo (GET posts), entao nao bloqueia aqui, so seta req.user = null
        req.user = null;
        return next();
    }
    const user = findUserByToken(token);
    if(!user){
        return res.status(401).json({ error: "Token invalido ou expirado" });
    }
    req.user = user;
    next();
}

app.use(authMiddleware);

// ==================== AUTH ====================
app.post(['/api/auth/profile','/auth/profile'], (req, res) => {
    try{
        const { name, username, nick, bio, avatar, deviceFingerprint } = req.body;
        const finalUsername = (username || nick || 'user').toLowerCase().replace(/[^a-z0-9_]/g,'').substring(0,20) || 'user_'+Math.floor(Math.random()*1000);
        const finalName = name || finalUsername;

        if(!deviceFingerprint){
            return res.status(400).json({ error: "deviceFingerprint obrigatorio" });
        }

        let user = findUserByFingerprint(deviceFingerprint);
        if(user){
            // Atualiza dados
            user.name = finalName;
            user.username = finalUsername;
            user.bio = bio || user.bio;
            user.avatar = avatar || user.avatar;
            user.updatedAt = Date.now();
            saveJson('users.json', users);
            return res.json({
                token: user.token,
                userId: user.id,
                id: user.id,
                user: user
            });
        } else {
            // Cria novo
            const id = uuidv4();
            const token = uuidv4() + "-" + uuidv4();
            const newUser = {
                id,
                name: finalName,
                username: finalUsername,
                nick: finalUsername,
                bio: bio || "",
                avatar: avatar || "",
                photo: avatar || "",
                deviceFingerprint,
                token,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                postsCount: 0,
                repliesCount: 0,
                likesReceived: 0,
                isAdmin: false,
                isVerified: false,
                badges: []
            };
            // Primeiro usuario vira admin
            if(users.length===0) newUser.isAdmin = true;

            users.push(newUser);
            saveJson('users.json', users);
            return res.json({
                token: newUser.token,
                userId: newUser.id,
                id: newUser.id,
                user: newUser
            });
        }
    }catch(e){
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ==================== POSTS ====================
app.get(['/api/community/posts','/community/posts'], (req, res) => {
    try{
        let { page, limit, category } = req.query;
        page = parseInt(page) || 1;
        limit = parseInt(limit) || 20;
        let filtered = [...posts];

        // Filtra bloqueados
        if(req.user){
            const myBlocks = blocks.filter(b => b.userId === req.user.id).map(b => b.blockedUserId);
            filtered = filtered.filter(p => !myBlocks.includes(p.userId));
        }

        if(category && category !== 'TODOS'){
            filtered = filtered.filter(p => p.category === category);
        }

        // Ordena por createdAt desc (mais novo primeiro) + pinned primeiro
        filtered.sort((a,b) => {
            if(a.isPinned && !b.isPinned) return -1;
            if(!a.isPinned && b.isPinned) return 1;
            return b.createdAt - a.createdAt;
        });

        const start = (page-1)*limit;
        const paged = filtered.slice(start, start+limit);

        // Adiciona likedByMe e isOwner
        const result = paged.map(p => {
            const isOwner = req.user ? req.user.id === p.userId : false;
            const likedByMe = req.user ? (p.likedBy && p.likedBy.includes(req.user.id)) : false;
            return {
                ...p,
                isOwner,
                likedByMe
            };
        });

        res.json(result);
    }catch(e){
        res.status(500).json({ error: e.message });
    }
});

app.post(['/api/community/posts','/community/posts'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const { content, category } = req.body;
        if(!content || content.trim().length < 3){
            return res.status(400).json({ error: "Conteudo muito curto" });
        }
        if(content.length > 1000){
            return res.status(400).json({ error: "Conteudo muito longo (max 1000)" });
        }

        const validCats = ["GERAL","APK EDITOR","ANDROID","SMALI","MODDING","KS TOOLS","IDEIAS","OFF-TOPIC"];
        const finalCat = validCats.includes(category) ? category : "GERAL";

        const newPost = {
            id: uuidv4(),
            userId: req.user.id,
            name: req.user.name,
            username: req.user.username,
            avatar: req.user.avatar,
            content: content.trim(),
            category: finalCat,
            createdAt: Date.now(),
            likes: 0,
            comments: 0,
            likedBy: [],
            isPinned: false
        };
        posts.unshift(newPost);
        saveJson('posts.json', posts);

        // Atualiza contador user
        req.user.postsCount = (req.user.postsCount||0)+1;
        saveJson('users.json', users);

        res.json({ post: newPost, ...newPost });
    }catch(e){
        res.status(500).json({ error: e.message });
    }
});

app.post(['/api/community/posts/:id/like','/community/posts/:id/like'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const postId = req.params.id;
        const post = posts.find(p => p.id === postId);
        if(!post) return res.status(404).json({ error: "Post nao encontrado" });

        if(!post.likedBy) post.likedBy = [];
        const idx = post.likedBy.indexOf(req.user.id);
        let liked;
        if(idx >=0){
            post.likedBy.splice(idx,1);
            post.likes = Math.max(0, (post.likes||1)-1);
            liked = false;
        }else{
            post.likedBy.push(req.user.id);
            post.likes = (post.likes||0)+1;
            liked = true;

            // Notifica dono do post
            if(post.userId !== req.user.id){
                notifications.push({
                    id: uuidv4(),
                    type: "like",
                    title: "Curtiu seu post",
                    body: req.user.name + " curtiu: " + post.content.substring(0,50),
                    postId: post.id,
                    fromUserId: req.user.id,
                    fromUserName: req.user.name,
                    fromAvatar: req.user.avatar,
                    toUserId: post.userId,
                    createdAt: Date.now(),
                    read: false
                });
                saveJson('notifications.json', notifications);
            }
        }
        saveJson('posts.json', posts);
        res.json({ likes: post.likes, likedByMe: liked });
    }catch(e){
        res.status(500).json({ error: e.message });
    }
});

// ==================== COMMENTS ====================
app.get(['/api/community/posts/:id/comments','/community/posts/:id/comments'], (req, res) => {
    try{
        const postId = req.params.id;
        let postComments = comments.filter(c => c.postId === postId).sort((a,b)=>a.createdAt-b.createdAt);
        // Add isOwner
        const result = postComments.map(c => ({
            ...c,
            isOwner: req.user ? req.user.id === c.userId : false
        }));
        res.json(result);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post(['/api/community/posts/:id/comments','/community/posts/:id/comments'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const postId = req.params.id;
        const post = posts.find(p => p.id === postId);
        if(!post) return res.status(404).json({ error: "Post nao encontrado" });

        const { content } = req.body;
        if(!content || content.trim().length < 1) return res.status(400).json({ error: "Conteudo vazio" });

        const newComment = {
            id: uuidv4(),
            postId,
            userId: req.user.id,
            name: req.user.name,
            username: req.user.username,
            avatar: req.user.avatar,
            content: content.trim(),
            createdAt: Date.now(),
            likes: 0
        };
        comments.push(newComment);
        post.comments = (post.comments||0)+1;
        saveJson('comments.json', comments);
        saveJson('posts.json', posts);

        // Notifica dono
        if(post.userId !== req.user.id){
            notifications.push({
                id: uuidv4(),
                type: "reply",
                title: "Respondeu seu post",
                body: req.user.name + ": " + content.substring(0,80),
                postId: post.id,
                fromUserId: req.user.id,
                fromUserName: req.user.name,
                fromAvatar: req.user.avatar,
                toUserId: post.userId,
                createdAt: Date.now(),
                read: false
            });
            saveJson('notifications.json', notifications);
        }

        res.json(newComment);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== NOTIFICATIONS ====================
app.get(['/api/community/notifications','/community/notifications'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const myNotifs = notifications.filter(n => n.toUserId === req.user.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);
        res.json(myNotifs);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== REPORTS ====================
app.post(['/api/community/reports','/community/reports'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const { targetId, targetType, reason, details } = req.body;
        reports.push({
            id: uuidv4(),
            reporterId: req.user.id,
            targetId,
            targetType,
            reason,
            details,
            createdAt: Date.now(),
            status: "open"
        });
        saveJson('reports.json', reports);
        res.json({ success: true });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== BLOCK ====================
app.post(['/api/community/block','/community/block'], (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const { userId } = req.body;
        if(!userId) return res.status(400).json({ error: "userId obrigatorio" });
        if(userId === req.user.id) return res.status(400).json({ error: "Nao pode bloquear a si mesmo" });
        if(!blocks.find(b => b.userId === req.user.id && b.blockedUserId === userId)){
            blocks.push({ userId: req.user.id, blockedUserId: userId, createdAt: Date.now() });
            saveJson('blocks.json', blocks);
        }
        res.json({ success: true });
    }catch(e){ res.status(500).json({ error: e.message })
});

// ==================== USER ====================
app.get(['/api/community/users/:id','/community/users/:id'], (req, res) => {
    try{
        const u = users.find(x => x.id === req.params.id);
        if(!u) return res.status(404).json({ error: "Usuario nao encontrado" });
        // Nao retorna token nem fingerprint
        const { token, deviceFingerprint, ...safe } = u;
        res.json(safe);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== SEARCH ====================
app.get(['/api/community/search','/community/search'], (req, res) => {
    try{
        const q = (req.query.q || "").toLowerCase();
        if(!q) return res.json([]);
        let result = posts.filter(p => p.content.toLowerCase().includes(q) || p.username.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0,20);
        res.json(result);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/', (req,res) => {
    res.json({ status: "KS Community API Online", users: users.length, posts: posts.length, endpoints: ["/api/auth/profile","/api/community/posts","/api/community/posts/:id/comments"] });
});

app.listen(PORT, () => {
    console.log(`KS Community Server rodando em http://localhost:${PORT}`);
});
                isVerified: false,
                badges: []
            };
            // Primeiro usuario vira admin
            if(users.length===0) newUser.isAdmin = true;

            users.push(newUser);
            saveJson('users.json', users);
            return res.json({
                token: newUser.token,
                userId: newUser.id,
                id: newUser.id,
                user: newUser
            });
        }
    }catch(e){
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ==================== POSTS ====================
app.get('/api/community/posts', (req, res) => {
    try{
        let { page, limit, category } = req.query;
        page = parseInt(page) || 1;
        limit = parseInt(limit) || 20;
        let filtered = [...posts];

        // Filtra bloqueados
        if(req.user){
            const myBlocks = blocks.filter(b => b.userId === req.user.id).map(b => b.blockedUserId);
            filtered = filtered.filter(p => !myBlocks.includes(p.userId));
        }

        if(category && category !== 'TODOS'){
            filtered = filtered.filter(p => p.category === category);
        }

        // Ordena por createdAt desc (mais novo primeiro) + pinned primeiro
        filtered.sort((a,b) => {
            if(a.isPinned && !b.isPinned) return -1;
            if(!a.isPinned && b.isPinned) return 1;
            return b.createdAt - a.createdAt;
        });

        const start = (page-1)*limit;
        const paged = filtered.slice(start, start+limit);

        // Adiciona likedByMe e isOwner
        const result = paged.map(p => {
            const isOwner = req.user ? req.user.id === p.userId : false;
            const likedByMe = req.user ? (p.likedBy && p.likedBy.includes(req.user.id)) : false;
            return {
                ...p,
                isOwner,
                likedByMe
            };
        });

        res.json(result);
    }catch(e){
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/community/posts', (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const { content, category } = req.body;
        if(!content || content.trim().length < 3){
            return res.status(400).json({ error: "Conteudo muito curto" });
        }
        if(content.length > 1000){
            return res.status(400).json({ error: "Conteudo muito longo (max 1000)" });
        }

        const validCats = ["GERAL","APK EDITOR","ANDROID","SMALI","MODDING","KS TOOLS","IDEIAS","OFF-TOPIC"];
        const finalCat = validCats.includes(category) ? category : "GERAL";

        const newPost = {
            id: uuidv4(),
            userId: req.user.id,
            name: req.user.name,
            username: req.user.username,
            avatar: req.user.avatar,
            content: content.trim(),
            category: finalCat,
            createdAt: Date.now(),
            likes: 0,
            comments: 0,
            likedBy: [],
            isPinned: false
        };
        posts.unshift(newPost);
        saveJson('posts.json', posts);

        // Atualiza contador user
        req.user.postsCount = (req.user.postsCount||0)+1;
        saveJson('users.json', users);

        res.json({ post: newPost, ...newPost });
    }catch(e){
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/community/posts/:id/like', (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const postId = req.params.id;
        const post = posts.find(p => p.id === postId);
        if(!post) return res.status(404).json({ error: "Post nao encontrado" });

        if(!post.likedBy) post.likedBy = [];
        const idx = post.likedBy.indexOf(req.user.id);
        let liked;
        if(idx >=0){
            post.likedBy.splice(idx,1);
            post.likes = Math.max(0, (post.likes||1)-1);
            liked = false;
        }else{
            post.likedBy.push(req.user.id);
            post.likes = (post.likes||0)+1;
            liked = true;

            // Notifica dono do post
            if(post.userId !== req.user.id){
                notifications.push({
                    id: uuidv4(),
                    type: "like",
                    title: "Curtiu seu post",
                    body: req.user.name + " curtiu: " + post.content.substring(0,50),
                    postId: post.id,
                    fromUserId: req.user.id,
                    fromUserName: req.user.name,
                    fromAvatar: req.user.avatar,
                    toUserId: post.userId,
                    createdAt: Date.now(),
                    read: false
                });
                saveJson('notifications.json', notifications);
            }
        }
        saveJson('posts.json', posts);
        res.json({ likes: post.likes, likedByMe: liked });
    }catch(e){
        res.status(500).json({ error: e.message });
    }
});

// ==================== COMMENTS ====================
app.get('/api/community/posts/:id/comments', (req, res) => {
    try{
        const postId = req.params.id;
        let postComments = comments.filter(c => c.postId === postId).sort((a,b)=>a.createdAt-b.createdAt);
        // Add isOwner
        const result = postComments.map(c => ({
            ...c,
            isOwner: req.user ? req.user.id === c.userId : false
        }));
        res.json(result);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.post('/api/community/posts/:id/comments', (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const postId = req.params.id;
        const post = posts.find(p => p.id === postId);
        if(!post) return res.status(404).json({ error: "Post nao encontrado" });

        const { content } = req.body;
        if(!content || content.trim().length < 1) return res.status(400).json({ error: "Conteudo vazio" });

        const newComment = {
            id: uuidv4(),
            postId,
            userId: req.user.id,
            name: req.user.name,
            username: req.user.username,
            avatar: req.user.avatar,
            content: content.trim(),
            createdAt: Date.now(),
            likes: 0
        };
        comments.push(newComment);
        post.comments = (post.comments||0)+1;
        saveJson('comments.json', comments);
        saveJson('posts.json', posts);

        // Notifica dono
        if(post.userId !== req.user.id){
            notifications.push({
                id: uuidv4(),
                type: "reply",
                title: "Respondeu seu post",
                body: req.user.name + ": " + content.substring(0,80),
                postId: post.id,
                fromUserId: req.user.id,
                fromUserName: req.user.name,
                fromAvatar: req.user.avatar,
                toUserId: post.userId,
                createdAt: Date.now(),
                read: false
            });
            saveJson('notifications.json', notifications);
        }

        res.json(newComment);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== NOTIFICATIONS ====================
app.get('/api/community/notifications', (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const myNotifs = notifications.filter(n => n.toUserId === req.user.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);
        res.json(myNotifs);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== REPORTS ====================
app.post('/api/community/reports', (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const { targetId, targetType, reason, details } = req.body;
        reports.push({
            id: uuidv4(),
            reporterId: req.user.id,
            targetId,
            targetType,
            reason,
            details,
            createdAt: Date.now(),
            status: "open"
        });
        saveJson('reports.json', reports);
        res.json({ success: true });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== BLOCK ====================
app.post('/api/community/block', (req, res) => {
    try{
        if(!req.user) return res.status(401).json({ error: "Precisa autenticar" });
        const { userId } = req.body;
        if(!userId) return res.status(400).json({ error: "userId obrigatorio" });
        if(userId === req.user.id) return res.status(400).json({ error: "Nao pode bloquear a si mesmo" });
        if(!blocks.find(b => b.userId === req.user.id && b.blockedUserId === userId)){
            blocks.push({ userId: req.user.id, blockedUserId: userId, createdAt: Date.now() });
            saveJson('blocks.json', blocks);
        }
        res.json({ success: true });
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== USER ====================
app.get('/api/community/users/:id', (req, res) => {
    try{
        const u = users.find(x => x.id === req.params.id);
        if(!u) return res.status(404).json({ error: "Usuario nao encontrado" });
        // Nao retorna token nem fingerprint
        const { token, deviceFingerprint, ...safe } = u;
        res.json(safe);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

// ==================== SEARCH ====================
app.get('/api/community/search', (req, res) => {
    try{
        const q = (req.query.q || "").toLowerCase();
        if(!q) return res.json([]);
        let result = posts.filter(p => p.content.toLowerCase().includes(q) || p.username.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0,20);
        res.json(result);
    }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/', (req,res) => {
    res.json({ status: "KS Community API Online", users: users.length, posts: posts.length, endpoints: ["/api/auth/profile","/api/community/posts","/api/community/posts/:id/comments"] });
});

app.listen(PORT, () => {
    console.log(`KS Community Server rodando em http://localhost:${PORT}`);
});
