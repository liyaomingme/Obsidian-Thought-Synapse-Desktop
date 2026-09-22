import { App, Plugin, Modal, TFile, setIcon, PluginSettingTab, Setting } from 'obsidian';

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个', '如果是', '怎么', '如果',
    '可以说', '这样', '很多', '非常', '进行', '然后', '可能', '因为', '所以',
    '各位', '谢谢', '由于', '其实', '只要', '目前', '开始'
]);

interface SegmentData { segment: string; isWordLike: boolean; }
interface IntlSegmenter { segment(input: string): Iterable<SegmentData>; }
interface ResizeObserver { observe(target: Element): void; unobserve(target: Element): void; disconnect(): void; }

interface SphereNode {
    el: HTMLElement;
    lx: number; ly: number; lz: number; 
    rx: number; ry: number; rz: number; 
    vx: number; vy: number; vz: number; 
    currentScale: number;               
    zRatio: number;
    baseFontSize: number;
    baseWeight: string;
    renderState: string;
    filePaths: Set<string>;
}

// ✨ v1.7.9 设置升级:检索文件夹(多文件夹) + 屏蔽词改为数组(标签式管理)
interface ThoughtSynapseSettings {
    analyzeDuration: number; 
    containerHeight: number; 
    customStopWords: string[];
    hotwordFolder: string;
}

const DEFAULT_SETTINGS: ThoughtSynapseSettings = {
    analyzeDuration: 0,
    containerHeight: 340,
    customStopWords: [],
    hotwordFolder: ""
};

// 屏蔽词数量上限:防止词过多导致星云噪音与设置面板过长
const MAX_STOP_WORDS = 50;

// ✨ v1.7.9 界面双语:跟随 Obsidian 界面语言(zh=中文,其他=英文)
function getLang(): 'zh' | 'en' {
    const lang = (window.localStorage.getItem('language') || 'en').toLowerCase();
    return lang.startsWith('zh') ? 'zh' : 'en';
}

function createI18n() {
    const zh = {
        settingsTitle: 'Thought Synapse (桌面版) 设置',
        scopeHeading: '检索范围',
        folder: '检索文件夹 (留空 = 全库)',
        folderDesc: '只统计这些文件夹(含子文件夹)内最近修改的笔记，多个文件夹用逗号分隔，如：项目, 灵感。留空则扫描整个仓库。',
        folderPlaceholder: '例如: 项目, 灵感',
        duration: '词云分析时间范围',
        durationDesc: '仅提取最近被修改过的笔记，聚焦近期思考热点。修改设置或笔记后星云会自动重新聚合。',
        appearanceHeading: '外观',
        height: '星云容器高度 (px)',
        heightDesc: '调整 3D 星云在侧边栏底部占据的纵向高度。默认 340px。',
        stopwordsHeading: '屏蔽词',
        stopwords: '自定义屏蔽词库',
        stopDesc: '输入词后点「添加」或按回车，可连续输入；点标签上的 × 可取消屏蔽。最多 50 个。',
        inputPlaceholder: '输入要屏蔽的词…',
        add: '添加',
        emptyTags: '暂无屏蔽词',
        msgInvalid: '请输入包含文字或数字的词',
        msgLimit: `最多可屏蔽 ${MAX_STOP_WORDS} 个词，请先移除部分`,
        refreshAria: '重新聚合星云',
        removeAria: (w: string) => `取消屏蔽 ${w}`,
        msgDup: (w: string) => `「${w}」已在屏蔽列表中`
    };
    const en = {
        settingsTitle: 'Thought Synapse (Desktop) Settings',
        scopeHeading: 'Search Scope',
        folder: 'Search folders (empty = whole vault)',
        folderDesc: 'Only analyze recent notes inside these folders (subfolders included). Separate multiple folders with commas, e.g. Projects, Ideas. Leave empty to scan the whole vault.',
        folderPlaceholder: 'e.g. Projects, Ideas',
        duration: 'Analysis time range',
        durationDesc: 'Only analyze recently modified notes to focus on current thinking. The nebula re-aggregates automatically after edits.',
        appearanceHeading: 'Appearance',
        height: 'Nebula container height (px)',
        heightDesc: 'The vertical space the 3D nebula occupies at the bottom of your file explorer. Default: 340px.',
        stopwordsHeading: 'Stop Words',
        stopwords: 'Custom stop words',
        stopDesc: 'Type a word and tap Add (or press Enter) — input continuously; tap × on a tag to unblock. Up to 50 words.',
        inputPlaceholder: 'Type a word to block…',
        add: 'Add',
        emptyTags: 'No stop words yet',
        msgInvalid: 'Please enter a word containing letters, CJK characters or digits',
        msgLimit: `Limit of ${MAX_STOP_WORDS} words reached — remove some first`,
        refreshAria: 'Re-analyze the nebula',
        removeAria: (w: string) => `Unblock ${w}`,
        msgDup: (w: string) => `"${w}" is already blocked`
    };
    const lang = getLang();
    return lang === 'zh' ? zh : en;
}
type I18n = ReturnType<typeof createI18n>;

class WordSphereEngine {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    radius: number;
    initRadius: number; 
    width: number = 0;
    height: number = 0;
    tags: SphereNode[] = [];
    
    isDragging = false;
    hoveredTag: SphereNode | null = null; 
    previousMouseX = 0; 
    previousMouseY = 0;
    canvasMouseX = 0; 
    canvasMouseY = 0;
    
    velocityX = 0.002; 
    velocityY = 0.002;
    targetMinSpeed = 0.0012; 
    friction = 0.96; 

    animationFrameId: number = 0;
    isActive = true;
    resizeObserver: ResizeObserver | null = null; 

    private onMouseMove = (e: MouseEvent) => {
        const rect = this.container.getBoundingClientRect();
        this.canvasMouseX = e.clientX - rect.left - rect.width / 2;
        this.canvasMouseY = e.clientY - rect.top - rect.height / 2;

        if (!this.isDragging) return;
        const deltaX = e.clientX - this.previousMouseX;
        const deltaY = e.clientY - this.previousMouseY;
        this.previousMouseX = e.clientX;
        this.previousMouseY = e.clientY;
        
        this.velocityY = this.velocityY * 0.6 + (deltaX * 0.008) * 0.4; 
        this.velocityX = this.velocityX * 0.6 + (-deltaY * 0.008) * 0.4; 
    };

    private onMouseUp = () => {
        if (this.isDragging) {
            this.isDragging = false;
            this.container.removeClass('ts-cursor-grabbing');
        }
    };

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        this.initRadius = radius; 
        
        this.canvas = activeDocument.createElement('canvas');
        this.canvas.addClass('ts-canvas');
        
        this.canvas.setCssStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%'
        });

        this.container.appendChild(this.canvas);
        
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Canvas 2D context not supported");
        this.ctx = context;

        this.handleResize();
        this.setupMouseListeners();

        const RO = (window as unknown as { ResizeObserver: new (cb: () => void) => ResizeObserver }).ResizeObserver;
        if (RO) {
            this.resizeObserver = new RO(() => this.handleResize());
            this.resizeObserver.observe(this.container);
        }
    }

    private handleResize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const safeRadiusWidth = (rect.width / 2) - 20; 
        const safeRadiusHeight = (rect.height / 2) - 20;
        let newRadius = Math.min(safeRadiusWidth, safeRadiusHeight);
        newRadius = Math.max(newRadius, 40); 

        if (this.radius > 0 && this.tags.length > 0 && this.radius !== newRadius) {
            const scaleFactor = newRadius / this.radius;
            this.tags.forEach(tag => {
                tag.lx *= scaleFactor; tag.ly *= scaleFactor; tag.lz *= scaleFactor;
                tag.rx *= scaleFactor; tag.ry *= scaleFactor; tag.rz *= scaleFactor;
            });
        }
        
        this.radius = newRadius;

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;
    }

    addTag(tagEl: HTMLElement, baseFontSize: number, baseWeight: string, filePaths: Set<string>) {
        tagEl.addClass('ts-node');
        
        tagEl.setCssStyles({
            position: 'absolute',
            left: '50%',
            top: '50%',
            willChange: 'transform, opacity, filter, color'
        });
        
        const count = this.tags.length;
        const offset = 2 / 50; 
        const increment = Math.PI * (3 - Math.sqrt(5));
        const y = ((count * offset) - 1) + (offset / 2);
        const r = Math.sqrt(1 - y * y);
        const phi = (count % 50) * increment;
        
        const x = Math.cos(phi) * r * this.radius;
        const cy = y * this.radius;
        const z = Math.sin(phi) * r * this.radius;

        this.tags.push({
            el: tagEl,
            lx: x, ly: cy, lz: z,
            rx: x, ry: cy, rz: z, 
            vx: 0, vy: 0, vz: 0,
            currentScale: 1, 
            zRatio: z / this.radius,
            baseFontSize,
            baseWeight,
            renderState: 'normal',
            filePaths: filePaths
        });
        
        this.container.appendChild(tagEl);
    }

    private setupMouseListeners() {
        this.container.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.previousMouseX = e.clientX;
            this.previousMouseY = e.clientY;
            this.container.addClass('ts-cursor-grabbing');
        });
        activeDocument.addEventListener('mousemove', this.onMouseMove);
        activeDocument.addEventListener('mouseup', this.onMouseUp);
    }

    startAnimation() {
        if (this.tags.length === 0) return;

        const getComputedColor = (cssVar: string, fallback: string) => {
            const val = getComputedStyle(activeDocument.body).getPropertyValue(cssVar).trim();
            return val || fallback;
        };

        const animate = () => {
            if (!this.isActive) return;

            if (!this.isDragging) {
                const speed = Math.sqrt(this.velocityX ** 2 + this.velocityY ** 2);
                if (speed > this.targetMinSpeed) {
                    this.velocityX *= this.friction; this.velocityY *= this.friction;
                } else if (speed > 0 && speed < this.targetMinSpeed) {
                    const ratio = this.targetMinSpeed / speed;
                    this.velocityX *= ratio; this.velocityY *= ratio;
                } else if (speed === 0) {
                    this.velocityX = this.targetMinSpeed; this.velocityY = this.targetMinSpeed;
                }
            }

            this.ctx.clearRect(0, 0, this.width, this.height);
            const cx = this.width / 2;
            const cy = this.height / 2;

            const colorNormal = getComputedColor('--text-normal', '#333333');
            const colorAccent = getComputedColor('--interactive-accent', '#007AFF');
            const neutralLineColor = '128, 128, 128'; 

            const globalScaleFactor = Math.max(0.4, Math.min(this.radius / this.initRadius, 1.1));

            this.tags.forEach(tag => {
                const x1 = tag.lx * Math.cos(this.velocityY) - tag.lz * Math.sin(this.velocityY);
                const z1 = tag.lz * Math.cos(this.velocityY) + tag.lx * Math.sin(this.velocityY);
                const y1 = tag.ly * Math.cos(this.velocityX) - z1 * Math.sin(this.velocityX);
                const z2 = z1 * Math.cos(this.velocityX) + tag.ly * Math.sin(this.velocityX);
                tag.lx = x1; tag.ly = y1; tag.lz = z2;
            });

            this.tags.forEach(tag => {
                let targetX = tag.lx; let targetY = tag.ly; let targetZ = tag.lz;

                if (this.hoveredTag === tag) {
                    targetX = this.canvasMouseX; targetY = this.canvasMouseY; targetZ = this.radius; 
                } else if (this.hoveredTag) {
                    const dx = tag.lx - this.hoveredTag.rx; 
                    const dy = tag.ly - this.hoveredTag.ry;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    const avoidRadius = Math.max(25, this.radius * 1.1); 

                    if (dist > 0 && dist < avoidRadius) {
                        const force = Math.pow((avoidRadius - dist) / avoidRadius, 2); 
                        const pushIntensityX = this.radius * 1.3;
                        const pushIntensityZ = this.radius * 0.6;
                        targetX += (dx / dist) * force * pushIntensityX;
                        targetY += (dy / dist) * force * pushIntensityX;
                        targetZ -= force * pushIntensityZ; 
                    }
                }

                const stiffness = 0.10; const damping = 0.72; 
                tag.vx += (targetX - tag.rx) * stiffness; tag.vy += (targetY - tag.ry) * stiffness; tag.vz += (targetZ - tag.rz) * stiffness;
                tag.vx *= damping; tag.vy *= damping; tag.vz *= damping;
                tag.rx += tag.vx; tag.ry += tag.vy; tag.rz += tag.vz;
                tag.zRatio = tag.rz / this.radius;

                let targetScale = 1;
                if (this.hoveredTag) {
                    if (tag.renderState === 'focused') targetScale = 1.25;
                    else if (tag.renderState === 'co-occurring') targetScale = 1;
                    else targetScale = 0.85; 
                }
                tag.currentScale += (targetScale - tag.currentScale) * 0.15;
            });

            const renderList = [...this.tags].sort((a, b) => a.rz - b.rz);

            renderList.forEach(item => {
                if (item.rz >= 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor, globalScaleFactor, colorNormal, colorAccent);
            });

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, Math.max(1, 2.5 * globalScaleFactor), 0, Math.PI * 2); 
            this.ctx.fillStyle = colorNormal;
            this.ctx.fill();

            renderList.forEach(item => {
                if (item.rz < 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor, globalScaleFactor, colorNormal, colorAccent);
            });

            renderList.forEach(item => {
                const tag = item;
                let baseOpacity = 0; let blur = 0; let color = 'var(--text-faint)';
                
                if (item.zRatio > 0.6) {
                    baseOpacity = 0.85 + 0.15 * ((item.zRatio - 0.6) / 0.4); blur = 0; color = 'var(--text-normal)';
                } else if (item.zRatio > 0) {
                    baseOpacity = 0.25 + 0.6 * (item.zRatio / 0.6); blur = 0.8 * (1 - item.zRatio / 0.6); color = 'var(--text-muted)';
                } else {
                    baseOpacity = 0.03 + 0.17 * ((item.zRatio + 1) / 1); blur = 1.0 + Math.min(3.5, Math.abs(item.zRatio) * 3.5); color = 'var(--text-faint)';
                }

                if (this.hoveredTag) {
                    if (tag.renderState === 'focused') { baseOpacity = 1; blur = 0; color = 'var(--text-normal)'; } 
                    else if (tag.renderState === 'co-occurring') { color = 'var(--interactive-accent)'; blur = 0; baseOpacity = Math.max(baseOpacity, 0.6); } 
                    else { blur = 4; baseOpacity = 0.04; }
                }

                const depthScale = 0.55 + 0.6 * ((this.radius + tag.rz) / (2 * this.radius)); 
                const finalScale = depthScale * tag.currentScale * globalScaleFactor; 
                const baseTransform = `translate(-50%, -50%) translate3d(${tag.rx}px, ${tag.ry}px, 0px) scale(${finalScale})`;
                
                tag.el.setCssStyles({
                    transform: baseTransform,
                    opacity: baseOpacity.toString(),
                    color: color,
                    filter: `blur(${blur}px)`,
                    zIndex: Math.round(tag.rz + this.radius).toString(),
                    fontSize: `${tag.baseFontSize}px`,
                    fontWeight: tag.baseWeight,
                    cursor: 'pointer'
                });
            });

            this.animationFrameId = window.requestAnimationFrame(animate);
        };

        animate();
    }

    private drawConnectionLine(cx: number, cy: number, item: SphereNode, neutralRGB: string, globalScaleFactor: number, normalColor: string, accentColor: string) {
        let depthOpacity = 0; let depthWidth = 0.3;
        if (item.zRatio > 0) { depthOpacity = 0.02 + 0.1 * item.zRatio; depthWidth = 0.3 + 0.4 * item.zRatio; } 
        else { depthOpacity = 0.02 * (1 - Math.abs(item.zRatio)); depthWidth = 0.3; }

        depthWidth *= globalScaleFactor;
        if (depthOpacity <= 0) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + item.rx, cy + item.ry);
        this.ctx.lineWidth = Math.max(0.1, depthWidth);

        if (this.hoveredTag) {
            if (item.renderState === 'focused') { this.ctx.strokeStyle = `rgb(${neutralRGB})`; this.ctx.globalAlpha = depthOpacity * 1.5; } 
            else if (item.renderState === 'co-occurring') { this.ctx.strokeStyle = accentColor; this.ctx.globalAlpha = depthOpacity * 1.5; } 
            else { this.ctx.globalAlpha = 0; }
        } else {
            this.ctx.strokeStyle = `rgb(${neutralRGB})`; this.ctx.globalAlpha = depthOpacity;
        }

        if (this.ctx.globalAlpha > 0) this.ctx.stroke();
        this.ctx.restore();
    }

    destroy() {
        this.isActive = false;
        if (this.animationFrameId) window.cancelAnimationFrame(this.animationFrameId);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        activeDocument.removeEventListener('mousemove', this.onMouseMove);
        activeDocument.removeEventListener('mouseup', this.onMouseUp);
    }
}

class WordContextModal extends Modal {
    word: string; files: TFile[];
    constructor(app: App, word: string, files: TFile[]) { super(app); this.word = word; this.files = files; }

    async onOpen() {
        const { contentEl } = this; contentEl.empty();
        this.modalEl.addClass('ts-modal');
        contentEl.createEl('h2', { text: `「${this.word}」`, cls: 'ts-modal-title' });
        contentEl.createEl('p', { text: `在 ${this.files.length} 篇笔记的正文中被提及：`, cls: 'ts-modal-subtitle' });

        const listContainer = contentEl.createDiv({ cls: 'ts-list-container' });

        for (const file of this.files) {
            const content = await this.app.vault.cachedRead(file);
            const rawContent = content.replace(/\s+/g, ' '); 
            const safeWord = this.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
            const regex = new RegExp(`.{0,45}${safeWord}.{0,45}`, 'gi');
            const matches = rawContent.match(regex) || [];

            if (matches.length > 0) {
                const card = listContainer.createDiv({ cls: 'ts-card' });
                card.addEventListener('click', () => { 
                    void (async () => {
                        const leaf = this.app.workspace.getLeaf('tab'); 
                        await leaf.openFile(file); 
                        this.close(); 
                    })();
                });

                const fileTitle = card.createEl('div', { cls: 'ts-card-title' });
                const fileIconSpan = fileTitle.createEl('span', { cls: 'ts-card-icon' });
                setIcon(fileIconSpan, 'document'); 
                fileTitle.appendChild(activeDocument.createTextNode(file.basename));

                const displayMatches = matches.slice(0, 3);
                for (let match of displayMatches) {
                    const snippetDiv = card.createDiv({ cls: 'ts-snippet' });
                    const parts = match.split(new RegExp(`(${safeWord})`, 'gi'));
                    snippetDiv.appendChild(activeDocument.createTextNode('"...'));
                    parts.forEach(part => {
                        if (part.toLowerCase() === this.word.toLowerCase()) snippetDiv.createEl('span', { text: part, cls: 'ts-highlight' });
                        else snippetDiv.appendChild(activeDocument.createTextNode(part)); 
                    });
                    snippetDiv.appendChild(activeDocument.createTextNode('..."'));
                }
            }
        }
    }
    onClose() { this.contentEl.empty(); }
}

async function analyzeVaultData(app: App, settings: ThoughtSynapseSettings) {
    let files = app.vault.getMarkdownFiles();

    // ✨ v1.7.9 多文件夹检索:逗号分隔多个文件夹,含子文件夹
    const folderPrefixes = (settings.hotwordFolder || "")
        .split(/[,，]/)
        .map(p => p.trim().replace(/\/+$/, ""))
        .filter(p => p.length > 0);
    if (folderPrefixes.length > 0) {
        files = files.filter(f => folderPrefixes.some(p => f.path === p || f.path.startsWith(p + "/")));
    }

    if (settings.analyzeDuration > 0) {
        const cutoffTime = Date.now() - (settings.analyzeDuration * 24 * 60 * 60 * 1000);
        files = files.filter(f => f.stat.mtime >= cutoffTime);
    }

    // ✨ 性能保护:按修改时间倒序,最多精读最近 200 篇(大仓库不再卡顿)
    files = files.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 200);

    if (files.length === 0) return [];

    const wordData = new Map<string, { count: number, files: Set<TFile> }>();

    // ✨ v1.7.9 屏蔽词为词数组(由标签式设置页维护)
    const customStopWordsSet = new Set(settings.customStopWords);

    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        const cleanText = content
            .replace(new RegExp("`{3}[\\s\\S]*?`{3}", "g"), ' ') 
            .replace(/---[\s\S]*?---/, ' ')  
            .replace(/<[^>]*>?/gm, ' ')      
            .replace(/https?:\/\/[^\s]+/g, ' ') 
            .replace(/[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g, ' ') 
            .replace(/[0-9a-fA-F]{8,}/g, ' ') 
            .replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' '); 

        let segments: SegmentData[] = [];
        const intlNamespace = (window as unknown as { Intl: { Segmenter: new (locales: string, options: { granularity: string }) => IntlSegmenter } }).Intl;
        
        if (intlNamespace && intlNamespace.Segmenter) {
            const segmenter = new intlNamespace.Segmenter('zh-CN', { granularity: 'word' });
            segments = Array.from(segmenter.segment(cleanText));
        } else {
            const fallbackWords = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
            segments = fallbackWords.map(w => ({ segment: w, isWordLike: true }));
        }

        for (const { segment, isWordLike } of segments) {
            if (!isWordLike) continue; 
            const w = segment.toLowerCase().trim();
            
            // ✨ 如果在默认屏蔽库 或 自定义屏蔽库 中，则直接跳过
            if (STOP_WORDS.has(w) || customStopWordsSet.has(w)) continue;

            const isChinese = /[\u4e00-\u9fa5]/.test(w);
            if ((isChinese && w.length >= 2) || (!isChinese && w.length >= 3 && w.length <= 20)) {
                if (!wordData.has(w)) wordData.set(w, { count: 0, files: new Set() });
                const entry = wordData.get(w)!;
                entry.count++;
                entry.files.add(file);
            }
        }
    }

    return Array.from(wordData.entries())
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 45) 
                .map(([word, data]) => ({ word, value: data.count, files: Array.from(data.files) }));
}

export default class DesktopStatsPlugin extends Plugin {
    settings: ThoughtSynapseSettings;
    sphereEngine: WordSphereEngine | null = null;
    injectedContainer: HTMLElement | null = null;
    cachedWords: {word: string, value: number, files: TFile[]}[] | null = null;
    
    async onload() {
        await this.loadSettings();

        this.app.workspace.onLayoutReady(async () => {
            this.cachedWords = await analyzeVaultData(this.app, this.settings);
            this.ensureInjection();

            this.registerInterval(window.setInterval(() => {
                this.ensureInjection();
            }, 1000));
        });

        // ✨ v1.7.9 自动刷新:笔记有增删改后,静置 90 秒(防抖)自动重算星云——
        // 书写过程完全不打扰,停下笔一小会儿星云就悄悄跟上最新内容
        let vaultChangeTimer: number | null = null;
        const scheduleVaultRefresh = () => {
            if (vaultChangeTimer) window.clearTimeout(vaultChangeTimer);
            vaultChangeTimer = window.setTimeout(() => { void this.refreshTopology(); }, 90_000);
        };
        this.registerEvent(this.app.vault.on('modify', scheduleVaultRefresh));
        this.registerEvent(this.app.vault.on('create', scheduleVaultRefresh));
        this.registerEvent(this.app.vault.on('delete', scheduleVaultRefresh));
        this.registerEvent(this.app.vault.on('rename', scheduleVaultRefresh));

        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.ensureInjection();
        }));

        this.addCommand({ 
            id: 'refresh-topology-network', 
            name: '刷新拓扑网络数据', 
            callback: () => { 
                void this.refreshTopology();
            } 
        });

        this.addSettingTab(new ThoughtSynapseSettingTab(this.app, this));
    }
    
    async loadSettings() {
        const data = await this.loadData() as Partial<ThoughtSynapseSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

        // 兼容迁移:v1.7.9 之前 customStopWords 为逗号/空格分隔的字符串
        const legacy = data?.customStopWords as unknown;
        if (typeof legacy === 'string') {
            this.settings.customStopWords = legacy.split(/[,，\s]+/).filter(w => w.trim().length > 0);
        }
        if (!Array.isArray(this.settings.customStopWords)) {
            this.settings.customStopWords = [];
        }
    }
    
    async saveSettings() {
        await this.saveData(this.settings);

        // ✨ v1.7.9 防抖:连续修改设置(如逐个添加屏蔽词)时,停顿 1 秒后才重算星云,
        // 保证连续输入体验(容器高度滑杆走 updateContainerHeight 直调,不受影响)
        if (this.rebuildTimer) window.clearTimeout(this.rebuildTimer);
        this.rebuildTimer = window.setTimeout(() => { void this.refreshTopology(); }, 1000);
    }

    private rebuildTimer: number | null = null;

    async refreshTopology() {
        this.cachedWords = await analyzeVaultData(this.app, this.settings);
        if (this.injectedContainer) {
            this.injectedContainer.remove();
            this.injectedContainer = null;
        }
        this.ensureInjection();
    }

    // ✨ v1.7.9 手动刷新:立即重算并重建星云(设置变化走 1 秒防抖,此处为即时通道)
    manualRefresh() {
        if (this.rebuildTimer) { window.clearTimeout(this.rebuildTimer); this.rebuildTimer = null; }
        void this.refreshTopology();
    }

    updateContainerHeight() {
        if (this.injectedContainer) {
            this.injectedContainer.style.height = `${this.settings.containerHeight}px`;
        }
    }

    onunload() { 
        if (this.sphereEngine) this.sphereEngine.destroy();
        if (this.injectedContainer) this.injectedContainer.remove();
        if (this.rebuildTimer) window.clearTimeout(this.rebuildTimer);
        this.cachedWords = null;
    }
    
    ensureInjection() {
        if (!this.cachedWords || this.cachedWords.length === 0) return;

        try {
            const leaves = this.app.workspace.getLeavesOfType('file-explorer');
            if (leaves.length === 0) return; 

            const fileExplorerContainer = leaves[0].view.containerEl;
            const navContainer = fileExplorerContainer.querySelector('.nav-files-container') as HTMLElement;
            
            if (!navContainer) return; 

            if (!this.injectedContainer) {
                this.buildContainer();
            }

            if (this.injectedContainer && navContainer !== this.injectedContainer.parentElement) {
                navContainer.appendChild(this.injectedContainer);
            }

        } catch (e) {
            console.error("Topology Injection Error: ", e);
        }
    }

    buildContainer() {
        const heatmapWords = this.cachedWords || [];
        if (heatmapWords.length === 0) return;

        if (this.sphereEngine) this.sphereEngine.destroy();

        this.injectedContainer = activeDocument.createElement('div');
        this.injectedContainer.addClass('ts-desktop-parasitic-container');
        
        this.injectedContainer.style.height = `${this.settings.containerHeight}px`;

        // ✨ v1.7.9 手动刷新按钮(右上角,悬停有提示)
        const i18n = createI18n();
        const refreshBtn = this.injectedContainer.createSpan({ text: '↻', cls: 'ts-desktop-refresh-btn', attr: { 'aria-label': i18n.refreshAria } });
        refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); this.manualRefresh(); });

        const heatmapDiv = this.injectedContainer.createDiv();
        heatmapDiv.addClass('ts-desktop-heatmap-div');

        const maxWordCount = heatmapWords[0].value;
        const baseRadius = 120; 

        this.sphereEngine = new WordSphereEngine(heatmapDiv, baseRadius);

        heatmapWords.forEach(({word, value, files}) => {
            const wordEl = activeDocument.createElement('div');
            wordEl.innerText = word;
            
            const minFont = Math.max(10, baseRadius * 0.15); 
            const maxFont = Math.max(18, baseRadius * 0.28);
            const fontSize = Math.max(minFont, Math.min(maxFont, minFont + (value/maxWordCount)*(maxFont-minFont)));
            
            const fontWeight = value > maxWordCount * 0.6 ? '700' : '400'; 
            const filePaths = new Set(files.map(f => f.path));

            wordEl.addEventListener('click', () => {
                new WordContextModal(this.app, word, files).open();
            });
            
            this.sphereEngine!.addTag(wordEl, fontSize, fontWeight, filePaths);
        });

        this.sphereEngine.tags.forEach(tag => {
            const node = tag;
            node.el.addEventListener('mouseenter', () => {
                this.sphereEngine!.hoveredTag = node; 
                this.sphereEngine!.tags.forEach(other => {
                    let isCoOccurring = false;
                    for (let p of other.filePaths) { if (node.filePaths.has(p)) { isCoOccurring = true; break; } }

                    if (other === node) other.renderState = 'focused';
                    else if (isCoOccurring) other.renderState = 'co-occurring';
                    else other.renderState = 'dimmed';
                });
            });
            
            node.el.addEventListener('mouseleave', () => {
                this.sphereEngine!.hoveredTag = null; 
                this.sphereEngine!.tags.forEach(other => other.renderState = 'normal');
            });
        });

        this.sphereEngine.startAnimation();
    }
}

class ThoughtSynapseSettingTab extends PluginSettingTab {
    plugin: DesktopStatsPlugin;

    constructor(app: App, plugin: DesktopStatsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ✨ v1.7.9 界面双语 + 分组排版(横版:每个分组一个标题,控件区间距更大)
        const t = createI18n();

        new Setting(containerEl).setName(t.settingsTitle).setHeading();

        // ── 检索范围 ──
        new Setting(containerEl).setName(t.scopeHeading).setHeading();

        new Setting(containerEl)
            .setName(t.folder)
            .setDesc(t.folderDesc)
            .addText(text => text
                .setPlaceholder(t.folderPlaceholder)
                .setValue(this.plugin.settings.hotwordFolder)
                .onChange(async (value) => {
                    this.plugin.settings.hotwordFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t.duration)
            .setDesc(t.durationDesc)
            .addDropdown(drop => drop
                .addOption('0', getLang() === 'zh' ? '所有时间 (全部笔记)' : 'All time')
                .addOption('7', getLang() === 'zh' ? '最近 7 天' : 'Last 7 days')
                .addOption('30', getLang() === 'zh' ? '最近 30 天' : 'Last 30 days')
                .addOption('180', getLang() === 'zh' ? '最近半年' : 'Last 6 months')
                .addOption('365', getLang() === 'zh' ? '最近一年' : 'Last year')
                .setValue(this.plugin.settings.analyzeDuration.toString())
                .onChange(async (value) => {
                    this.plugin.settings.analyzeDuration = Number(value);
                    await this.plugin.saveSettings();
                    void this.plugin.refreshTopology();
                }));

        // ── 外观 ──
        new Setting(containerEl).setName(t.appearanceHeading).setHeading();

        new Setting(containerEl)
            .setName(t.height)
            .setDesc(t.heightDesc)
            .addSlider(slider => slider
                .setLimits(200, 800, 10)
                .setValue(this.plugin.settings.containerHeight)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.containerHeight = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateContainerHeight();
                }));

        // ── 屏蔽词(标签式管理,横版宽幅排版) ──
        new Setting(containerEl).setName(t.stopwordsHeading).setHeading();

        new Setting(containerEl)
            .setName(t.stopwords)
            .setDesc(t.stopDesc);

        const manager = containerEl.createDiv('stopword-manager');
        const inputRow = manager.createDiv('stopword-input-row');
        const wordInput = inputRow.createEl('input', {
            cls: 'stopword-input',
            type: 'text',
            attr: { placeholder: t.inputPlaceholder, 'aria-label': t.inputPlaceholder }
        });
        const addBtn = inputRow.createEl('button', { cls: 'stopword-add-btn', text: t.add });

        const metaRow = manager.createDiv('stopword-meta-row');
        const msgEl = metaRow.createDiv({ cls: 'stopword-msg', text: '' });
        const counterEl = metaRow.createDiv({ cls: 'stopword-counter' });
        const tagsWrap = manager.createDiv('stopword-tags');

        let msgTimer: number | null = null;
        const flashMsg = (text: string) => {
            msgEl.setText(text);
            msgEl.addClass('is-visible');
            if (msgTimer) window.clearTimeout(msgTimer);
            msgTimer = window.setTimeout(() => msgEl.removeClass('is-visible'), 2000);
        };

        // animateWord: 只有刚添加的词播放入场动画，其余标签保持静止（避免连续输入时整排闪烁）
        const renderTags = (animateWord?: string) => {
            const words = this.plugin.settings.customStopWords;
            counterEl.setText(`${words.length} / ${MAX_STOP_WORDS}`);
            tagsWrap.empty();
            if (words.length === 0) {
                tagsWrap.createDiv({ cls: 'stopword-empty', text: t.emptyTags });
                return;
            }
            words.forEach(word => {
                const chip = tagsWrap.createDiv('stopword-chip');
                if (animateWord && word === animateWord) chip.addClass('is-new');
                chip.createSpan({ text: word, cls: 'stopword-chip-text' });
                const removeBtn = chip.createSpan({ text: '×', cls: 'stopword-chip-remove', attr: { 'aria-label': t.removeAria(word) } });
                removeBtn.onclick = () => {
                    void (async () => {
                        this.plugin.settings.customStopWords = words.filter(w => w !== word);
                        await this.plugin.saveSettings();
                        renderTags();
                    })();
                };
            });
        };

        const addWord = () => {
            void (async () => {
                const word = wordInput.value.trim();
                if (!word) return;
                // 过滤纯符号（如单独的逗号、句号）
                if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(word)) {
                    flashMsg(t.msgInvalid);
                    return;
                }
                const words = this.plugin.settings.customStopWords;
                if (words.includes(word)) {
                    flashMsg(t.msgDup(word));
                    wordInput.value = '';
                    return;
                }
                if (words.length >= MAX_STOP_WORDS) {
                    flashMsg(t.msgLimit);
                    return;
                }
                words.push(word);
                await this.plugin.saveSettings();
                wordInput.value = '';
                renderTags(word);
                wordInput.focus();
            })();
        };

        // 点击按钮时不让输入框失焦（键盘/焦点保持，连续输入）
        addBtn.addEventListener('pointerdown', (e) => e.preventDefault());
        addBtn.onclick = () => addWord();
        wordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addWord(); }
        });

        renderTags();
    }
}
