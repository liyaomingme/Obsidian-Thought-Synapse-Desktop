import { App, ItemView, Plugin, WorkspaceLeaf, Modal, TFile, setIcon } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个', '如果是', '怎么', '如果',
    '可以说', '这样', '很多', '非常', '进行', '然后', '可能', '因为', '所以',
    '各位', '谢谢', '由于', '其实', '只要', '目前', '开始'
]);

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

// --- 物理级 3D 星系引擎 (加入全局视界动态缩放) ---
class WordSphereEngine {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    radius: number;
    width: number = 0;
    height: number = 0;
    tags: SphereNode[] = [];
    
    // 全局视界缩放比例 (随侧边栏拖拽动态改变)
    containerScale: number = 1; 

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
    resizeObserver: any; 

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
            this.container.style.cursor = 'default';
        }
    };

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none'; 
        this.canvas.style.zIndex = '0';
        this.container.appendChild(this.canvas);
        
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Canvas 2D context not supported");
        this.ctx = context;

        this.handleResize();
        this.setupMouseListeners();

        // @ts-ignore
        this.resizeObserver = new ResizeObserver(() => this.handleResize());
        this.resizeObserver.observe(this.container);
    }

    private handleResize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        // 极致流体计算：动态设定容器安全范围
        const safeRadiusWidth = (rect.width / 2) - 25; // 左右预留防裁切空间
        const safeRadiusHeight = (rect.height / 2) - 20;
        let newRadius = Math.min(safeRadiusWidth, safeRadiusHeight);
        newRadius = Math.max(newRadius, 25); // 允许缩到极小尺寸

        // 核心突破：生成全局缩放比例 (以 90px 正常半径为基准进行缩放)
        // 无论拖多宽多窄，全局矩阵都会等比例放大缩小
        this.containerScale = Math.max(0.3, Math.min(newRadius / 90, 1.3));

        if (this.radius > 0 && this.tags.length > 0 && this.radius !== newRadius) {
            const scaleFactor = newRadius / this.radius;
            this.tags.forEach(tag => {
                tag.lx *= scaleFactor;
                tag.ly *= scaleFactor;
                tag.lz *= scaleFactor;
                tag.rx *= scaleFactor;
                tag.ry *= scaleFactor;
                tag.rz *= scaleFactor;
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
        tagEl.style.position = 'absolute';
        tagEl.style.left = '50%';
        tagEl.style.top = '50%';
        tagEl.style.cursor = 'pointer';
        tagEl.style.willChange = 'transform, opacity, filter, color';
        tagEl.style.zIndex = '10'; 
        
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
            this.container.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
    }

    startAnimation() {
        if (this.tags.length === 0) return;

        const getComputedColor = (cssVar: string, fallback: string) => {
            const val = getComputedStyle(document.body).getPropertyValue(cssVar).trim();
            return val || fallback;
        };

        const animate = () => {
            if (!this.isActive) return;

            if (!this.isDragging) {
                const speed = Math.sqrt(this.velocityX ** 2 + this.velocityY ** 2);
                if (speed > this.targetMinSpeed) {
                    this.velocityX *= this.friction; 
                    this.velocityY *= this.friction;
                } else if (speed > 0 && speed < this.targetMinSpeed) {
                    const ratio = this.targetMinSpeed / speed;
                    this.velocityX *= ratio;
                    this.velocityY *= ratio;
                } else if (speed === 0) {
                    this.velocityX = this.targetMinSpeed;
                    this.velocityY = this.targetMinSpeed;
                }
            }

            this.ctx.clearRect(0, 0, this.width, this.height);
            const cx = this.width / 2;
            const cy = this.height / 2;

            const colorAccent = getComputedColor('--interactive-accent', '#007AFF');
            const colorNormal = getComputedColor('--text-normal', '#333333');
            const neutralLineColor = '128, 128, 128'; 

            this.tags.forEach(tag => {
                const x1 = tag.lx * Math.cos(this.velocityY) - tag.lz * Math.sin(this.velocityY);
                const z1 = tag.lz * Math.cos(this.velocityY) + tag.lx * Math.sin(this.velocityY);
                const y1 = tag.ly * Math.cos(this.velocityX) - z1 * Math.sin(this.velocityX);
                const z2 = z1 * Math.cos(this.velocityX) + tag.ly * Math.sin(this.velocityX);
                tag.lx = x1; tag.ly = y1; tag.lz = z2;
            });

            this.tags.forEach(tag => {
                let targetX = tag.lx;
                let targetY = tag.ly;
                let targetZ = tag.lz;

                if (this.hoveredTag === tag) {
                    targetX = this.canvasMouseX;
                    targetY = this.canvasMouseY;
                    targetZ = this.radius; 
                } else if (this.hoveredTag) {
                    const dx = tag.lx - this.hoveredTag.rx; 
                    const dy = tag.ly - this.hoveredTag.ry;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    // 斥力半径随侧边栏自适应动态调整，防止拥挤
                    const avoidRadius = Math.max(35, this.radius * 1.1); 

                    if (dist > 0 && dist < avoidRadius) {
                        const force = Math.pow((avoidRadius - dist) / avoidRadius, 2); 
                        const pushIntensityX = this.radius * 1.3;
                        const pushIntensityZ = this.radius * 0.6;
                        targetX += (dx / dist) * force * pushIntensityX;
                        targetY += (dy / dist) * force * pushIntensityX;
                        targetZ -= force * pushIntensityZ; 
                    }
                }

                const stiffness = 0.10; 
                const damping = 0.72; 
                
                tag.vx += (targetX - tag.rx) * stiffness;
                tag.vy += (targetY - tag.ry) * stiffness;
                tag.vz += (targetZ - tag.rz) * stiffness;
                
                tag.vx *= damping;
                tag.vy *= damping;
                tag.vz *= damping;
                
                tag.rx += tag.vx;
                tag.ry += tag.vy;
                tag.rz += tag.vz;
                
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
                this.drawConnectionLine(cx, cy, item, neutralLineColor, colorNormal, colorAccent);
            });

            // 中心奇点大小响应式缩放
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, Math.max(1, 2.5 * this.containerScale), 0, Math.PI * 2); 
            this.ctx.fillStyle = colorNormal;
            this.ctx.fill();

            renderList.forEach(item => {
                if (item.rz < 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor, colorNormal, colorAccent);
            });

            renderList.forEach(item => {
                const tag = item;
                
                let baseOpacity = 0; let blur = 0; let color = 'var(--text-faint)';
                if (item.zRatio > 0.4) {
                    baseOpacity = 0.95; blur = 0; color = 'var(--text-normal)'; 
                } else if (item.zRatio > 0) {
                    baseOpacity = 0.5 + 0.45 * (item.zRatio / 0.4); blur = 0; color = 'var(--text-muted)'; 
                } else {
                    baseOpacity = 0.12 + 0.38 * ((item.zRatio + 1) / 1); 
                    blur = Math.min(2.5, Math.abs(item.zRatio) * 2.5); color = 'var(--text-faint)';
                }

                if (this.hoveredTag) {
                    if (tag.renderState === 'focused') {
                        baseOpacity = 1;
                        blur = 0;
                    } else if (tag.renderState === 'co-occurring') {
                        color = 'var(--interactive-accent)';
                        blur = 0;
                        baseOpacity = Math.max(baseOpacity, 0.6);
                    } else {
                        blur = 4;
                        baseOpacity = 0.05;
                    }
                }

                const depthScale = 0.65 + 0.5 * ((this.radius + tag.rz) / (2 * this.radius)); 
                // 核心闭环：将全局缩放矩阵 (containerScale) 乘入最终的 Scale 变换中
                // 这保证了文字视觉体积与侧边栏宽度始终完美匹配
                const finalScale = depthScale * tag.currentScale * this.containerScale; 

                const baseTransform = `translate(-50%, -50%) translate3d(${tag.rx}px, ${tag.ry}px, 0px)`;
                tag.el.style.transform = `${baseTransform} scale(${finalScale})`;
                tag.el.style.opacity = baseOpacity.toString();
                tag.el.style.color = color;
                tag.el.style.filter = `blur(${blur}px)`;
                tag.el.style.zIndex = Math.round(tag.rz + this.radius).toString();
            });

            this.animationFrameId = requestAnimationFrame(animate);
        };

        animate();
    }

    private drawConnectionLine(cx: number, cy: number, item: SphereNode, neutralRGB: string, normalColor: string, accentColor: string) {
        let depthOpacity = 0;
        let depthWidth = 0.4;
        
        if (item.zRatio > 0) {
            depthOpacity = 0.04 + 0.15 * item.zRatio; 
            depthWidth = 0.4 + 0.5 * item.zRatio;
        } else {
            depthOpacity = 0.04 * (1 - Math.abs(item.zRatio)); 
            depthWidth = 0.4;
        }

        // 连线粗细也参与全局缩放
        depthWidth *= this.containerScale;

        if (depthOpacity <= 0) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + item.rx, cy + item.ry);
        this.ctx.lineWidth = Math.max(0.1, depthWidth);

        if (this.hoveredTag) {
            if (item.renderState === 'focused') {
                this.ctx.strokeStyle = `rgb(${neutralRGB})`;
                this.ctx.globalAlpha = depthOpacity; 
            } else if (item.renderState === 'co-occurring') {
                this.ctx.strokeStyle = accentColor;
                this.ctx.globalAlpha = depthOpacity * 1.2; 
            } else {
                this.ctx.globalAlpha = 0; 
            }
        } else {
            this.ctx.strokeStyle = `rgb(${neutralRGB})`;
            this.ctx.globalAlpha = depthOpacity;
        }

        if (this.ctx.globalAlpha > 0) {
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    destroy() {
        this.isActive = false;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
    }
}

async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordData = new Map<string, { count: number, files: Set<TFile> }>();

    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        const cleanText = content
            .replace(/```[\s\S]*?```/g, ' ') 
            .replace(/---[\s\S]*?---/, ' ')  
            .replace(/<[^>]*>?/gm, ' ')      
            .replace(/https?:\/\/[^\s]+/g, ' ') 
            .replace(/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g, ' ') 
            .replace(/[0-9a-fA-F]{8,}/g, ' ') 
            .replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' '); 

        let segments: any[] = [];
        const IntlAny = Intl as any;
        if (IntlAny.Segmenter) {
            const segmenter = new IntlAny.Segmenter('zh-CN', { granularity: 'word' });
            const iterator = segmenter.segment(cleanText);
            segments = Array.from(iterator);
        } else {
            const fallbackWords = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
            segments = fallbackWords.map((w: string) => ({ segment: w, isWordLike: true }));
        }

        for (const { segment, isWordLike } of segments) {
            if (!isWordLike) continue; 
            const w = segment.toLowerCase().trim();
            if (STOP_WORDS.has(w)) continue;

            const isChinese = /[\u4e00-\u9fa5]/.test(w);
            if ((isChinese && w.length >= 2) || (!isChinese && w.length >= 3 && w.length <= 20)) {
                if (!wordData.has(w)) {
                    wordData.set(w, { count: 0, files: new Set() });
                }
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

class WordContextModal extends Modal {
    word: string; files: TFile[];
    constructor(app: App, word: string, files: TFile[]) { super(app); this.word = word; this.files = files; }

    async onOpen() {
        const { contentEl } = this; contentEl.empty();
        this.modalEl.style.cssText = 'max-width: 850px; width: 90vw; border-radius: 20px; padding: 32px; box-shadow: 0 16px 40px rgba(0,0,0,0.08);';

        contentEl.createEl('h2', { text: `「${this.word}」`, attr: { style: 'margin: 0 0 10px 0; font-size: 1.8em; font-weight: 700; color: var(--interactive-accent); font-family: "SimSun", "STSong", "Songti SC", serif; letter-spacing: -0.5px;' } });
        contentEl.createEl('p', { text: `在 ${this.files.length} 篇笔记的正文中被提及：`, attr: { style: 'margin: 0 0 24px 0; color: var(--text-muted); font-size: 1em;' } });

        const listContainer = contentEl.createDiv({ attr: { style: 'max-height: 60vh; overflow-y: auto; padding-right: 12px; display: flex; flex-direction: column; gap: 16px;' } });

        this.files.forEach(async (file) => {
            const content = await this.app.vault.cachedRead(file);
            const rawContent = content.replace(/\s+/g, ' '); 
            const safeWord = this.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
            const regex = new RegExp(`.{0,45}${safeWord}.{0,45}`, 'gi');
            const matches = rawContent.match(regex) || [];

            if (matches.length > 0) {
                const card = listContainer.createDiv({ attr: { style: 'background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s ease;' } });
                card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--interactive-accent)'; card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.04)'; });
                card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--background-modifier-border)'; card.style.transform = 'translateY(0)'; card.style.boxShadow = 'none'; });
                card.addEventListener('click', async () => { const leaf = this.app.workspace.getLeaf(false); await leaf.openFile(file); this.close(); });

                const fileTitle = card.createEl('div', { attr: { style: 'font-weight: 700; font-size: 1.1em; margin-bottom: 12px; color: var(--text-normal); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center;' } });
                const fileIconSpan = fileTitle.createEl('span', { attr: { style: 'margin-right: 8px; opacity: 0.7;' } });
                setIcon(fileIconSpan, 'document'); fileTitle.appendChild(document.createTextNode(file.basename));

                const displayMatches = matches.slice(0, 3);
                for (let match of displayMatches) {
                    const snippetDiv = card.createDiv({ attr: { style: 'font-size: 0.95em; color: var(--text-muted); line-height: 1.5; margin-bottom: 8px; background: var(--background-secondary); padding: 8px 12px; border-radius: 8px;' } });
                    const parts = match.split(new RegExp(`(${safeWord})`, 'gi'));
                    snippetDiv.appendChild(document.createTextNode('"...'));
                    parts.forEach(part => {
                        if (part.toLowerCase() === this.word.toLowerCase()) {
                            snippetDiv.createEl('span', { text: part, attr: { style: 'color: var(--text-normal); background-color: var(--background-modifier-hover); padding: 2px 4px; border-radius: 4px; font-weight: 600; margin: 0 2px;' } });
                        } else { snippetDiv.appendChild(document.createTextNode(part)); }
                    });
                    snippetDiv.appendChild(document.createTextNode('..."'));
                }
            }
        });
    }
    onClose() { this.contentEl.empty(); }
}

class DesktopStatsHeatmapView extends ItemView {
    sphereEngine: WordSphereEngine | null = null;
    
    constructor(leaf: WorkspaceLeaf) { super(leaf); }
    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "拓扑网络"; }
    getIcon() { return "network"; } 

    async onOpen() {
        const container = this.containerEl.children[1]; container.empty();
        container.addClass('stats-heatmap-dashboard-container');

        container.setAttr('style', `
            padding: 8px; display: flex; flex-direction: column; height: 100%; overflow: hidden; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            -webkit-font-smoothing: antialiased; background-color: transparent;
        `);

        const headerDiv = container.createDiv({ 
            attr: { 
                style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 0 4px; flex-shrink: 0; cursor: pointer; opacity: 0.85; transition: opacity 0.2s ease;',
                title: '点击重新构建突触'
            } 
        });
        
        const titleDiv = headerDiv.createDiv({
            attr: { style: 'display: flex; align-items: center; white-space: nowrap;' }
        });
        const iconSpan = titleDiv.createEl('span', { attr: { style: 'width: 16px; height: 16px; color: var(--text-muted); margin-right: 8px; display: flex; align-items: center;' } });
        setIcon(iconSpan, 'network'); 
        
        const titleText = titleDiv.createEl("span", { 
            text: "拓扑网络", 
            attr: { 
                style: 'margin: 0; font-size: 13px; font-weight: 600; color: var(--text-muted); font-family: "SimSun", "STSong", "Songti SC", serif; letter-spacing: 0.5px;' 
            } 
        });
        
        const contentWrapper = container.createDiv({ attr: { style: 'display: flex; flex-direction: column; flex: 1; min-height: 0;' } });
        
        const heatmapDiv = contentWrapper.createDiv({ 
            attr: { style: 'flex: 1; display: flex; justify-content: center; align-items: center; background-color: transparent; overflow: hidden; position: relative;' } 
        });

        const renderData = async () => {
            headerDiv.style.opacity = '0.3';
            titleText.innerText = "构建中...";
            headerDiv.style.pointerEvents = 'none';

            if (this.sphereEngine) this.sphereEngine.destroy();
            heatmapDiv.empty();
            
            const heatmapWords = await analyzeVaultData(this.app);
            const maxWordCount = heatmapWords.length > 0 ? heatmapWords[0].value : 1;

            const containerMinSide = Math.min(heatmapDiv.clientWidth || 250, heatmapDiv.clientHeight || 250);
            const baseRadius = Math.max((containerMinSide / 2) * 0.8, 25); 

            this.sphereEngine = new WordSphereEngine(heatmapDiv, baseRadius);

            heatmapWords.forEach(({word, value, files}) => {
                const wordEl = document.createElement('div');
                wordEl.innerText = word;
                
                const fontSize = Math.max(13, Math.min(28, 13 + (value/maxWordCount)*15));
                const fontWeight = value > maxWordCount * 0.6 ? '700' : '400'; 
                const filePaths = new Set(files.map(f => f.path));

                wordEl.setAttr("style", `
                    font-family: "SimSun", "STSong", "Songti SC", serif;
                    font-size: ${fontSize}px;
                    font-weight: ${fontWeight};
                    letter-spacing: -0.2px;
                    padding: 2px 4px;
                    white-space: nowrap;
                    user-select: none;
                    transition: filter 0.2s, opacity 0.2s, color 0.2s; 
                    transform-origin: center center;
                `);
                
                wordEl.addEventListener('click', () => new WordContextModal(this.app, word, files).open());
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

            headerDiv.style.pointerEvents = 'auto';
            titleText.innerText = "拓扑网络";
            headerDiv.style.opacity = '0.85';
        };

        headerDiv.addEventListener('mouseenter', () => headerDiv.style.opacity = '1');
        headerDiv.addEventListener('mouseleave', () => headerDiv.style.opacity = '0.85');
        headerDiv.addEventListener('click', renderData);
        
        setTimeout(renderData, 200); 
    }

    async onClose() { if (this.sphereEngine) this.sphereEngine.destroy(); }
}

export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS_HEATMAP, (leaf) => new DesktopStatsHeatmapView(leaf));
        this.addRibbonIcon('network', '打开拓扑网络', () => this.activateView());
        this.addCommand({ id: 'open-typographic-insights', name: '打开拓扑网络', callback: () => this.activateView() });
    }
    async onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATS_HEATMAP); }
    
    async activateView() {
        const { workspace } = this.app;
        let existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_STATS_HEATMAP);
        let leaf: WorkspaceLeaf;
        
        if (existingLeaves.length > 0) {
            leaf = existingLeaves[0];
        } else {
            const fileExplorerLeaves = workspace.getLeavesOfType('file-explorer');
            if (fileExplorerLeaves.length > 0) {
                leaf = workspace.createLeafBySplit(fileExplorerLeaves[0], 'horizontal');
            } else {
                leaf = workspace.getLeftLeaf(false) || workspace.getLeaf(false);
            }
            await leaf.setViewState({ type: VIEW_TYPE_STATS_HEATMAP, active: true });
        }
        
        workspace.revealLeaf(leaf);
    }
}
