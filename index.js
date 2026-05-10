(async () => {
    "use strict";

    const CONFIG = {
        NAME: "Relay",
        VERSION: "v1.0.0-phantom",
        CREATOR: "BLAZE-X",
        THEME: "#0a4d33",
        SUCCESS: "#10B981",
        WARN: "#F59E0B",
        ERR: "#EF4444",
        MAX_LOG_ITEMS: 80,
    };

    
    
    const _c = CONFIG.CREATOR;
    const _sum = _c.split('').reduce((a, b) => a + b.charCodeAt(0), 0); 

    function _unlock(arr) {
        let res = '';
        for (let i = 0; i < arr.length; i++) {
            res += String.fromCharCode(arr[i] ^ _c.charCodeAt(i % _c.length));
        }
        return res;
    }

    
    const _QS   = _unlock([19, 57, 36, 41, 49, 126, 44, 45, 62, 36]); 
    const _QSS  = _unlock([19, 57, 36, 41, 49, 94, 11, 54, 35, 51, 63]); 
    const _RGS  = _unlock([16, 57, 47, 52, 44, 67, 63, 5, 45, 44, 63, 22, 89, 55, 48, 41]); 
    const _EP_Q = _unlock([51, 57, 36, 41, 49, 94]); 
    const _EP_E = _unlock([39, 34, 51, 53, 41, 65]); 
    const _EP_C = _unlock([33, 32, 32, 51, 40, 0, 42, 39, 59, 32, 40, 33]); 
    const _EP_V = _unlock([52, 37, 37, 63, 42, 0, 40, 48, 35, 38, 40, 32, 94, 43]); 

    
    const DRIFT = _sum / 499; 
    const _verify = () => (_c.length === 7 && _sum === 499);
    

    function nameSeed(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
        return (h >>> 0) & 0x7fffffff;
    }
    const CREATOR_SEED = nameSeed(CONFIG.CREATOR);
    const SEED_A = (CONFIG.CREATOR.charCodeAt(0) ^ 66) | (CONFIG.CREATOR.charCodeAt(CONFIG.CREATOR.length - 1) ^ 88);
    const SEED_B = (CONFIG.CREATOR.charCodeAt(2) ^ 76) & 7;
    const SEED_C = CONFIG.CREATOR.length & 3;
    const SEED_D = (CONFIG.CREATOR.charCodeAt(4) || 66) % 5;

    function mulberry32(a) {
        
        let _v = _verify() ? 1 : NaN; 
        return function() {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return (((t ^ t >>> 14) >>> 0) / 4294967296) * _v;
        };
    }
    const rng = mulberry32(CREATOR_SEED);

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const rnd = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
    const gaussRandom = (mean, std) => {
        let u = 1 - rng(), v = rng();
        return Math.max(0, mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v));
    };
    const lognormalRandom = (mu, sigma) => Math.exp(gaussRandom(mu, sigma));
    const randomPID = () => ((Date.now() >> 4) ^ Math.floor(rng() * 65535)) & 0x7FFF;

    const TIMING = {
        video: { mu: (1.8 + rng() * 0.2) * DRIFT, sigma: 0.25 + rng() * 0.15 },
        enroll: { mean: rnd(800, 1200) * DRIFT, std: rnd(200, 400) },
        claim: { min: rnd(15000, 30000) * DRIFT, max: rnd(30000, 45000), extra: { prob: 0.1 + rng() * 0.1, min: rnd(60000, 120000), max: rnd(180000, 360000) } },
        pause: { prob: 0.1 + rng() * 0.1, mean: rnd(3000, 6000), std: rnd(1500, 2500) },
        abandon: { fails: rnd(2, 3), prob: 0.6 + rng() * 0.2 },
        captcha: { prob: 0.2 + rng() * 0.15, delayMin: rnd(60000, 90000), delayMax: rnd(150000, 240000) }
    };

    const RUNTIME = {
        running: true,
        sequenceActive: false,
        cleanups: new Set(),
        autoEnroll: true,
        autoClaim: true,
        playSound: false,
        stealthRPC: true,
        tasks: new Map(),
        lastHumanActivity: 0,
    };

    let _relayInjected = false;
    if (_relayInjected) return console.warn(`[${CONFIG.NAME}] Already active.`);
    _relayInjected = true;

    const Storage = {
        _mem: new Map(),
        save(k, v) { this._mem.set(k, v); },
        load(k) { return this._mem.get(k) || null; }
    };

    const humanActivityListener = () => { RUNTIME.lastHumanActivity = Date.now(); };
    window.addEventListener('mousemove', humanActivityListener, { passive: true });
    window.addEventListener('keydown', humanActivityListener, { passive: true });
    RUNTIME.cleanups.add(() => {
        window.removeEventListener('mousemove', humanActivityListener);
        window.removeEventListener('keydown', humanActivityListener);
    });

    const ErrorHandler = {
        
        RETRYABLE: new Set([_sum - 70, _sum + 1, _sum + 3, _sum + 4, _sum + 5, _sum - 91]),
        CLIENT: new Set([_sum - 99, _sum - 96, _sum - 95, _sum - 90, _sum - 89]),
        classify(e) {
            const s = e?.status ?? e?.statusCode;
            return { retryable: this.RETRYABLE.has(s), client: this.CLIENT.has(s), status: s, msg: e?.message ?? e?.body?.message ?? `HTTP ${s}` };
        },
        isSkippable(e) { return e?.status === (_sum - 95) || e?.status === (_sum - 96) || e?.status === (_sum - 89); }
    };

    function hookModules() {
        try {
            if (typeof webpackChunkdiscord_app === 'undefined') return null;
            let req;
            webpackChunkdiscord_app.push([[Symbol()], {}, (r) => {
                if (typeof req === 'undefined' || Object.keys(r.c).length > Object.keys(req.c).length) req = r;
            }]);
            webpackChunkdiscord_app.pop();
            if (!req) return null;
            const m = Object.values(req.c);

            const findStore = name => {
                for (const mod of m) {
                    const exp = mod?.exports;
                    if (!exp || typeof exp !== 'object') continue;
                    for (const k of Object.keys(exp)) {
                        const p = exp[k];
                        if (p && typeof p === 'object' && p.__proto__?.constructor?.displayName === name) return p;
                    }
                }
            };
            const findDispatcher = () => {
                for (const mod of m) {
                    const exp = mod?.exports;
                    if (!exp || typeof exp !== 'object') continue;
                    for (const k of Object.keys(exp)) {
                        const p = exp[k];
                        if (p && p._subscriptions && typeof p.subscribe === 'function') return p;
                    }
                }
            };
            const findAPI = () => {
                for (const mod of m) {
                    const exp = mod?.exports;
                    if (!exp || typeof exp !== 'object') continue;
                    for (const k of Object.keys(exp)) {
                        const p = exp[k];
                        if (p && typeof p.get === 'function' && typeof p.post === 'function' && typeof p.patch === 'function' && typeof p.del === 'function' && !p._dispatcher) return p;
                    }
                }
            };
            
            const findRouter = () => {
                const isRouter = obj => {
                    if (!obj || typeof obj !== 'object') return false;
                    try {
                        if (typeof obj.transitionTo !== 'function') return false;
                        return typeof obj.back === 'function' || typeof obj.replace === 'function'
                            || typeof obj.go === 'function' || typeof obj.goBack === 'function'
                            || typeof obj.push === 'function';
                    } catch(e) {
                        return false;
                    }
                };
                for (const mod of m) {
                    const exp = mod?.exports;
                    if (!exp || typeof exp !== 'object') continue;
                    try { if (isRouter(exp)) return exp; } catch(e) {}
                    try { if (isRouter(exp.Z)) return exp.Z; } catch(e) {}
                    try { if (isRouter(exp.default)) return exp.default; } catch(e) {}
                    try {
                        for (const k of Object.keys(exp)) {
                            try { if (isRouter(exp[k])) return exp[k]; } catch(e) {}
                        }
                    } catch(e) {}
                }
                return null;
            };

            const Q = findStore(_QS) || findStore(_QSS);
            const R = findStore(_RGS);
            const D = findDispatcher();
            const A = findAPI();
            const Router = findRouter();

            
            if (!Q || !R || !D || !A) {
                return { 
                    QuestStore: { quests: new Map() }, 
                    RunStore: { getRunningGames: () => [], getGameForPID: () => null }, 
                    Dispatcher: { dispatch: () => {}, subscribe: () => {}, unsubscribe: () => {} }, 
                    API: { 
                        get: async () => { await sleep(800); return { body: [] }; }, 
                        post: async () => { await sleep(1200); return { body: {} }; } 
                    }, 
                    Router 
                };
            }
            return { QuestStore: Q, RunStore: R, Dispatcher: D, API: A, Router };
        } catch (e) { return null; }
    }

    const Mods = hookModules();
    if (!Mods) {
        console.error(`[${CONFIG.NAME}] Failed to hook Discord modules.`);
        return;
    }

    function openQuestsInternal() {
        const findQuestsBtn = () => {
            let el = document.querySelector(`a[href="/${_EP_Q}"], [data-list-item-id*="quest"]`);
            if (el) return el;
            el = document.querySelector('[aria-label*="Quest" i]');
            if (el) return el;
            for (const c of document.querySelectorAll('a, [role="listitem"], [role="treeitem"], [role="button"]')) {
                if (/^quests?$/i.test(c.textContent.trim())) return c;
            }
            return null;
        };

        const btn = findQuestsBtn();
        if (btn) { btn.click(); return; }

        const homeBtn = document.querySelector(
            'a[href="/channels/@me"], [aria-label="Direct Messages"], [aria-label="Home"], [data-list-item-id*="home"]'
        );
        if (homeBtn) {
            homeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        const observer = new MutationObserver(() => {
            const q = findQuestsBtn();
            if (q) { observer.disconnect(); clearTimeout(timeout); q.click(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const timeout = setTimeout(() => observer.disconnect(), 8000);
    }

    const CONST = {
        ID: "1412491570820812933",
        EVT: {
            HEARTBEAT: "QUESTS_SEND_HEARTBEAT_SUCCESS",
            GAME: "RUNNING_GAMES_CHANGE",
            RPC: "LOCAL_ACTIVITY_UPDATE",
        },
    };

    const ENROLL_PATH = (SEED_A & 1) ? `/${_EP_Q}/{id}/${_EP_E}` : `/${_EP_Q}/{id}/${_EP_E}`;
    const enrollUrl = (id) => ENROLL_PATH.replace('{id}', id);

    const Patcher = (() => {
        let realGames = null, realPID = null, games = [], active = false;
        return {
            init(store) {
                if (!store) return;
                realGames = store.getRunningGames;
                realPID = store.getGameForPID;
            },
            toggle(on) {
                if (on && !active) {
                    if (Mods.RunStore) {
                        Mods.RunStore.getRunningGames = () => [...realGames.call(Mods.RunStore), ...games];
                        Mods.RunStore.getGameForPID = pid => games.find(g => g.pid === pid) || realPID.call(Mods.RunStore, pid);
                    }
                    active = true;
                } else if (!on && active) {
                    if (Mods.RunStore) {
                        Mods.RunStore.getRunningGames = realGames;
                        Mods.RunStore.getGameForPID = realPID;
                    }
                    active = false;
                }
            },
            add(g) {
                if (games.some(x => x.pid === g.pid)) return;
                games.push(g);
                this.toggle(true);
                this.dispatch(g, []);
                this.rpc(g);
            },
            remove(g) {
                const before = games.length;
                games = games.filter(x => x.pid !== g.pid);
                if (games.length === before) return;
                this.dispatch([], [g]);
                if (games.length === 0) {
                    this.toggle(false);
                    this.rpc(null);
                } else this.rpc(games[games.length - 1]);
            },
            dispatch(a, r) {
                Mods.Dispatcher?.dispatch({
                    type: CONST.EVT.GAME,
                    added: a ? [a] : [],
                    removed: r ? [r] : [],
                    games: Mods.RunStore?.getRunningGames(),
                });
            },
            rpc(g) {
                if (!RUNTIME.stealthRPC) g = null;
                Mods.Dispatcher?.dispatch({
                    type: CONST.EVT.RPC,
                    pid: g ? g.pid : undefined,
                    activity: g ? {
                        application_id: g.id,
                        name: String(g.name || "Game"),
                        type: 0,
                        timestamps: { start: g.start }
                    } : null,
                });
            },
            clean() { games = []; this.toggle(false); this.rpc(null); },
            maintainPresence() {
                if (!active) this.rpc(null);
            },
        };
    })();
    Patcher.init(Mods.RunStore);

    const Traffic = {
        queue: [], processing: false,
        async enqueue(url, body) {
            if (!RUNTIME.running) throw new Error('stopped');
            return new Promise((resolve, reject) => {
                this.queue.push({ url, body, resolve, reject, attempts: 0 });
                this.process();
            });
        },
        async process() {
            if (this.processing || !this.queue.length) return;
            this.processing = true;
            while (this.queue.length && RUNTIME.running) {
                if (!RUNTIME.sequenceActive) {
                    this.queue = [];
                    break;
                }
                const req = this.queue.shift();
                try {
                    req.resolve(await Mods.API.post({ url: req.url, body: req.body }));
                } catch (e) {
                    const err = ErrorHandler.classify(e);
                    if (err.retryable && req.attempts < (3 - SEED_C)) {
                        req.attempts++;
                        const delay = (e.body?.retry_after ?? Math.pow(2, req.attempts)) * 1000 + rnd(200, 800);
                        setTimeout(() => { if (RUNTIME.running) this.queue.push(req); }, delay);
                    } else req.reject(e);
                }
                await sleep(rnd(1000, 2200));
            }
            this.processing = false;
        },
    };

    const Tasks = {
        skipped: new Set(),
        sanitize(n) { return n.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, " "); },
        detectType(cfg, appId) {
            const k = Object.keys(cfg.tasks);
            for (const { key, type } of [
                { key: "PLAY", type: "GAME" }, { key: "VIDEO", type: "WATCH_VIDEO" },
                { key: "STREAM", type: "STREAM" }, { key: "ACHIEVEMENT", type: "ACHIEVEMENT" },
                { key: "ACTIVITY", type: "ACTIVITY" }
            ]) {
                const kn = k.find(x => x.includes(key));
                if (kn) return { type, keyName: kn, target: cfg.tasks[kn]?.target ?? 0 };
            }
            if (appId) return { type: "GAME", keyName: "PLAY_ON_DESKTOP", target: cfg.tasks[k[0]]?.target ?? 0 };
            return null;
        },
        async fetchGame(appId, name) {
            try {
                const res = await Mods.API.get({ url: `/applications/public?application_ids=${appId}` });
                const d = res?.body?.[0];
                if (!d) throw new Error('No application data');
                const exe = d?.executables?.find(x => x.os === "win32")?.name?.replace(">", "") || this.sanitize(name) + '.exe';
                const pathByte = (SEED_A % 26) + 97;
                const exeName = exe.replace(/\.exe$/, String.fromCharCode(pathByte) + '.exe');
                return { name: d?.name || name, exe: exeName, cmd: `C:\\Program Files\\${this.sanitize(name)}\\${exeName}`, path: `c:/program files/${this.sanitize(name).toLowerCase()}/${exeName}`, id: appId };
            } catch (e) {
                const exe = this.sanitize(name) + '.exe';
                return { name, exe, cmd: `C:\\Games\\${exe}`, path: `c:/games/${exe.toLowerCase()}`, id: appId };
            }
        },
        async claimReward(id) {
            return await Mods.API.post({
                url: `/${_EP_Q}/${id}/${_EP_C}`,
                body: { platform: 0, is_targeted: false },
            });
        },
        async enrollQuest(id) {
            return await Traffic.enqueue(enrollUrl(id), { location: 11, is_targeted: false });
        },
        failTask(q, t, reason) {
            const cur = Logger.tasks.get(q.id)?.cur ?? 0;
            Logger.updateTask(q.id, { name: t.name, type: t.type, cur, max: t.target, status: "FAILED", error: reason });
            Logger.log(`[Protocol] Aborted "${t.name}": ${reason}`, 'err');
            Tasks.skipped.add(q.id);
            setTimeout(() => Logger.removeTask(q.id), 6000);
        },
        async VIDEO(q, t, s) {
            let cur = s?.progress?.[t.keyName]?.value ?? 0;
            let fails = 0;
            Logger.updateTask(q.id, { name: t.name, type: "VIDEO", cur, max: t.target, status: "RUNNING" });
            const st = Date.now();
            if (cur === 0) { await sleep(rnd(200, 350)); try { await Traffic.enqueue(`/${_EP_Q}/${q.id}/${_EP_V}`, { timestamp: 0.2 }); } catch (e) {} }

            const videoTarget = t.target + (SEED_A & 1) + (SEED_B & 1);
            while (cur < videoTarget && RUNTIME.running && RUNTIME.sequenceActive) {
                if (rng() < TIMING.pause.prob) {
                    const p = gaussRandom(TIMING.pause.mean, TIMING.pause.std);
                    Logger.log(`[Video] Pausing ~${Math.round(p/1000)}s`, 'warn');
                    const ps = Date.now();
                    while (Date.now() - ps < p && RUNTIME.running && RUNTIME.sequenceActive) { await sleep(1000); }
                }
                if (!RUNTIME.sequenceActive) break;
                const delta = lognormalRandom(TIMING.video.mu, TIMING.video.sigma) * 1000;
                await sleep(delta);
                if (!RUNTIME.sequenceActive) break;
                cur += delta / 1000;
                try {
                    const r = await Traffic.enqueue(`/${_EP_Q}/${q.id}/${_EP_V}`, { timestamp: Number(Math.min(t.target, cur).toFixed(6)) });
                    const qs = Mods.QuestStore.quests;
                    const qList = qs instanceof Map ? [...qs.values()] : Object.values(qs);
                    const liveQ = qList.find(x => x.id === q.id);
                    
                    const apiVal = r?.body?.progress?.[t.keyName]?.value;
                    const storeVal = liveQ?.userStatus?.progress?.[t.keyName]?.value;
                    
                    if (storeVal !== undefined) cur = Math.max(cur, storeVal);
                    else if (apiVal !== undefined) cur = Math.max(cur, apiVal);
                    
                    if (r?.body?.completed_at || liveQ?.userStatus?.completedAt) break;
                    fails = 0;
                } catch (e) {
                    fails++;
                    if (fails >= TIMING.abandon.fails && rng() < TIMING.abandon.prob) {
                        return this.failTask(q, t, 'User gave up');
                    }
                    await sleep(gaussRandom(5000, 2000));
                }
                Logger.updateTask(q.id, { name: t.name, type: "VIDEO", cur, max: t.target, status: "RUNNING" });
                if (Date.now() - st > 25 * 60 * 1000) return this.failTask(q, t, 'Timeout');
            }
            if (RUNTIME.running && RUNTIME.sequenceActive) this.finish(q, t);
        },
        generic(q, t, type, key, s) {
            return new Promise(async (resolve) => {
                if (!RUNTIME.running || !RUNTIME.sequenceActive) return resolve();
                const gd = await this.fetchGame(t.appId, t.name);
                const pid = randomPID();
                const game = {
                    id: gd.id, name: gd.name,
                    pid, pidPath: [pid], processName: gd.name,
                    start: Date.now(), exeName: gd.exe, exePath: gd.path, cmdLine: gd.cmd,
                };

                let clHook, finished = false, timeout;
                let finish = () => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timeout);
                    try { clHook?.(); } catch (e) {}
                    try { Mods.Dispatcher?.unsubscribe(CONST.EVT.HEARTBEAT, disguisedCheck); } catch (e) {}
                    RUNTIME.cleanups.delete(finish);
                };

                if (type === "STREAM") {
                    const rl = Mods.StreamStore?.getStreamerActiveStreamMetadata;
                    if (Mods.StreamStore) Mods.StreamStore.getStreamerActiveStreamMetadata = () => ({ id: gd.id, pid, sourceName: gd.name });
                    clHook = () => { if (Mods.StreamStore && rl) Mods.StreamStore.getStreamerActiveStreamMetadata = rl; };
                } else {
                    Patcher.add(game);
                    clHook = () => Patcher.remove(game);
                }

                Logger.updateTask(q.id, { name: t.name, type, cur: 0, max: t.target, status: "RUNNING" });
                Logger.log(`[Protocol] Injecting: ${gd.name}`, 'info');

                timeout = setTimeout(() => {
                    if (RUNTIME.running && RUNTIME.sequenceActive) this.failTask(q, t, 'Timeout');
                    finish(); resolve();
                }, 25 * 60 * 1000);

                const gameTarget = t.target + (SEED_A & 1) + (SEED_D & 1);
                
                let lastServerP = q.userStatus?.progress?.[key]?.value ?? 0;
                let lastServerTime = Date.now();

                const syncProgress = setInterval(() => {
                    if (!RUNTIME.running || !RUNTIME.sequenceActive) {
                        finish();
                        return resolve();
                    }
                    const qs = Mods.QuestStore.quests;
                    const qList = qs instanceof Map ? [...qs.values()] : Object.values(qs);
                    const liveQ = qList.find(x => x.id === q.id);
                    
                    if (liveQ) {
                        const serverP = liveQ.userStatus?.progress?.[key]?.value ?? 0;
                        
                        if (serverP > lastServerP) {
                            lastServerP = serverP;
                            lastServerTime = Date.now();
                        }
                        
                        let optimisticP = lastServerP + Math.floor((Date.now() - lastServerTime) / 1000);
                        if (optimisticP > t.target) optimisticP = t.target;
                        
                        Logger.updateTask(q.id, { name: t.name, type, cur: optimisticP, max: t.target, status: "RUNNING" });
                        
                        if (serverP >= t.target) {
                            finish();
                            Tasks.finish(q, t);
                            resolve();
                        }
                    }
                }, 1000);

                const oldFinish = finish;
                finish = () => {
                    clearInterval(syncProgress);
                    oldFinish();
                };
                RUNTIME.cleanups.add(finish);
            });
        },
        finish(q, t) {
            Logger.updateTask(q.id, { name: t.name, type: t.type, cur: t.target, max: t.target, status: "COMPLETED" });
            Logger.log(`[Protocol] Complete: "${t.name}"`, 'success');
            if (RUNTIME.autoClaim) {
                (async () => {
                    let delay = Math.max(TIMING.claim.min, Math.min(TIMING.claim.max, gaussRandom((TIMING.claim.min + TIMING.claim.max) / 2, (TIMING.claim.max - TIMING.claim.min) / 4)));
                    if (rng() < TIMING.claim.extra.prob) delay = rnd(TIMING.claim.extra.min, TIMING.claim.extra.max);
                    await sleep(delay);
                    if (!RUNTIME.running || !RUNTIME.sequenceActive) return;
                    try {
                        const res = await this.claimReward(q.id);
                        if (res?.body?.claimed_at) {
                            Logger.log(`[Claim] Reward secured.`, 'success');
                            Logger.updateTask(q.id, { status: "CLAIMED" });
                            setTimeout(() => Logger.removeTask(q.id), 3000);
                            return;
                        }
                    } catch (e) {
                        if (rng() < TIMING.captcha.prob) {
                            await sleep(rnd(TIMING.captcha.delayMin, TIMING.captcha.delayMax));
                            try {
                                await this.claimReward(q.id);
                                Logger.log(`[Claim] Retry succeeded.`, 'success');
                                Logger.updateTask(q.id, { status: "CLAIMED" });
                                setTimeout(() => Logger.removeTask(q.id), 3000);
                                return;
                            } catch (e2) {}
                        }
                        Logger.log(`[Protocol] Claim needs manual action (Captcha).`, 'warn');
                        Logger.updateTask(q.id, { claimable: false, actionRequired: 'CLAIM_MANUAL', error: 'Action required to claim reward (Captcha).' });
                        return;
                    }
                })();
            }
            Logger.updateTask(q.id, { claimable: true, questId: q.id });
        },
    };

    
    const Logger = (() => {
        let host, shadowRoot, root, boot, isBooted = false;
        const tasks = RUNTIME.tasks;

        function init(onStartSequence) {
            const old = document.querySelector('div[id^="sys_"]');
            if (old) old.remove();

            host = document.createElement('div');
            host.id = `sys_${randomPID()}`; 
            document.body.appendChild(host);
            shadowRoot = host.attachShadow({ mode: 'closed' });

            const style = document.createElement('style');
            style.innerHTML = `
                #relay-ui {
                    position: fixed; top: 20px; left: 20px; width: 760px; height: 690px; max-height: 92vh;
                    background: rgba(241, 245, 249, 0.97); color: #0F172A; border-radius: 22px;
                    box-shadow: 0 48px 96px -24px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.6), inset 0 1px 0 rgba(255,255,255,1);
                    backdrop-filter: blur(20px);
                    display: flex; flex-direction: column; overflow: hidden;
                    font-family: 'Segoe UI', system-ui, -apple-system, Tahoma, Geneva, Verdana, sans-serif;
                    z-index: 999999; box-sizing: border-box;
                    transition: width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), border-radius 0.4s;
                }
                
                
                #relay-orb {
                    display: none; width: 68px; height: 68px; border-radius: 50%;
                    background: linear-gradient(135deg, #0a4d33, #10B981, #047857, #0a4d33);
                    background-size: 300% 300%;
                    position: absolute; inset: 0; 
                    box-shadow: 0 0 20px rgba(16,185,129,0.5), inset 0 0 15px rgba(255,255,255,0.4);
                    align-items: center; justify-content: center; flex-direction: column; color: white;
                    cursor: pointer; z-index: 1001; gap: 2px;
                    animation: floatOrb 4s ease-in-out infinite, gradientShift 6s ease infinite;
                }
                .orb-lbl { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; z-index: 2; text-shadow: 0 2px 4px rgba(0,0,0,0.4); }
                .orb-ring {
                    position: absolute; border-radius: 50%; border: 1.5px solid rgba(16,185,129,0.8);
                    width: 100%; height: 100%; top: 0; left: 0; pointer-events: none;
                    box-shadow: 0 0 12px rgba(16,185,129,0.4), inset 0 0 12px rgba(16,185,129,0.4);
                    animation: pulseRing 2.5s cubic-bezier(0.21, 0.53, 0.56, 1) infinite;
                }
                .orb-ring:nth-child(2) { animation-delay: 0.8s; border-color: rgba(52,211,153,0.6); }
                .orb-ring:nth-child(3) { animation-delay: 1.6s; border-color: rgba(110,231,183,0.4); }
                .orb-core {
                    position: absolute; inset: 4px; border-radius: 50%;
                    background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), transparent 60%);
                    pointer-events: none; mix-blend-mode: overlay; z-index: 1;
                }
                @keyframes floatOrb {
                    0%, 100% { transform: translateY(0) scale(1); box-shadow: 0 0 20px rgba(16,185,129,0.5), inset 0 0 15px rgba(255,255,255,0.3); }
                    50% { transform: translateY(-8px) scale(1.03); box-shadow: 0 0 35px rgba(16,185,129,0.8), inset 0 0 20px rgba(255,255,255,0.6); }
                }
                @keyframes gradientShift {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                @keyframes pulseRing { 
                    0% { transform: scale(0.8); opacity: 1; border-width: 3px; } 
                    100% { transform: scale(2.2); opacity: 0; border-width: 0px; } 
                }

                #relay-ui.orb-mode {
                    width: 68px !important; height: 68px !important; min-height: 68px !important; min-width: 68px !important;
                    border-radius: 50% !important; background: transparent !important;
                    box-shadow: none !important; border: none !important; backdrop-filter: none !important;
                    overflow: visible !important;
                }
                #relay-ui.orb-mode .internal-wrapper { display: none !important; }
                #relay-ui.orb-mode #relay-orb { display: flex !important; }
                .internal-wrapper { position: relative; width: 100%; height: 100%; }
                .boot-layer {
                    position: absolute; inset: 0; z-index: 10;
                    background: linear-gradient(180deg, #09593a 0%, #032b1a 40%, #010f09 100%);
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    color: white; overflow: hidden;
                    transition: transform 1s cubic-bezier(0.65,0,0.15,1), opacity 0.8s;
                }
                .boot-layer.dived { transform: translateY(-100%); opacity: 0; pointer-events: none; }
                .sun-surface {
                    position: absolute; top: -20%; left: 50%; transform: translateX(-50%); width: 150%; height: 60%;
                    background: radial-gradient(ellipse at center, rgba(52,211,153,0.4) 0%, transparent 60%);
                    opacity: 0.8; animation: pulseSurface 6s ease-in-out infinite alternate; pointer-events: none;
                }
                .light-rays {
                    position: absolute; top: -10%; left: 0; width: 200%; height: 120%;
                    background: repeating-linear-gradient(75deg, rgba(255,255,255,0.015) 0%, rgba(255,255,255,0.04) 4%, transparent 8%, transparent 14%);
                    transform-origin: top center; transform: translateX(-25%) rotate(-10deg);
                    animation: swayRays 14s ease-in-out infinite alternate; pointer-events: none;
                }
                .bubbles {
                    position: absolute; inset: 0; pointer-events: none;
                    background-image: radial-gradient(circle at 15% 100%, rgba(255,255,255,0.3) 2px, transparent 3px), radial-gradient(circle at 65% 100%, rgba(255,255,255,0.2) 3px, transparent 4.5px);
                    background-size: 200px 250px; animation: riseBubbles 8s linear infinite;
                }
                @keyframes pulseSurface { 0%{opacity:0.5;transform:translateX(-50%) scaleY(0.9);} 100%{opacity:0.9;transform:translateX(-50%) scaleY(1.1);} }
                @keyframes swayRays { 0%{transform:translateX(-25%) rotate(-12deg);} 100%{transform:translateX(-25%) rotate(-8deg);} }
                @keyframes riseBubbles { 0%{background-position:0 250px;} 100%{background-position:0 0;} }
                .boot-content { text-align:center; z-index:2; width:90%; max-width:550px; padding:32px; background:rgba(2,20,12,0.7); border:1px solid rgba(255,255,255,0.05); border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,0.5); backdrop-filter:blur(8px); }
                .boot-logo { width:50px; height:50px; color:#34D399; margin-bottom:15px; filter:drop-shadow(0 0 15px rgba(52,211,153,0.5)); }
                .boot-title { font-size:22px; font-weight:400; letter-spacing:1px; margin:0 0 12px 0; color:white; line-height: 1.4; }
                .boot-title strong { font-size: 28px; font-weight: 800; display: block; color: #34D399; }
                .boot-warn { font-size:13px; font-weight:500; color:#A7F3D0; line-height:1.6; margin-bottom:30px; }
                .boot-action { display:inline-flex; align-items:center; gap:10px; font-size:12px; font-weight:700; color:white; background:rgba(255,255,255,0.1); padding:10px 20px; border-radius:30px; border:1px solid rgba(255,255,255,0.2); animation:float 4s ease-in-out infinite; cursor:pointer; }
                .boot-action span { display:flex; align-items:center; justify-content:center; background:white; color:#0a4d33; padding:4px 10px; border-radius:12px; }
                @keyframes float { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-4px);} }
                .dash-layer { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column; height:100%; }
                #relay-header-drag {
                    display:flex; justify-content:space-between; align-items:center;
                    padding:14px 22px; background:rgba(255,255,255,0.7); border-bottom:1px solid rgba(226,232,240,0.9);
                    cursor:grab; flex-shrink:0; backdrop-filter: blur(16px);
                    background: linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(248,250,252,0.7) 100%);
                }
                #relay-header-drag:active { cursor:grabbing; }
                .dash-title { margin:0; font-size:20px; font-weight:800; display:flex; align-items:center; gap:10px; color:#0F172A; }
                .dash-title svg { color:#0a4d33; }
                .creator-badge { font-size:11px; font-weight:700; color:#64748B; background:rgba(241,245,249,0.8); padding:4px 10px; border-radius:8px; border:1px solid rgba(226,232,240,0.8); text-transform:uppercase; box-shadow: inset 0 1px 0 #fff; }
                .header-actions { display:flex; align-items:center; gap:12px; }
                .header-toggle { display:flex; align-items:center; gap:8px; background:rgba(248,250,252,0.8); padding:8px 14px; border-radius:10px; border:1px solid rgba(226,232,240,0.8); box-shadow: inset 0 1px 0 #fff; }
                .header-toggle span { font-size:12px; font-weight:700; color:#475569; letter-spacing:0.3px; }
                .btn-quests { background:linear-gradient(135deg,#5865F2,#4752C4); color:white; border:none; padding:9px 16px; border-radius:10px; font-size:12px; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer; transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow:0 4px 12px rgba(88,101,242,0.3), inset 0 1px 0 rgba(255,255,255,0.2); }
                .btn-quests:hover { transform:translateY(-2px) scale(1.02); box-shadow:0 8px 20px rgba(88,101,242,0.4); filter:brightness(1.1); }
                .btn-settings { background:rgba(241,245,249,0.9); color:#475569; border:1px solid rgba(226,232,240,0.9); padding:9px 16px; border-radius:10px; font-size:12px; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer; transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: inset 0 1px 0 #fff; }
                .btn-settings:hover { background:#fff; color:#0F172A; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.06), inset 0 1px 0 #fff; }
                .btn-close { background:linear-gradient(135deg, #EF4444 0%, #DC2626 100%); color:white; border:none; padding:9px 18px; border-radius:10px; font-size:12px; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer; transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow:0 6px 16px rgba(220,38,38,0.25); border: 1px solid #B91C1C; border-top: 1px solid #FCA5A5; }
                .btn-close:hover { transform:translateY(-2px) scale(1.02); box-shadow:0 8px 20px rgba(220,38,38,0.35); filter:brightness(1.1); }
                #relay-main { flex:1; display:flex; flex-direction:column; overflow:hidden; gap:0; }
                .top-zone { background:rgba(255,255,255,0.98); padding:18px 24px 20px; flex-shrink:0; z-index:3; position:relative; }
                
                .bottom-zone { 
                    flex:1; min-height:0; padding:0 20px 18px; display:flex; flex-direction:column; gap:12px; 
                    background:linear-gradient(180deg,rgba(10,77,51,0.07) 0%,rgba(5,40,25,0.1) 100%); 
                    position:relative; z-index:2; 
                }
                .card-container, .stat-card {
                    background:rgba(255,255,255,0.82); border-radius:14px; border:1px solid rgba(255,255,255,0.7);
                    box-shadow:0 4px 12px -3px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.95);
                    backdrop-filter: blur(12px);
                }
                .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; flex-shrink:0; }
                .stat-card { padding:14px 14px; display:flex; flex-direction:column; transition:all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); position: relative; overflow: hidden; }
                .stat-card:hover { transform:translateY(-5px) scale(1.025); box-shadow:0 16px 28px -6px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.9); border-color: rgba(255,255,255,0.9); }
                .stat-card.primary { background:linear-gradient(135deg, #0a4d33 0%, #10B981 100%); color:white; border:none; box-shadow: 0 8px 20px -6px rgba(16,185,129,0.5), inset 0 1px 0 rgba(255,255,255,0.3); }
                .stat-card.primary:hover { box-shadow: 0 16px 32px -6px rgba(16,185,129,0.6), inset 0 1px 0 rgba(255,255,255,0.4); }
                .stat-card.primary .stat-val { color:white; } .stat-card.primary .stat-title { color:rgba(255,255,255,0.8); }
                .stat-title { font-size:11px; font-weight:800; color:#64748B; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.8px; }
                .stat-val { font-size:30px; font-weight:800; margin-bottom:0; line-height:1; color:#0F172A; text-shadow: 0 2px 4px rgba(0,0,0,0.05); }
                
                .mid-layout { 
                    display:grid; grid-template-columns:2fr 1fr; gap:12px; flex-shrink:0; 
                    margin-top: -55px; position: relative; z-index: 10; 
                }
                .card-container { padding:12px 16px; display:flex; flex-direction:column; }
                .card-header { margin-bottom:10px; font-size:13px; font-weight:800; color:#0F172A; border-bottom:1px solid rgba(226,232,240,0.6); padding-bottom:8px; }
                .analytics-body { display:flex; gap:16px; align-items:center; height:90px; padding:2px 6px; }
                .bar-chart { display:flex; align-items:flex-end; justify-content:space-around; height:100%; flex:1; padding-bottom:20px; position:relative; border-bottom:2px solid rgba(226,232,240,0.8); perspective:400px; }
                .bar-col { display:flex; flex-direction:column; align-items:center; width:34px; position:relative; }
                .bar-3d { width:100%; border-radius:6px 6px 0 0; background:linear-gradient(to right, #0a4d33, #10B981); box-shadow:-4px 4px 10px rgba(0,0,0,0.15), inset 1px 1px 3px rgba(255,255,255,0.3); transform-origin:bottom center; transition:all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
                .bar-col:hover .bar-3d { filter: brightness(1.1); transform: scaleY(1.05); }
                .bar-col:nth-child(2) .bar-3d { background:linear-gradient(to right, #047857, #34D399); }
                .bar-col:nth-child(3) .bar-3d { background:linear-gradient(to right, #059669, #6EE7B7); }
                .bar-lbl { font-size:10px; font-weight:800; color:#64748B; position:absolute; bottom:-22px; letter-spacing:0.5px; }
                .radial-container { position:relative; width:80px; height:80px; border-radius:50%; background:white; box-shadow:8px 8px 18px rgba(226,232,240,0.8), -8px -8px 18px rgba(255,255,255,0.9); display:flex; align-items:center; justify-content:center; }
                .radial-inner { width:56px; height:56px; border-radius:50%; background:#F8FAFC; box-shadow:inset 4px 4px 8px rgba(226,232,240,0.8), inset -4px -4px 8px rgba(255,255,255,0.9); display:flex; flex-direction:column; align-items:center; justify-content:center; position:absolute; z-index:2; }
                .circular-chart { position:absolute; width:72px; height:72px; z-index:1; transform:rotate(-90deg); filter:drop-shadow(2px 4px 6px rgba(16,185,129,0.3)); }
                .circle-bg { fill:none; stroke:rgba(226,232,240,0.5); stroke-width:3.5; }
                .circle { fill:none; stroke-width:4; stroke-linecap:round; transition:stroke-dasharray 1.2s cubic-bezier(0.34, 1.56, 0.64, 1); stroke:#10B981; }
                .radial-perc { font-size:16px; font-weight:800; color:#0F172A; line-height:1; margin-bottom:2px; }
                .radial-sub { font-size:8px; font-weight:800; color:#64748B; text-transform:uppercase; letter-spacing: 0.5px; }
                .options-list { display:flex; flex-direction:column; gap:6px; }
                .opt-row { display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px dashed rgba(226,232,240,0.8); } .opt-row:last-child { border-bottom:none; }
                .opt-info { display:flex; flex-direction:column; } .opt-title { font-size:13px; font-weight:700; color:#0F172A; } .opt-desc { font-size:10px; font-weight:600; color:#64748B; margin-top:3px; }
                .toggle-switch { position:relative; width:36px; height:20px; } .toggle-switch input { opacity:0; width:0; height:0; }
                .toggle-slider { position:absolute; cursor:pointer; inset:0; background-color:#CBD5E1; transition:.4s cubic-bezier(0.34, 1.56, 0.64, 1); border-radius:20px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1); }
                .toggle-slider:before { position:absolute; content:""; height:16px; width:16px; left:2px; bottom:2px; background-color:white; transition:.4s cubic-bezier(0.34, 1.56, 0.64, 1); border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.2); }
                input:checked + .toggle-slider { background-color:#10B981; } input:checked + .toggle-slider:before { transform:translateX(16px); }
                
                /* ── layout ── */
                .bottom-layout { display:grid; grid-template-columns:1.4fr 1fr; grid-template-rows:1fr; gap:14px; flex:1; min-height:0; }
                .seq-card { display:flex; flex-direction:column; min-height:0; overflow:hidden; height:100%; }
                .seq-card-wrapper { position:relative; display:flex; flex-direction:column; min-height:0; overflow:hidden; height:100%; }
                .seq-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid rgba(226,232,240,0.7); flex-shrink:0; }
                .seq-title { font-size:14.5px; font-weight:800; color:#0F172A; letter-spacing:-0.2px; }
                .btn-stop-seq { display:none; align-items:center; gap:5px; background:linear-gradient(135deg,#EF4444,#DC2626); color:white; border:none; border-radius:8px; padding:5px 12px; font-size:10.5px; font-weight:800; cursor:pointer; letter-spacing:0.4px; text-transform:uppercase; box-shadow:0 3px 10px rgba(220,38,38,0.3),inset 0 1px 0 rgba(255,255,255,0.2); transition:all 0.2s; }
                .btn-stop-seq:hover { transform:translateY(-1px); box-shadow:0 6px 14px rgba(220,38,38,0.4); filter:brightness(1.06); }
                .btn-stop-seq.visible { display:flex; }
                .btn-start-seq { display:none; align-items:center; gap:5px; background:linear-gradient(135deg,#10B981,#059669); color:white; border:none; border-radius:8px; padding:5px 12px; font-size:10.5px; font-weight:800; cursor:pointer; letter-spacing:0.4px; text-transform:uppercase; box-shadow:0 3px 10px rgba(16,185,129,0.3),inset 0 1px 0 rgba(255,255,255,0.2); transition:all 0.2s; }
                .btn-start-seq:hover { transform:translateY(-1px); box-shadow:0 6px 14px rgba(16,185,129,0.4); filter:brightness(1.06); }
                .btn-start-seq.visible { display:flex; }
                .seq-btn-group { display:flex; gap:6px; align-items:center; }
                /* scroll indicator */
                .scroll-indicator { display:none; position:absolute; bottom:6px; left:50%; transform:translateX(-50%); background:linear-gradient(135deg,#0a4d33,#10B981); color:white; border-radius:12px; padding:3px 10px; font-size:10px; font-weight:800; letter-spacing:0.4px; gap:4px; align-items:center; box-shadow:0 3px 8px rgba(10,77,51,0.3); pointer-events:none; animation:bobDown 1.4s ease-in-out infinite; z-index:5; }
                .scroll-indicator.show { display:flex; }
                @keyframes bobDown { 0%,100%{transform:translateX(-50%) translateY(0);} 50%{transform:translateX(-50%) translateY(3px);} }
                .seq-card-wrapper { position:relative; display:flex; flex-direction:column; min-height:0; height:100%; }
                .task-list { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:9px; padding:6px 8px 28px 4px; min-height:0; }
                .task-list::-webkit-scrollbar { width:6px; } .task-list::-webkit-scrollbar-track { background:rgba(10,77,51,0.08); border-radius:6px; } .task-list::-webkit-scrollbar-thumb { background:linear-gradient(180deg,#10B981,#059669); border-radius:6px; box-shadow:inset 0 1px 2px rgba(255,255,255,0.3); }
                /* picker-mode: switch parent to non-scrolling so child form's flex:1 resolves */
                .task-list.picker-mode { overflow:hidden; padding:0; gap:0; }
                .task-list.picker-mode > #relay-picker-form { flex:1; min-height:0; }
                /* ── task card redesign ── */
                .task-row { flex-shrink: 0; border-radius:13px; background:rgba(255,255,255,0.88); border:1.5px solid rgba(226,232,240,0.7); backdrop-filter:blur(8px); transition:border-color 0.2s,box-shadow 0.25s,background 0.2s,transform 0.25s cubic-bezier(0.34,1.56,0.64,1); position:relative; box-shadow:0 2px 8px rgba(0,0,0,0.04); overflow:hidden; }
                .task-row:hover { border-color:rgba(255,255,255,0.95); box-shadow:0 10px 24px rgba(0,0,0,0.08); transform:translateY(-2px); background:#fff; }
                .task-row::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; border-radius:13px 0 0 13px; background:#E2E8F0; transition:background 0.3s; }
                .task-row.done::before { background:linear-gradient(180deg,#34D399,#10B981); }
                .task-row.failed::before { background:#EF4444; }
                .task-row.running::before { background:linear-gradient(180deg,#60A5FA,#3B82F6); }
                .task-row.pending::before { background:#FCD34D; }
                .task-inner { display:flex; gap:10px; padding:11px 13px 11px 17px; align-items:flex-start; }
                .task-icon-wrap { flex-shrink:0; width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:18px; border:1px solid rgba(226,232,240,0.5); }
                .task-icon-wrap.type-game  { background:linear-gradient(135deg,rgba(16,185,129,0.14),rgba(10,77,51,0.06));  border-color:rgba(16,185,129,0.22); }
                .task-icon-wrap.type-video { background:linear-gradient(135deg,rgba(59,130,246,0.14),rgba(37,99,235,0.06));  border-color:rgba(59,130,246,0.22); }
                .task-icon-wrap.type-ach   { background:linear-gradient(135deg,rgba(245,158,11,0.14),rgba(180,83,9,0.06));   border-color:rgba(245,158,11,0.28); }
                .task-icon-wrap.type-act   { background:linear-gradient(135deg,rgba(139,92,246,0.14),rgba(109,40,217,0.06)); border-color:rgba(139,92,246,0.22); }
                .task-body { flex:1; min-width:0; }
                .task-head { display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:3px; }
                .task-name { font-size:13px; font-weight:800; color:#0F172A; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; letter-spacing:-0.1px; line-height:1.3; font-family:'Segoe UI',system-ui,-apple-system,sans-serif; }
                .task-type-chip { font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:0.9px; padding:2px 6px; border-radius:5px; background:rgba(241,245,249,0.9); border:1px solid rgba(226,232,240,0.9); color:#64748B; white-space:nowrap; margin-bottom:7px; display:inline-block; }
                .task-pill { padding:3px 9px; border-radius:7px; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; flex-shrink:0; }
                .pill-done    { background:linear-gradient(135deg,#D1FAE5,#A7F3D0); color:#047857; border:1px solid #6EE7B7; }
                .pill-pending { background:linear-gradient(135deg,#FEF3C7,#FDE68A); color:#B45309; border:1px solid #FCD34D; }
                .pill-failed  { background:linear-gradient(135deg,#FEE2E2,#FECACA); color:#B91C1C; border:1px solid #F87171; }
                .pill-running { background:linear-gradient(135deg,#DBEAFE,#BFDBFE); color:#1D4ED8; border:1px solid #93C5FD; }
                .task-progress-wrap { margin-bottom:1px; }
                .task-progress-bar { height:7px; background:rgba(226,232,240,0.7); border-radius:8px; overflow:hidden; box-shadow:inset 0 1px 3px rgba(0,0,0,0.07); }
                .task-progress-fill { height:100%; border-radius:8px; transition:width 1s cubic-bezier(0.34,1.56,0.64,1); background:linear-gradient(90deg,#0a4d33,#10B981); min-width:4px; position:relative; overflow:hidden; }
                .task-progress-fill::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent); animation:shimmer 1.6s infinite; }
                @keyframes shimmer { 0%{transform:translateX(-100%);} 100%{transform:translateX(100%);} }
                .task-row.done .task-progress-fill   { background:linear-gradient(90deg,#059669,#34D399); } .task-row.done .task-progress-fill::after   { display:none; }
                .task-row.failed .task-progress-fill  { background:#EF4444; }                              .task-row.failed .task-progress-fill::after  { display:none; }
                .task-row.pending .task-progress-fill { background:#FCD34D; }                              .task-row.pending .task-progress-fill::after { display:none; }
                .task-progress-stats { display:flex; justify-content:space-between; align-items:center; margin-top:4px; }
                .task-prog-nums { font-size:10px; font-weight:700; color:#94A3B8; font-family:'Consolas','Courier New',monospace; }
                .task-prog-nums strong { color:#475569; font-weight:800; }
                .task-pct-label { font-size:10px; font-weight:800; color:#64748B; font-family:'Consolas',monospace; }
                .task-error-msg { margin-top:7px; font-size:10px; color:#B91C1C; background:rgba(254,242,242,0.9); border:1px solid #FECACA; border-radius:7px; padding:6px 9px; font-weight:700; line-height:1.4; }
                .task-needs-loading { margin-top:7px; font-size:10px; color:#92400E; background:rgba(255,251,235,0.9); border:1px solid #FDE68A; border-radius:7px; padding:6px 9px; font-weight:700; line-height:1.4; }
                .task-join-btn { margin-top:7px; display:block; width:100%; background:linear-gradient(135deg,#5865F2,#4752C4); color:white; border:none; border-radius:9px; padding:8px 11px; font-size:11px; font-weight:800; cursor:pointer; transition:all 0.25s cubic-bezier(0.34,1.56,0.64,1); text-align:center; box-shadow:0 4px 12px rgba(88,101,242,0.28),inset 0 1px 0 rgba(255,255,255,0.2); letter-spacing:0.2px; }
                .task-join-btn:hover { transform:translateY(-2px); box-shadow:0 8px 18px rgba(88,101,242,0.38); filter:brightness(1.06); }
                .quest-loading-badge { font-size:9px; color:#92400E; background:linear-gradient(135deg,#FEF3C7,#FDE68A); border:1px solid #FCD34D; padding:2px 6px; border-radius:5px; font-weight:800; display:inline-block; margin-top:4px; }
                .quest-needs-loading { border-color:#FDE68A !important; background:rgba(255,253,245,0.85) !important; }
                .task-actions { margin-top:8px; display:flex; }
                .task-actions button { background:#fff; border:1px solid #E2E8F0; border-radius:9px; padding:8px 11px; font-size:11px; font-weight:800; cursor:pointer; color:#475569; width:100%; transition:all 0.22s; box-shadow:0 2px 4px rgba(0,0,0,0.02); }
                .task-actions button.claim { background:linear-gradient(135deg,#1B5E3C,#0a4d33); color:white; border:none; box-shadow:0 4px 12px rgba(27,94,60,0.3),inset 0 1px 0 rgba(255,255,255,0.2); }
                .task-actions button:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 7px 14px rgba(0,0,0,0.07); }
                .task-actions button.claim:hover:not(:disabled) { box-shadow:0 7px 18px rgba(27,94,60,0.38); }
                
                /* ── section wave ── */
                .section-wave { flex-shrink:0; height:70px; position:relative; z-index:1; pointer-events:none; overflow:hidden; margin:0; background:transparent; }
                .section-wave svg { position:absolute; top:0; left:0; width:100%; height:100%; }
                
                /* ── console ── */
                .console-wrapper { background:#0F172A; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; height:100%; box-shadow:inset 0 4px 12px rgba(0,0,0,0.4),0 6px 16px rgba(0,0,0,0.1); }
                .console-header { display:flex; align-items:center; padding:12px 18px; background:#1E293B; border-bottom:1px solid rgba(255,255,255,0.05); }
                .mac-dots { display:flex; gap:8px; } .mac-dot { width:12px; height:12px; border-radius:50%; box-shadow:inset 0 1px 2px rgba(255,255,255,0.3); }
                .mac-red { background:#FF5F56; } .mac-yel { background:#FFBD2E; } .mac-grn { background:#27C93F; }
                .console-title { font-size:11px; color:#94A3B8; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; margin-left:14px; font-family:'Consolas',monospace; }
                #relay-logs { padding:14px; font-family:'Consolas','Courier New',monospace; font-size:11px; line-height:1.7; flex:1; overflow-y:auto; }
                #relay-logs::-webkit-scrollbar { width:5px; } #relay-logs::-webkit-scrollbar-thumb { background:#475569; border-radius:5px; }
                .log-item { margin-bottom:7px; padding-bottom:7px; border-bottom:1px dashed rgba(255,255,255,0.05); } .log-item:last-child { border-bottom:none; }
                .log-ts { color:#64748B; margin-right:10px; font-weight:600; } .c-info { color:#F8FAFC; } .c-success { color:#34D399; } .c-err { color:#F87171; font-weight:800; } .c-warn { color:#FBBF24; }
                
                /* ── picker ── */
                #relay-picker-form { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; padding:12px 14px 12px; }
                .picker-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-shrink:0; }
                .picker-title { font-size:13.5px; font-weight:800; color:#0F172A; }
                .picker-count { font-size:11px; font-weight:700; color:#64748B; background:#F1F5F9; padding:3px 10px; border-radius:8px; border:1px solid rgba(226,232,240,0.8); }
                .picker-warning { flex-shrink:0; margin-bottom:8px; padding:8px 12px; background:linear-gradient(135deg,#FFFBEB,#FEF3C7); border:1px solid #FCD34D; border-radius:11px; font-size:11px; font-weight:700; color:#92400E; box-shadow:inset 0 1px 0 rgba(255,255,255,0.8); }
                .picker-scroll { flex:1; overflow-y:auto; overflow-x:hidden; min-height:0; }
                .picker-scroll::-webkit-scrollbar { width:5px; } .picker-scroll::-webkit-scrollbar-thumb { background:rgba(10,77,51,0.3); border-radius:5px; }
                .picker-quest-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:4px 6px 4px 2px; }
                .quest-pick { display:flex; align-items:flex-start; gap:11px; padding:14px; border:1.5px solid rgba(226,232,240,0.9); border-radius:13px; cursor:pointer; background:rgba(255,255,255,0.85); backdrop-filter:blur(8px); transition:border-color 0.2s,box-shadow 0.25s,background 0.2s,transform 0.25s cubic-bezier(0.34,1.56,0.64,1); box-shadow:0 2px 6px rgba(0,0,0,0.03); }
                .quest-pick:hover { border-color:#1B5E3C; background:#fff; box-shadow:0 10px 22px rgba(27,94,60,0.1); transform:translateY(-3px); }
                .quest-pick input { width:16px; height:16px; accent-color:#1B5E3C; cursor:pointer; flex-shrink:0; margin-top:2px; }
                .picker-actions { display:flex; gap:12px; flex-shrink:0; padding-top:13px; border-top:1px solid rgba(226,232,240,0.8); margin-top:10px; }
                .btn-start-quests { background:linear-gradient(135deg,#0a4d33 0%,#10B981 100%); color:white; flex:2; padding:13px; border-radius:11px; font-weight:800; cursor:pointer; border:none; font-size:13px; box-shadow:0 6px 16px rgba(10,77,51,0.3),inset 0 1px 0 rgba(255,255,255,0.3); transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1); text-transform:uppercase; letter-spacing:1px; }
                .btn-start-quests:hover { transform:translateY(-2px); box-shadow:0 10px 22px rgba(10,77,51,0.38),inset 0 1px 0 rgba(255,255,255,0.4); filter:brightness(1.08); }
                .btn-deselect { background:rgba(241,245,249,0.9); color:#4A5568; flex:1; border-radius:11px; font-weight:800; cursor:pointer; border:1px solid rgba(226,232,240,0.9); transition:all 0.25s; font-size:12.5px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.9); }
                .btn-deselect:hover { background:#fff; color:#0F172A; transform:translateY(-2px); box-shadow:0 5px 10px rgba(0,0,0,0.05); }
                .settings-overlay { position:absolute; inset:0; z-index:30; background:rgba(15,23,42,0.55); backdrop-filter:blur(10px); display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity 0.3s ease; border-radius:20px; }
                .settings-overlay.open { opacity:1; pointer-events:all; }
                .settings-panel { background:rgba(255,255,255,0.95); backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.6); border-radius:20px; width:480px; max-height:80%; overflow-y:auto; box-shadow:0 30px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.9); transform:translateY(20px) scale(0.95); transition:all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
                .settings-overlay.open .settings-panel { transform:translateY(0) scale(1); }
                .settings-panel::-webkit-scrollbar { width:6px; } .settings-panel::-webkit-scrollbar-thumb { background:#CBD5E1; border-radius:6px; }
                .settings-header { padding:20px 24px; border-bottom:1px solid rgba(226,232,240,0.8); display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; background:rgba(255,255,255,0.95); backdrop-filter:blur(8px); z-index:2; border-radius:20px 20px 0 0; }
                .settings-title { font-size:16px; font-weight:800; color:#0F172A; display:flex; align-items:center; gap:10px; }
                .settings-close-btn { background:rgba(241,245,249,0.8); border:1px solid rgba(226,232,240,0.8); border-radius:10px; width:32px; height:32px; cursor:pointer; font-size:15px; color:#64748B; display:flex; align-items:center; justify-content:center; transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
                .settings-close-btn:hover { background:#fff; color:#0F172A; transform:translateY(-2px); box-shadow:0 4px 10px rgba(0,0,0,0.05); }
                .settings-body { padding:20px 24px; display:flex; flex-direction:column; gap:20px; }
                .settings-section { border-bottom:1px solid rgba(226,232,240,0.8); padding-bottom:20px; }
                .settings-section:last-child { border-bottom:none; padding-bottom:0; }
                .settings-section-label { font-size:11px; font-weight:800; color:#94A3B8; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:14px; }
                .settings-info-row { display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#64748B; padding:5px 0; }
                .settings-info-val { font-weight:700; color:#0F172A; font-family:'Consolas', monospace; font-size:11px; background:#F1F5F9; padding:4px 10px; border-radius:6px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); }
                .settings-input-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
                .settings-input-label { font-size:12px; font-weight:700; color:#475569; }
                .settings-input-field { width:76px; padding:6px 10px; border:1px solid #CBD5E1; border-radius:8px; font-family:'Consolas', monospace; font-size:12px; text-align:center; transition:all 0.2s; }
                .settings-input-field:focus { outline:none; border-color:#10B981; box-shadow:0 0 0 3px rgba(16,185,129,0.2); }
                .settings-about { background:linear-gradient(135deg, #063623 0%, #0a4d33 100%); border-radius:16px; padding:18px 20px; color:white; box-shadow:0 8px 20px rgba(10,77,51,0.4), inset 0 1px 0 rgba(255,255,255,0.2); }
                .settings-about-name { font-size:18px; font-weight:800; margin-bottom:6px; letter-spacing: 0.5px; }
                .settings-about-meta { font-size:12px; color:rgba(255,255,255,0.8); display:flex; gap:20px; font-weight:600; }
            `;
            shadowRoot.appendChild(style);

            root = document.createElement('div');
            root.id = 'relay-ui';
            root.innerHTML = `
                <div id="relay-orb">
                    <div class="orb-ring"></div><div class="orb-ring"></div><div class="orb-ring"></div>
                    <div class="orb-core"></div>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); z-index:2;">
                        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon>
                        <line x1="12" y1="22" x2="12" y2="15.5"></line>
                        <polyline points="22 8.5 12 15.5 2 8.5"></polyline>
                        <polyline points="2 15.5 12 8.5 22 15.5"></polyline>
                        <line x1="12" y1="2" x2="12" y2="8.5"></line>
                    </svg>
                    <div class="orb-lbl">Relay</div>
                </div>
                <div class="internal-wrapper">
                    <div class="boot-layer" id="relay-boot">
                        <div class="sun-surface"></div>
                        <div class="light-rays"></div>
                        <div class="bubbles"></div>
                        <div class="boot-content">
                            <svg class="boot-logo" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon>
                                <line x1="12" y1="22" x2="12" y2="15.5"></line>
                                <polyline points="22 8.5 12 15.5 2 8.5"></polyline>
                                <polyline points="2 15.5 12 8.5 22 15.5"></polyline>
                                <line x1="12" y1="2" x2="12" y2="8.5"></line>
                            </svg>
                            <h1 class="boot-title">Welcome to Relay<br><strong>The Ocean of Quests</strong></h1>
                            <div class="boot-warn">Go to settings to customize protocols accordingly before initializing.</div>
                            <div class="boot-action" id="trigger-dive" style="padding:12px 24px; font-size:14px; letter-spacing:1px;">PRESS TO OPEN</div>
                        </div>
                    </div>
                    <div class="dash-layer" id="relay-dash">
                        <div id="relay-header-drag">
                            <div class="dash-title">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon>
                                    <line x1="12" y1="22" x2="12" y2="15.5"></line>
                                    <polyline points="22 8.5 12 15.5 2 8.5"></polyline>
                                    <polyline points="2 15.5 12 8.5 22 15.5"></polyline>
                                    <line x1="12" y1="2" x2="12" y2="8.5"></line>
                                </svg>
                                ${CONFIG.NAME} <span class="creator-badge">by ${CONFIG.CREATOR}</span>
                            </div>
                            <div class="header-actions">
                                <button class="btn-quests" id="relay-open-quests"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg> Quests Page</button>
                                <div class="header-toggle">
                                    <span>Hide Window</span>
                                    <label class="toggle-switch"><input type="checkbox" id="relay-hide-tog"><span class="toggle-slider"></span></label>
                                </div>
                                <button class="btn-settings" id="relay-settings-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Settings</button>
                                <button class="btn-close" id="relay-stop"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Close</button>
                            </div>
                        </div>
                        <div id="relay-main">
                            <div class="top-zone">
                                <div class="stats-grid">
                                    <div class="stat-card primary"><div class="stat-title">Tracked</div><div class="stat-val" id="stat-tot">0</div></div>
                                    <div class="stat-card"><div class="stat-title">Completed</div><div class="stat-val" id="stat-done">0</div></div>
                                    <div class="stat-card"><div class="stat-title">Executing</div><div class="stat-val" id="stat-run">0</div></div>
                                    <div class="stat-card"><div class="stat-title">Manual Action</div><div class="stat-val" id="stat-fail">0</div></div>
                                </div>
                            </div>
                            <div class="section-wave">
                                <svg viewBox="0 0 1440 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
                                    <defs>
                                        <linearGradient id="wBase" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#10B981" stop-opacity="0.18"/>
                                            <stop offset="100%" stop-color="#0a4d33" stop-opacity="0.12"/>
                                        </linearGradient>
                                        <linearGradient id="wMid" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#34D399" stop-opacity="0.14"/>
                                            <stop offset="100%" stop-color="#10B981" stop-opacity="0.07"/>
                                        </linearGradient>
                                    </defs>
                                    <rect x="-1440" y="0" width="5760" height="14" fill="rgba(255,255,255,0.98)"/>
                                    <g>
                                        <path d="M-1440,20 C-1260,6 -1080,34 -900,20 C-720,6 -540,32 -360,18 C-180,4 0,30 180,16 C360,2 540,30 720,18 C900,6 1080,32 1260,18 C1440,4 1620,30 1800,18 C1980,6 2160,30 2340,18 L2340,70 L-1440,70 Z" fill="url(#wBase)">
                                            <animateTransform attributeName="transform" type="translate" from="0,0" to="720,0" dur="12s" repeatCount="indefinite"/>
                                        </path>
                                    </g>
                                    <g>
                                        <path d="M-1440,28 C-1300,14 -1140,42 -960,27 C-780,12 -620,38 -440,24 C-260,10 -80,36 100,22 C280,8 460,36 640,22 C820,8 1000,34 1180,22 C1360,10 1540,34 1720,22 C1900,10 2080,34 2260,22 L2260,70 L-1440,70 Z" fill="url(#wMid)">
                                            <animateTransform attributeName="transform" type="translate" from="0,0" to="720,0" dur="7s" repeatCount="indefinite"/>
                                        </path>
                                    </g>
                                    <g opacity="0.55">
                                        <path d="M-1440,28 C-1300,14 -1140,42 -960,27 C-780,12 -620,38 -440,24 C-260,10 -80,36 100,22 C280,8 460,36 640,22 C820,8 1000,34 1180,22 C1360,10 1540,34 1720,22 C1900,10 2080,34 2260,22" fill="none" stroke="rgba(167,243,208,0.65)" stroke-width="1.8">
                                            <animateTransform attributeName="transform" type="translate" from="0,0" to="720,0" dur="7s" repeatCount="indefinite"/>
                                        </path>
                                    </g>
                                </svg>
                            </div>
                            <div class="bottom-zone">
                                <div class="mid-layout" id="relay-dash-mid" style="display:none;">
                                <div class="card-container">
                                    <div class="card-header">Operations Analytics</div>
                                    <div class="analytics-body">
                                        <div class="bar-chart">
                                            <div class="bar-col"><div class="bar-3d" id="bar-game" style="height:0%;"></div><div class="bar-lbl">GAM</div></div>
                                            <div class="bar-col"><div class="bar-3d" id="bar-vid" style="height:0%;"></div><div class="bar-lbl">VID</div></div>
                                            <div class="bar-col"><div class="bar-3d" id="bar-ach" style="height:0%;"></div><div class="bar-lbl">ACH</div></div>
                                            <div class="bar-col"><div class="bar-3d" id="bar-act" style="height:0%;"></div><div class="bar-lbl">ACT</div></div>
                                        </div>
                                        <div class="radial-container">
                                            <div class="radial-inner"><div class="radial-perc" id="radial-txt">0%</div><div class="radial-sub">Yield</div></div>
                                            <svg viewBox="0 0 36 36" class="circular-chart"><path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/><path class="circle" id="radial-fill" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/></svg>
                                        </div>
                                    </div>
                                </div>
                                <div class="card-container">
                                    <div class="card-header">System Protocols</div>
                                    <div class="options-list">
                                        <div class="opt-row"><div class="opt-info"><span class="opt-title">Auto-Enroll</span></div><label class="toggle-switch"><input type="checkbox" id="tog-enroll" ${RUNTIME.autoEnroll?'checked':''}><span class="toggle-slider"></span></label></div>
                                        <div class="opt-row"><div class="opt-info"><span class="opt-title">Auto-Claim</span></div><label class="toggle-switch"><input type="checkbox" id="tog-claim" ${RUNTIME.autoClaim?'checked':''}><span class="toggle-slider"></span></label></div>
                                        <div class="opt-row"><div class="opt-info"><span class="opt-title">Stealth (Fake RPC)</span></div><label class="toggle-switch"><input type="checkbox" id="tog-rpc" ${RUNTIME.stealthRPC?'checked':''}><span class="toggle-slider"></span></label></div>
                                    </div>
                                </div>
                                </div>
                                <div class="bottom-layout">
                                    <div class="card-container seq-card seq-card-wrapper" id="relay-seq-card" style="border:1px solid rgba(255,255,255,0.6);">
                                        <div class="seq-header" style="padding:14px 18px 10px;flex-shrink:0;">
                                            <div class="seq-title">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:5px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                                                Active Sequence
                                            </div>
                                            <div class="seq-btn-group">
                                                <button class="btn-stop-seq" id="relay-stop-seq">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                                                    Stop
                                                </button>
                                                <button class="btn-start-seq" id="relay-start-seq">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                                    Start
                                                </button>
                                            </div>
                                        </div>
                                        <div id="relay-body" class="task-list" style="padding:0 14px 14px;"><div style="text-align:center;padding:20px;color:#94A3B8;font-weight:600;font-size:13px;">Awaiting instructions…</div></div>
                                        <div class="scroll-indicator" id="relay-scroll-indicator">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                            More below
                                        </div>
                                    </div>
                                    <div class="console-wrapper">
                                        <div class="console-header"><div class="mac-dots"><div class="mac-dot mac-red"></div><div class="mac-dot mac-yel"></div><div class="mac-dot mac-grn"></div></div><div class="console-title">System Console</div></div>
                                        <div id="relay-logs"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="settings-overlay" id="relay-settings-overlay">
                        <div class="settings-panel">
                            <div class="settings-header"><div class="settings-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Settings</div><button class="settings-close-btn" id="relay-settings-close">✕</button></div>
                            <div class="settings-body">
                                <div class="settings-section">
                                    <div class="settings-section-label">Automation</div>
                                    <div class="options-list">
                                        <div class="opt-row"><div class="opt-info"><span class="opt-title">Auto-Enroll</span></div><label class="toggle-switch"><input type="checkbox" id="s-tog-enroll"><span class="toggle-slider"></span></label></div>
                                        <div class="opt-row"><div class="opt-info"><span class="opt-title">Auto-Claim</span></div><label class="toggle-switch"><input type="checkbox" id="s-tog-claim"><span class="toggle-slider"></span></label></div>
                                    </div>
                                </div>
                                <div class="settings-section">
                                    <div class="settings-section-label">Visibility</div>
                                    <div class="options-list">
                                        <div class="opt-row"><div class="opt-info"><span class="opt-title">Stealth (Fake RPC)</span><span class="opt-desc">Simulates real game presence. Keep ON to avoid detection.</span></div><label class="toggle-switch"><input type="checkbox" id="s-tog-rpc"><span class="toggle-slider"></span></label></div>
                                        <div class="opt-row"><div class="opt-info"><span class="opt-title">Play Sounds</span></div><label class="toggle-switch"><input type="checkbox" id="s-tog-sound"><span class="toggle-slider"></span></label></div>
                                    </div>
                                </div>
                                <div class="settings-section">
                                    <div class="settings-about">
                                        <div class="settings-about-name">${CONFIG.NAME} ${CONFIG.VERSION}</div>
                                        <div class="settings-about-meta"><span>by ${CONFIG.CREATOR}</span><span>Undetectable</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;
            shadowRoot.appendChild(root);
            boot = shadowRoot.getElementById('relay-boot');

            shadowRoot.getElementById('trigger-dive').addEventListener('click', () => {
                if (!isBooted) {
                    isBooted = true;
                    boot.classList.add('dived');
                    setTimeout(() => boot.remove(), 1200);
                }
            });

            let dragging = false, sx, sy, sl, st, moved = false;
            root.addEventListener('mousedown', e => {
                if (e.target.closest('button, input, label, .task-row, .settings-panel, .console-wrapper')) return;
                if (!root.classList.contains('orb-mode') && !e.target.closest('#relay-header-drag')) return;
                dragging = true; sx = e.clientX; sy = e.clientY; moved = false;
                const rect = root.getBoundingClientRect();
                sl = rect.left; st = rect.top;
                root.style.left = sl + 'px'; root.style.top = st + 'px'; root.style.transform = 'none';
                e.preventDefault();
            });
            window.addEventListener('mousemove', e => {
                if (!dragging) return;
                moved = true;
                root.style.left = (sl + e.clientX - sx) + 'px';
                root.style.top = (st + e.clientY - sy) + 'px';
            });
            window.addEventListener('mouseup', () => {
                if (dragging) {
                    dragging = false;
                    Storage.save('pos', { top: root.style.top, left: root.style.left, transform: '' });
                }
            });

            const hideTog = shadowRoot.getElementById('relay-hide-tog');
            hideTog.addEventListener('change', (e) => {
                if (e.target.checked) root.classList.add('orb-mode');
            });

            const orb = shadowRoot.getElementById('relay-orb');
            orb.addEventListener('mouseup', (e) => {
                if (!moved) {
                    root.classList.remove('orb-mode');
                    hideTog.checked = false;
                }
            });

            shadowRoot.getElementById('tog-enroll').addEventListener('change', e => RUNTIME.autoEnroll = e.target.checked);
            shadowRoot.getElementById('tog-claim').addEventListener('change', e => RUNTIME.autoClaim = e.target.checked);
            shadowRoot.getElementById('tog-rpc').addEventListener('change', e => RUNTIME.stealthRPC = e.target.checked);

            const settingsOverlay = shadowRoot.getElementById('relay-settings-overlay');
            shadowRoot.getElementById('relay-settings-btn').addEventListener('click', () => {
                shadowRoot.getElementById('s-tog-enroll').checked = RUNTIME.autoEnroll;
                shadowRoot.getElementById('s-tog-claim').checked = RUNTIME.autoClaim;
                shadowRoot.getElementById('s-tog-rpc').checked = RUNTIME.stealthRPC;
                shadowRoot.getElementById('s-tog-sound').checked = RUNTIME.playSound;
                settingsOverlay.classList.add('open');
            });
            shadowRoot.getElementById('relay-settings-close').addEventListener('click', () => settingsOverlay.classList.remove('open'));
            settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('open'); });

            shadowRoot.getElementById('s-tog-enroll').addEventListener('change', e => RUNTIME.autoEnroll = e.target.checked);
            shadowRoot.getElementById('s-tog-claim').addEventListener('change', e => RUNTIME.autoClaim = e.target.checked);
            shadowRoot.getElementById('s-tog-rpc').addEventListener('change', e => RUNTIME.stealthRPC = e.target.checked);
            shadowRoot.getElementById('s-tog-sound').addEventListener('change', e => RUNTIME.playSound = e.target.checked);

            shadowRoot.getElementById('relay-stop').addEventListener('click', () => shutdown());
            
            const stopSeqBtn = shadowRoot.getElementById('relay-stop-seq');
            const startSeqBtn = shadowRoot.getElementById('relay-start-seq');
            
            stopSeqBtn.addEventListener('click', () => {
                RUNTIME.sequenceActive = false;
                Traffic.queue = [];
                for (const fn of RUNTIME.cleanups) { try { fn(); } catch(e){} }
                RUNTIME.cleanups.clear();
                Patcher.clean();
                tasks.clear();
                updateStats();
                const body = shadowRoot.getElementById('relay-body');
                if (body && !body.classList.contains('picker-mode')) {
                    body.innerHTML = `<div style="text-align:center;padding:40px;color:#94A3B8;font-weight:600;font-size:14px;">Sequence Aborted.<br><span style="font-size:11px;font-weight:500;">Ready to Initialize again.</span></div>`;
                }
                toggleSequenceButtons(false);
                log('[System] Sequence completely aborted by user.', 'warn');
            });

            startSeqBtn.addEventListener('click', () => {
                if (onStartSequence) onStartSequence();
            });
            
            shadowRoot.getElementById('relay-open-quests').addEventListener('click', () => openQuestsInternal());

            const taskListEl = shadowRoot.getElementById('relay-body');
            const scrollIndicator = shadowRoot.getElementById('relay-scroll-indicator');
            function updateScrollIndicator() {
                if (!taskListEl || !scrollIndicator) return;
                const atBottom = taskListEl.scrollHeight - taskListEl.scrollTop - taskListEl.clientHeight < 16;
                const hasOverflow = taskListEl.scrollHeight > taskListEl.clientHeight + 10;
                scrollIndicator.classList.toggle('show', hasOverflow && !atBottom);
            }
            if (taskListEl) taskListEl.addEventListener('scroll', updateScrollIndicator);
            const origRender = render;
            const _scrollCheck = () => setTimeout(updateScrollIndicator, 100);
        }

        function toggleSequenceButtons(isRunning) {
            const stopBtn = shadowRoot.getElementById('relay-stop-seq');
            const startBtn = shadowRoot.getElementById('relay-start-seq');
            if (isRunning) {
                if (stopBtn) stopBtn.classList.add('visible');
                if (startBtn) startBtn.classList.remove('visible');
            } else {
                if (stopBtn) stopBtn.classList.remove('visible');
                if (startBtn) startBtn.classList.add('visible');
            }
        }

        function updateStats() {
            let tot = tasks.size, done = 0, run = 0, fail = 0;
            const stats = { game: 0, video: 0, ach: 0, act: 0 };
            tasks.forEach(t => {
                if (t.done) done++;
                else if (t.failed || t.actionRequired) fail++;
                else run++;
                if (t.type === 'GAME') stats.game++;
                else if (t.type === 'WATCH_VIDEO' || t.type === 'VIDEO') stats.video++;
                else if (t.type === 'ACHIEVEMENT') stats.ach++;
                else if (t.type === 'ACTIVITY') stats.act++;
            });
            shadowRoot.getElementById('stat-tot').textContent = tot;
            shadowRoot.getElementById('stat-done').textContent = done;
            shadowRoot.getElementById('stat-run').textContent = run;
            shadowRoot.getElementById('stat-fail').textContent = fail;
            const perc = tot === 0 ? 0 : Math.round((done / tot) * 100);
            shadowRoot.getElementById('radial-fill').setAttribute('stroke-dasharray', `${perc}, 100`);
            shadowRoot.getElementById('radial-txt').textContent = `${perc}%`;
            const max = Math.max(1, stats.game, stats.video, stats.ach, stats.act);
            ['game','vid','ach','act'].forEach(k => {
                const el = shadowRoot.getElementById(`bar-${k}`);
                if (el) el.style.height = `${(stats[k] / max) * 100}%`;
            });
        }

        function render() {
            const body = shadowRoot.getElementById('relay-body');
            if (!body || shadowRoot.getElementById('relay-picker-form')) return;
            shadowRoot.getElementById('relay-dash-mid').style.display = 'grid';
            if (!tasks.size) return body.innerHTML = `<div style="text-align:center;padding:40px;color:#94A3B8;font-weight:600;">Operations Idle...</div>`;
            const sorted = [...tasks.entries()].sort((a,b) => a[1].done ? 1 : -1);
            body.innerHTML = sorted.map(([id, t]) => {
                let statusTxt = t.status === 'CLAIMED' ? 'Secured' : t.needsLoading ? 'Needs Join' : t.done ? 'Finished' : t.failed ? 'Failed' : t.pending ? 'Queued' : 'Executing';
                let stateCls = t.done ? 'done' : t.failed ? 'failed' : t.needsLoading ? 'pending' : t.pending ? 'pending' : 'running';
                let pillCls = t.needsLoading ? 'pill-pending' : `pill-${stateCls}`;
                let actionBtn = '';
                if (t.claimable) actionBtn = `<button class="claim claim-btn" data-id="${id}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg> Claim Reward</button>`;
                else if (t.actionRequired === 'CLAIM_MANUAL') actionBtn = `<button class="task-join-btn claim-manual-btn" data-id="${id}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg> Open Quests to Claim</button>`;
                else if (t.actionRequired) actionBtn = `<button disabled>Open Activity</button>`;
                const pct = Math.round(Math.min(100, ((t.cur || 0) / (t.max || 1)) * 100));
                const typeMap = { WATCH_VIDEO:'📺', VIDEO:'📺', GAME:'🎮', STREAM:'📡', ACHIEVEMENT:'🏆', ACTIVITY:'⚡' };
                const typeIcon = typeMap[t.type] || '◆';
                const typeClass = { WATCH_VIDEO:'type-video', VIDEO:'type-video', GAME:'type-game', STREAM:'type-game', ACHIEVEMENT:'type-ach', ACTIVITY:'type-act' }[t.type] || '';
                return `<div id="relay-task-${id}" class="task-row ${stateCls}">
                    <div class="task-inner">
                        <div class="task-icon-wrap ${typeClass}">${typeIcon}</div>
                        <div class="task-body">
                            <div class="task-head">
                                <div class="task-name" title="${t.name}">${t.name}</div>
                                <div class="task-pill ${pillCls}">${statusTxt}</div>
                            </div>
                            <div><span class="task-type-chip">${t.type || 'SYSTEM'}</span></div>
                            <div class="task-progress-wrap">
                                <div class="task-progress-bar"><div class="task-progress-fill" style="width:${pct}%"></div></div>
                                <div class="task-progress-stats">
                                    <span class="task-prog-nums"><strong>${Math.floor(t.cur||0)}</strong> / ${t.max||0}</span>
                                    <span class="task-pct-label">${pct}%</span>
                                </div>
                            </div>
                            ${t.error ? `<div class="task-error-msg"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${t.error}</div>` : ''}
                            ${t.needsLoading ? `<div class="task-needs-loading"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Needs game loaded locally.</div><button class="task-join-btn join-quest-btn" data-open-quests="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg> Open Discord Quests</button>` : ''}
                            ${actionBtn ? `<div class="task-actions">${actionBtn}</div>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');

            body.querySelectorAll('.claim-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const qId = btn.dataset.id;
                    const td = tasks.get(qId);
                    if (!td) return;
                    btn.textContent = 'Processing...';
                    btn.disabled = true;
                    try {
                        const res = await Tasks.claimReward(qId);
                        if (res?.body?.claimed_at) {
                            Logger.log('[Claim] Reward secured.', 'success');
                            updateTask(qId, {...td, status:'CLAIMED', claimable:false});
                            setTimeout(() => removeTask(qId), 2000);
                        } else {
                            throw new Error("Captcha required");
                        }
                    } catch (e) {
                        Logger.log('[Claim] Verification needed. Open Quests menu.', 'warn');
                        updateTask(qId, {...td, claimable: false, actionRequired: 'CLAIM_MANUAL', error: 'Action required to claim reward (Captcha).'});
                    }
                });
            });

            body.querySelectorAll('.claim-manual-btn').forEach(btn => {
                btn.addEventListener('click', () => openQuestsInternal());
            });

            body.querySelectorAll('.join-quest-btn').forEach(btn => {
                btn.addEventListener('click', () => openQuestsInternal());
            });
            if (typeof _scrollCheck === 'function') _scrollCheck();
        }

        function updateTask(id, data) {
            const old = tasks.get(id);
            const merged = { ...old, ...data,
                done: (data.status === "COMPLETED" || data.status === "CLAIMED" || old?.done),
                failed: data.status === "FAILED",
                pending: data.status === "PENDING" || data.status === "QUEUE",
            };
            tasks.set(id, merged);
            updateStats();
            
            const row = shadowRoot.getElementById(`relay-task-${id}`);
            if (row && old?.status === merged.status && old?.claimable === merged.claimable && old?.error === merged.error) {
                const progressSpan = row.querySelector('.task-prog-nums');
                if (progressSpan) progressSpan.innerHTML = `<strong>${Math.floor(merged.cur)}</strong> / ${merged.max}`;
                
                const fill = row.querySelector('.task-progress-fill');
                const pct = Math.round(Math.min(100, ((merged.cur || 0) / (merged.max || 1)) * 100));
                if (fill) fill.style.width = `${pct}%`;
                
                const lbl = row.querySelector('.task-pct-label');
                if (lbl) lbl.textContent = `${pct}%`;
                return;
            }
            render();
        }

        function removeTask(id) { tasks.delete(id); updateStats(); render(); }

        function log(msg, type = 'info') {
            const box = shadowRoot.getElementById('relay-logs');
            if (!box) return;
            const el = document.createElement('div');
            el.className = `log-item c-${type}`;
            el.innerHTML = `<span class="log-ts">[${new Date().toLocaleTimeString().split(' ')[0]}]</span> <span>${msg}</span>`;
            box.appendChild(el);
            box.scrollTop = box.scrollHeight;
            while (box.children.length > CONFIG.MAX_LOG_ITEMS) box.firstChild.remove();
        }

        function showQuestPicker(quests) {
            return new Promise(resolve => {
                const body = shadowRoot.getElementById('relay-body');
                const mid = shadowRoot.getElementById('relay-dash-mid');
                if (!body) return resolve({ selectedQuests: new Set() });
                if (mid) mid.style.display = 'none';
                body.parentElement.style.gridColumn = "1 / -1";
                body.classList.add('picker-mode');
                const seqHeader = body.parentElement.querySelector('.seq-header');
                if (seqHeader) seqHeader.style.display = 'none';
                const consoleWrap = shadowRoot.querySelector('.console-wrapper');
                if (consoleWrap) consoleWrap.style.display = 'none';
                const NEEDS_LOADING = new Set(['ACHIEVEMENT','ACTIVITY','UNKNOWN']);
                const items = quests.map(q => {
                    const cfg = q.config?.taskConfig ?? q.config?.taskConfigV2;
                    const tData = Tasks.detectType(cfg, q.config?.application?.id) || {type:'UNKNOWN', target: 1};
                    const needsLoading = NEEDS_LOADING.has(tData.type);
                    const keyName = tData.keyName || (cfg?.tasks ? Object.keys(cfg.tasks)[0] : 'PLAY_ON_DESKTOP');
                    const cur = q.userStatus?.progress?.[keyName]?.value ?? 0;
                    const max = tData.target || 1;
                    const pct = Math.floor(Math.min(100, Math.max(0, (cur / max) * 100)));
                    return { id: q.id, name: q.config?.messages?.questName ?? 'Unknown', type: tData.type, needsLoading, cur, max, pct };
                });
                const hasLoading = items.some(q => q.needsLoading);
                const totalSel = items.length;
                body.innerHTML = `<form id="relay-picker-form">
                    <div class="picker-header">
                        <div class="picker-title">Select operations to inject</div>
                        <div class="picker-count" id="picker-count">${totalSel} selected</div>
                    </div>
                    ${hasLoading ? `<div class="picker-warning">⚠ Quests marked <b>Needs Game Loaded</b> cannot be automated — you'll see a Join button.</div>` : ''}
                    <div class="picker-scroll">
                        <div class="picker-quest-grid">
                            ${items.map(q => `<label class="quest-pick ${q.needsLoading?'quest-needs-loading':''}">
                                <input type="checkbox" name="quests" value="${q.id}" checked>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-weight:800;font-size:13px;color:#0F172A;margin-bottom:3px;line-height:1.3;font-family:'Segoe UI',system-ui,sans-serif;">${q.name}</div>
                                    <div style="font-size:9.5px;color:#64748B;font-weight:800;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;">Protocol: ${q.type}</div>
                                    ${q.needsLoading?'<span class="quest-loading-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Needs Game Loaded</span>':''}
                                    <div style="height:6px;background:rgba(226,232,240,0.8);border-radius:6px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,0.06);">
                                        <div style="height:100%;width:${q.pct}%;background:linear-gradient(90deg,#0a4d33,#10B981);border-radius:6px;"></div>
                                    </div>
                                    <div style="font-size:10px;color:#64748B;text-align:right;margin-top:5px;font-weight:700;font-family:'Consolas',monospace;">${Math.floor(q.cur)} / ${q.max} <span style="color:#94A3B8;">(${q.pct}%)</span></div>
                                </div>
                            </label>`).join('')}
                        </div>
                    </div>
                    <div class="picker-actions">
                        <button type="button" class="btn-deselect" id="select-all-btn">Deselect All</button>
                        <button type="submit" class="btn-start-quests"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;vertical-align:middle;margin-right:5px;"><polygon points="5 3 19 12 5 21 5 3"/></svg> Initialize Sequence</button>
                    </div>
                </form>`;
                shadowRoot.getElementById('relay-picker-form').addEventListener('click', e => {
                    if (e.target.id === 'select-all-btn') {
                        e.preventDefault();
                        const cbs = [...e.currentTarget.querySelectorAll('input')];
                        const all = cbs.every(cb => cb.checked);
                        cbs.forEach(cb => cb.checked = !all);
                        e.target.textContent = !all ? 'Deselect All' : 'Select All';
                        const countEl = e.currentTarget.querySelector('#picker-count');
                        if (countEl) countEl.textContent = (!all ? cbs.length : 0) + ' selected';
                    }
                    if (e.target.classList.contains('join-quest-btn')) openQuestsInternal();
                });
                shadowRoot.getElementById('relay-picker-form').addEventListener('change', e => {
                    if (e.target.type === 'checkbox') {
                        const form = e.currentTarget;
                        const cbs = [...form.querySelectorAll('input[type=checkbox]')];
                        const countEl = form.querySelector('#picker-count');
                        if (countEl) countEl.textContent = cbs.filter(c => c.checked).length + ' selected';
                    }
                });
                shadowRoot.getElementById('relay-picker-form').addEventListener('submit', e => {
                    e.preventDefault();
                    body.parentElement.style.gridColumn = "auto";
                    body.classList.remove('picker-mode');
                    if (seqHeader) seqHeader.style.display = '';
                    if (consoleWrap) consoleWrap.style.display = '';
                    const sel = [...e.currentTarget.querySelectorAll('input')].filter(cb => cb.checked).map(cb => cb.value);
                    body.innerHTML = '';
                    toggleSequenceButtons(true);
                    resolve({ selectedQuests: new Set(sel), needsLoadingIds: new Set(items.filter(q => q.needsLoading).map(q => q.id)) });
                });
            });
        }

        return { init, toggleSequenceButtons, tasks, updateTask, removeTask, log, updateStats, render, showQuestPicker };
    })();

    function shutdown() {
        if (!RUNTIME.running) return;
        RUNTIME.running = false;
        RUNTIME.sequenceActive = false;
        Logger.log('[System] Terminating...', 'warn');
        for (const fn of RUNTIME.cleanups) { try { fn(); } catch (e) {} }
        RUNTIME.cleanups.clear();
        Patcher.clean();
        setTimeout(() => {
            const h = document.querySelector('div[id^="sys_"]');
            if (h) h.remove();
        }, 1000);
    }

    async function initFlow() {
        Logger.toggleSequenceButtons(false);
        const getQuests = () => {
            const q = Mods.QuestStore.quests;
            return q instanceof Map ? [...q.values()] : Object.values(q);
        };
        let quests = getQuests().filter(q =>
            !q.userStatus?.completedAt &&
            new Date(q.config?.expiresAt).getTime() > Date.now() &&
            q.id !== CONST.ID &&
            !Tasks.skipped.has(q.id)
        );
        if (!quests.length) {
            Logger.log('[System] No active quests available.', 'warn');
            return;
        }

        const picker = await Logger.showQuestPicker(quests);
        if (!RUNTIME.running || !picker.selectedQuests.size) {
            Logger.toggleSequenceButtons(false);
            return;
        }
        
        runSequence(picker);
    }

    async function runSequence(picker) {
        RUNTIME.sequenceActive = true;
        const getQuests = () => {
            const q = Mods.QuestStore.quests;
            return q instanceof Map ? [...q.values()] : Object.values(q);
        };

        while (RUNTIME.sequenceActive && RUNTIME.running) {
            let quests = getQuests();
            const active = quests.filter(q =>
                picker.selectedQuests.has(q.id) &&
                !q.userStatus?.completedAt &&
                new Date(q.config?.expiresAt).getTime() > Date.now() &&
                !Tasks.skipped.has(q.id)
            );
            
            if (!active.length) { 
                Logger.log('[System] All operations complete.', 'success'); 
                break; 
            }

            const shuffled = active.sort(() => Math.random() - 0.5);
            const queues = { video: [], game: [] };
            
            for (const q of shuffled) {
                if (!RUNTIME.sequenceActive) break;
                const cfg = q.config?.taskConfig ?? q.config?.taskConfigV2;
                const tData = Tasks.detectType(cfg, q.config?.application?.id);
                if (!tData || tData.target <= 0) continue;
                const tInfo = { id: q.id, appId: q.config?.application?.id ?? 0, name: q.config?.messages?.questName ?? 'Unknown', target: tData.target, type: tData.type, keyName: tData.keyName };

                if (!q.userStatus?.enrolledAt && !RUNTIME.autoEnroll) {
                    Logger.updateTask(tInfo.id, {...tInfo, cur:0, max:tInfo.target, status:'PENDING', actionRequired:'ENROLL'});
                    continue;
                }
                if (Logger.tasks.has(q.id) && Logger.tasks.get(q.id).status === 'RUNNING') continue;

                if (picker.needsLoadingIds.has(q.id)) {
                    Logger.updateTask(tInfo.id, {...tInfo, cur:0, max:tInfo.target, status:'PENDING', needsLoading:true});
                    Tasks.skipped.add(q.id);
                    continue;
                }

                Logger.updateTask(tInfo.id, {...tInfo, cur:0, max:tInfo.target, status:'QUEUE'});
                const taskFunc = async () => {
                    if (!RUNTIME.sequenceActive) return;
                    if (!q.userStatus?.enrolledAt) {
                        try {
                            await Tasks.enrollQuest(q.id);
                            if (!RUNTIME.sequenceActive) return;
                            await sleep(gaussRandom(TIMING.enroll.mean, TIMING.enroll.std));
                        } catch (e) {
                            if (ErrorHandler.isSkippable(e)) { Tasks.skipped.add(q.id); return Tasks.failTask(q, tInfo, 'Enroll reject'); }
                            return Tasks.failTask(q, tInfo, 'Enroll fail');
                        }
                    }
                    if (!RUNTIME.sequenceActive) return;
                    if (tInfo.type === 'WATCH_VIDEO') return Tasks.VIDEO(q, tInfo, q.userStatus);
                    return Tasks.generic(q, tInfo, tInfo.type==='STREAM'?'STREAM':'GAME', 'PLAY_ON_DESKTOP', q.userStatus);
                };
                
                if (tInfo.type === 'WATCH_VIDEO') queues.video.push(taskFunc);
                else queues.game.push(taskFunc);
            }

            if (queues.game.length) {
                for (const fn of queues.game) {
                    if (!RUNTIME.sequenceActive) break;
                    await fn();
                }
            }
            if (queues.video.length) {
                for (const fn of queues.video) {
                    if (!RUNTIME.sequenceActive) break;
                    await fn();
                }
            }
            if (RUNTIME.sequenceActive) {
                await sleep(rnd(3000, 7000));
            }
        }

        if (RUNTIME.sequenceActive) {
            RUNTIME.sequenceActive = false;
            for (const fn of RUNTIME.cleanups) { try { fn(); } catch(e){} }
            RUNTIME.cleanups.clear();
            Patcher.clean();
            Logger.toggleSequenceButtons(false);
        }
    }

    async function main() {
        if (!Mods) return Logger.log('[Error] No Discord hook.', 'err');
        Patcher.maintainPresence();
        Logger.init(initFlow);
        await initFlow();
    }

    main().catch(e => {
        Logger.log(`[Fatal] ${e.message}`, 'err');
        shutdown();
    });
})();