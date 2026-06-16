import { App, Plugin, Modal, TFile, setIcon } from 'obsidian';

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

// === 完整保留的桌面级强交互 3D 物理引擎 ===
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
        // Fix canvas absolute positioning for parasitic layout
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
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
        // Absolutize nodes for the parasitic container
        tagEl.style.position = 'absolute';
        tagEl.style.left = '50%';
        tagEl.style.top = '50%';
        tagEl.style.willChange = 'transform, opacity, filter, color';
        
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
                tag.el.style.transform = baseTransform;
                tag.el.style.opacity = baseOpacity.toString();
                tag.el.style.color = color;
                tag.el.style.filter = `blur(${blur}px)`;
                tag.el.style.zIndex = Math.round(tag.rz + this.radius).toString();
                tag.el.style.fontSize = `${tag.baseFontSize}px`;
                tag.el.style.fontWeight = tag.baseWeight;
                tag.el.style.cursor = 'pointer'; // Ensure cursor looks clickable
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

// === 上下文溯源分析弹窗 ===
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

async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordData = new Map<string, { count: number, files: Set<TFile> }>();

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
            if (STOP_WORDS.has(w)) continue;

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

// === 核心融合：寄生于文件栏下方的桌面插件主类 ===
export default class DesktopStatsPlugin extends Plugin {
    sphereEngine: WordSphereEngine | null = null;
    injectedContainer: HTMLElement | null = null;
    cachedWords: {word: string, value: number, files: TFile[]}[] | null = null;
    
    mutationObserver: MutationObserver | null = null;
    currentObserverTarget: HTMLElement | null = null;

    async onload() {
        // 移除原有的 ItemView 注册，改为纯后台寄生模式
        this.app.workspace.onLayoutReady(async () => {
            this.cachedWords = await analyzeVaultData(this.app);
            this.observeAndInject();
        });

        // 监听视图变动，确保即使拖拽、折叠侧边栏，星系依然牢牢吸附
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.observeAndInject();
        }));

        // 添加一个手动刷新命令，便于用户随时重建星云
        this.addCommand({ 
            id: 'refresh-topology-network', 
            name: '刷新拓扑网络数据', 
            callback: () => { 
                void (async () => {
                    this.cachedWords = await analyzeVaultData(this.app);
                    if (this.injectedContainer) {
                        this.injectedContainer.remove();
                        this.injectedContainer = null;
                    }
                    this.observeAndInject();
                })();
            } 
        });
    }
    
    onunload() { 
        if (this.sphereEngine) this.sphereEngine.destroy();
        if (this.injectedContainer) this.injectedContainer.remove();
        if (this.mutationObserver) this.mutationObserver.disconnect();
        this.cachedWords = null;
    }
    
    observeAndInject() {
        try {
            // 精准定位左侧边栏的文件树容器
            const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
            if (fileExplorerLeaves.length === 0) return; 

            const fileExplorerContainer = fileExplorerLeaves[0].view.containerEl;
            const navContainer = fileExplorerContainer.querySelector('.nav-files-container') as HTMLElement;
            if (!navContainer) return;

            if (!this.injectedContainer) {
                this.buildContainer(navContainer);
            }

            if (!navContainer.contains(this.injectedContainer!)) {
                navContainer.appendChild(this.injectedContainer!);
            }

            if (this.currentObserverTarget !== navContainer) {
                if (this.mutationObserver) this.mutationObserver.disconnect();
                
                this.mutationObserver = new MutationObserver(() => {
                    if (this.injectedContainer && !navContainer.contains(this.injectedContainer)) {
                        navContainer.appendChild(this.injectedContainer);
                    }
                });
                
                this.mutationObserver.observe(navContainer, { childList: true });
                this.currentObserverTarget = navContainer;
            }

        } catch (e) {
            console.error("Topology Observer Error: ", e);
        }
    }

    buildContainer(navContainer: HTMLElement) {
        if (this.sphereEngine) this.sphereEngine.destroy();

        this.injectedContainer = activeDocument.createElement('div');
        this.injectedContainer.addClass('ts-desktop-parasitic-container');

        const heatmapDiv = this.injectedContainer.createDiv();
        heatmapDiv.addClass('ts-desktop-heatmap-div');

        navContainer.appendChild(this.injectedContainer);
        
        const heatmapWords = this.cachedWords || [];
        if (heatmapWords.length === 0) return;

        const maxWordCount = heatmapWords[0].value;
        const containerMinSide = Math.min(heatmapDiv.clientWidth || 250, heatmapDiv.clientHeight || 250);
        const baseRadius = Math.max((containerMinSide / 2) * 0.8, 45); 

        // 实例化完整的桌面级交互引擎
        this.sphereEngine = new WordSphereEngine(heatmapDiv, baseRadius);

        heatmapWords.forEach(({word, value, files}) => {
            const wordEl = activeDocument.createElement('div');
            wordEl.innerText = word;
            
            const minFont = Math.max(10, baseRadius * 0.15); 
            const maxFont = Math.max(18, baseRadius * 0.28);
            const fontSize = Math.max(minFont, Math.min(maxFont, minFont + (value/maxWordCount)*(maxFont-minFont)));
            
            const fontWeight = value > maxWordCount * 0.6 ? '700' : '400'; 
            const filePaths = new Set(files.map(f => f.path));

            // 绑定点击事件：打开上下文弹窗
            wordEl.addEventListener('click', () => {
                new WordContextModal(this.app, word, files).open();
            });
            
            this.sphereEngine!.addTag(wordEl, fontSize, fontWeight, filePaths);
        });

        // 绑定鼠标悬停共现分析逻辑
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
