import { App, ItemView, Plugin, WorkspaceLeaf, Notice, Modal, TFile, setIcon } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

// --- 深度清洗过滤库 ---
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个', '如果是', '怎么', '如果',
    '可以说', '这样', '很多', '非常', '进行', '然后', '可能', '因为', '所以',
    '各位', '谢谢', '由于', '其实', '只要', '目前', '开始'
]);

// --- 进阶版 3D 星系引擎 (加入 Z 轴高级景深算法) ---
class WordSphereEngine {
    container: HTMLElement;
    radius: number;
    tags: { el: HTMLElement, x: number, y: number, z: number, theta: number, phi: number, baseFontSize: number, baseWeight: string }[] = [];
    isStopped = false;
    isHoveringNode = false; // 是否正在悬停某个节点（用于接管接管景深）
    mouseX = 0;
    mouseY = 0;
    lastMouseX = 0;
    lastMouseY = 0;
    damping = 0.95; 
    animationFrameId: number;
    isActive = true;

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        this.setupMouseListeners();
    }

    addTag(tagEl: HTMLElement, baseFontSize: number, baseWeight: string) {
        tagEl.style.position = 'absolute';
        tagEl.style.cursor = 'pointer';
        tagEl.style.willChange = 'transform, opacity, filter';
        
        const count = this.tags.length;
        // 菲波那契球面算法
        const offset = 2 / 50; 
        const increment = Math.PI * (3 - Math.sqrt(5));
        const y = ((count * offset) - 1) + (offset / 2);
        const r = Math.sqrt(1 - y * y);
        const phi = (count % 50) * increment;
        
        this.tags.push({
            el: tagEl,
            x: Math.cos(phi) * r * this.radius,
            y: y * this.radius,
            z: Math.sin(phi) * r * this.radius,
            theta: Math.atan2(Math.sin(phi) * r * this.radius, Math.cos(phi) * r * this.radius),
            phi: Math.acos(y),
            baseFontSize,
            baseWeight
        });
        
        this.container.appendChild(tagEl);
    }

    private setupMouseListeners() {
        this.container.addEventListener('mousemove', (e) => {
            const rect = this.container.getBoundingClientRect();
            this.mouseX = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
            this.mouseY = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
        });
        
        this.container.addEventListener('mouseenter', () => this.isStopped = false);
        this.container.addEventListener('mouseleave', () => this.isStopped = true);
    }

    startAnimation() {
        if (this.tags.length === 0) return;
        
        let targetRotationX = 0;
        let targetRotationY = 0;
        let currentRotationX = 0;
        let currentRotationY = 0;

        this.container.addEventListener('mousemove', () => {
            targetRotationY += (this.mouseX - this.lastMouseX) * 0.08;
            targetRotationX += (this.mouseY - this.lastMouseY) * 0.08;
            this.lastMouseX = this.mouseX;
            this.lastMouseY = this.mouseY;
        });

        const animate = () => {
            if (!this.isActive) return;

            let baseSpeedX = 0.001; 
            let baseSpeedY = 0.0015;

            if (!this.isStopped && !this.isHoveringNode) {
                currentRotationX += (targetRotationX - currentRotationX) * 0.05;
                currentRotationY += (targetRotationY - currentRotationY) * 0.05;
                targetRotationX *= this.damping;
                targetRotationY *= this.damping;
                baseSpeedX += currentRotationX;
                baseSpeedY += currentRotationY;
            }

            this.tags.forEach(tag => {
                // 三维坐标旋转变换
                if (!this.isHoveringNode) {
                    const x1 = tag.x * Math.cos(baseSpeedY) - tag.z * Math.sin(baseSpeedY);
                    const z1 = tag.z * Math.cos(baseSpeedY) + tag.x * Math.sin(baseSpeedY);
                    const y1 = tag.y * Math.cos(baseSpeedX) - z1 * Math.sin(baseSpeedX);
                    const z2 = z1 * Math.cos(baseSpeedX) + tag.y * Math.sin(baseSpeedX);
                    tag.x = x1; tag.y = y1; tag.z = z2;
                }

                // =========================================================
                // 核心修复：极致的 Z 轴景深算法 (Depth of Field) 解决重叠不可读问题
                // =========================================================
                if (!this.isHoveringNode) {
                    const zRatio = tag.z / this.radius; // 值域: -1 (最背面) 到 1 (最前面)
                    
                    let opacity = 0;
                    let blur = 0;
                    
                    if (zRatio > 0.4) {
                        // 【前层 30%】：完全清晰，100% 不透明
                        opacity = 1;
                        blur = 0;
                        tag.el.style.color = 'var(--interactive-accent)'; // 正面用亮色
                    } else if (zRatio > 0) {
                        // 【中层】：平滑衰减，产生空间透视感
                        opacity = 0.4 + 0.6 * (zRatio / 0.4);
                        blur = 0;
                        tag.el.style.color = 'var(--text-normal)'; // 中间用常态色
                    } else {
                        // 【后半球】：极度暗淡，并加入高斯模糊，彻底沦为背景
                        opacity = 0.05 + 0.15 * ((zRatio + 1) / 1); // 5% 到 20%
                        blur = Math.min(3, Math.abs(zRatio) * 3); // 背面最深处模糊 3px
                        tag.el.style.color = 'var(--text-muted)';
                    }

                    // 三维透视缩放比例
                    const scale = (this.radius + tag.z) / (2 * this.radius); 
                    const finalScale = 0.6 + 0.6 * scale; 

                    tag.el.style.transform = `translate3d(${tag.x}px, ${tag.y}px, 0px) scale(${finalScale})`;
                    tag.el.style.opacity = opacity.toString();
                    tag.el.style.filter = `blur(${blur}px)`;
                    tag.el.style.zIndex = Math.round(tag.z + this.radius).toString();
                }
            });

            this.animationFrameId = requestAnimationFrame(animate);
        };

        animate();
    }

    destroy() {
        this.isActive = false;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    }
}

// --- 数据分析引擎 ---
async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordData = new Map<string, { count: number, files: Set<TFile> }>();

    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        const cleanText = content
            .replace(/```[\s\S]*?```/g, '') 
            .replace(/---[\s\S]*?---/, '')  
            .replace(/[#*`>\[\]()]/g, '');  

        const words = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{3,}\b/g) || [];
        for (const word of words) {
            const w = word.toLowerCase();
            if (!STOP_WORDS.has(w)) {
                if (!wordData.has(w)) { wordData.set(w, { count: 0, files: new Set() }); }
                const entry = wordData.get(w)!;
                entry.count++;
                entry.files.add(file);
            }
        }
    }

    return Array.from(wordData.entries())
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 48) // 保持 48 个核心节点，避免球体拥挤
                .map(([word, data]) => ({ word, value: data.count, files: Array.from(data.files) }));
}

// --- 沉浸式上下文溯源 Modal ---
class WordContextModal extends Modal {
    word: string;
    files: TFile[];

    constructor(app: App, word: string, files: TFile[]) {
        super(app);
        this.word = word;
        this.files = files;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        this.modalEl.style.maxWidth = '850px';
        this.modalEl.style.width = '90vw';
        this.modalEl.style.borderRadius = '24px';
        this.modalEl.style.padding = '40px';
        this.modalEl.style.boxShadow = '0 24px 60px rgba(0,0,0,0.06)';

        contentEl.createEl('h2', { 
            text: `「${this.word}」`,
            attr: { style: 'margin: 0 0 10px 0; font-size: 2em; font-weight: 850; color: var(--interactive-accent); font-family: "SF Pro Display", "PingFang SC", sans-serif; letter-spacing: -0.5px;' }
        });
        contentEl.createEl('p', {
            text: `在 ${this.files.length} 篇笔记的正文中被提及：`,
            attr: { style: 'margin: 0 0 28px 0; color: var(--text-muted); font-size: 1.1em;' }
        });

        const listContainer = contentEl.createDiv({
            attr: { style: 'max-height: 62vh; overflow-y: auto; padding-right: 15px; display: flex; flex-direction: column; gap: 20px;' }
        });

        this.files.forEach(async (file) => {
            const content = await this.app.vault.cachedRead(file);
            const rawContent = content.replace(/\s+/g, ' '); 
            const safeWord = this.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
            const regex = new RegExp(`.{0,45}${safeWord}.{0,45}`, 'gi');
            const matches = rawContent.match(regex) || [];

            if (matches.length > 0) {
                const card = listContainer.createDiv({
                    attr: { style: 'background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 16px; padding: 20px; cursor: pointer; transition: all 0.2s ease;' }
                });
                
                card.addEventListener('mouseenter', () => {
                    card.style.borderColor = 'var(--interactive-accent)';
                    card.style.transform = 'translateY(-3px)';
                    card.style.boxShadow = '0 12px 24px rgba(0, 0, 0, 0.04)';
                });
                card.addEventListener('mouseleave', () => {
                    card.style.borderColor = 'var(--background-modifier-border)';
                    card.style.transform = 'translateY(0)';
                    card.style.boxShadow = 'none';
                });

                card.addEventListener('click', async () => {
                    const leaf = this.app.workspace.getLeaf(false);
                    await leaf.openFile(file);
                    this.close(); 
                });

                const fileTitle = card.createEl('div', {
                    attr: { style: 'font-weight: 800; font-size: 1.25em; margin-bottom: 16px; color: var(--text-normal); font-family: "SF Pro Text", "PingFang SC", sans-serif; display: flex; align-items: center;' }
                });
                const fileIconSpan = fileTitle.createEl('span', { attr: { style: 'margin-right: 8px; opacity: 0.7;' } });
                setIcon(fileIconSpan, 'document');
                fileTitle.appendChild(document.createTextNode(file.basename));

                const displayMatches = matches.slice(0, 3);
                for (let match of displayMatches) {
                    const snippetDiv = card.createDiv({ attr: { style: 'font-size: 1em; color: var(--text-muted); line-height: 1.6; margin-bottom: 12px; background: var(--background-primary); padding: 10px 16px; border-radius: 10px;' } });
                    const parts = match.split(new RegExp(`(${safeWord})`, 'gi'));
                    snippetDiv.appendChild(document.createTextNode('"...'));
                    parts.forEach(part => {
                        if (part.toLowerCase() === this.word.toLowerCase()) {
                            snippetDiv.createEl('span', { text: part, attr: { style: 'color: #fff; background-color: var(--interactive-accent); padding: 2px 6px; border-radius: 6px; font-weight: bold; margin: 0 2px;' } });
                        } else {
                            snippetDiv.appendChild(document.createTextNode(part));
                        }
                    });
                    snippetDiv.appendChild(document.createTextNode('..."'));
                }
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- 桌面端视图 ---
class DesktopStatsHeatmapView extends ItemView {
    sphereEngine: WordSphereEngine | null = null;
    
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "知识资产热力全景"; }
    getIcon() { return "activity"; } 

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-heatmap-dashboard-container');

        container.setAttr('style', `
            padding: 40px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
            -webkit-font-smoothing: antialiased;
            background-color: var(--background-secondary);
        `);

        const headerDiv = container.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; flex-shrink: 0;' } });
        headerDiv.createEl("h2", { text: "知识资产热力全景", attr: { style: 'margin: 0; font-size: 1.7em; font-weight: 800; letter-spacing: -0.5px;' } });
        const refreshBtn = headerDiv.createEl("button", { text: "重新扫描神经元", attr: { style: 'padding: 8px 20px; cursor: pointer; background-color: var(--interactive-accent); color: var(--text-on-accent); border-radius: 20px; border: none; font-size: 0.9em; font-weight: 500;' } });
        
        const contentWrapper = container.createDiv({ attr: { style: 'display: flex; flex-direction: column; flex: 1; min-height: 0;' } });

        const heatmapDiv = contentWrapper.createDiv({ 
            attr: { style: 'flex: 1; display: flex; justify-content: center; align-items: center; background-color: var(--background-primary); border-radius: 24px; box-shadow: 0 16px 48px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02); overflow: hidden;' } 
        });
        
        const sphereCanvas = heatmapDiv.createDiv({ 
            attr: { style: 'width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; position: relative;' } 
        });

        const renderData = async () => {
            refreshBtn.innerText = "神经元捕捉中...";
            refreshBtn.disabled = true;
            if (this.sphereEngine) {
                this.sphereEngine.destroy();
            }
            sphereCanvas.empty();
            
            const heatmapWords = await analyzeVaultData(this.app);
            const maxWordCount = heatmapWords.length > 0 ? heatmapWords[0].value : 1;

            // 核心修复：防止容器未渲染完成导致半径过小（挤成一团）
            // 采用动态计算并设置一个绝对保底半径 180px
            const containerMinSide = Math.min(heatmapDiv.clientWidth || 500, heatmapDiv.clientHeight || 500);
            const baseRadius = Math.max((containerMinSide / 2) * 0.75, 180);

            this.sphereEngine = new WordSphereEngine(sphereCanvas, baseRadius);
            const domNodes: any[] = [];

            heatmapWords.forEach(({word, value, files}) => {
                const wordEl = document.createElement('div');
                wordEl.innerText = word;
                
                const fontSize = Math.max(14, Math.min(56, 14 + (value/maxWordCount)*42));
                const fontWeight = value > maxWordCount * 0.6 ? '850' : (value > maxWordCount * 0.3 ? '700' : '500');
                
                wordEl.setAttr("style", `
                    font-size: ${fontSize}px;
                    font-weight: ${fontWeight};
                    letter-spacing: -0.5px;
                    padding: 4px 8px;
                    white-space: nowrap;
                    user-select: none;
                    transition: transform 0.2s, opacity 0.2s, color 0.2s, filter 0.2s;
                    transform-origin: center center;
                `);
                
                wordEl.addEventListener('click', () => {
                    new WordContextModal(this.app, word, files).open();
                });

                domNodes.push({ el: wordEl, files: new Set(files.map(f => f.path)) });
                this.sphereEngine!.addTag(wordEl, fontSize, fontWeight);
            });

            // 聚光灯与关系网络显影联动
            domNodes.forEach(node => {
                node.el.addEventListener('mouseenter', () => {
                    if(!this.sphereEngine) return;
                    this.sphereEngine.isHoveringNode = true; // 接管渲染样式
                    const targetFiles = node.files;
                    
                    domNodes.forEach(other => {
                        let isCoOccurring = false;
                        for (let p of other.files) {
                            if (targetFiles.has(p)) { isCoOccurring = true; break; }
                        }

                        if (other === node) {
                            // 悬停目标：绝对置顶，解除模糊，发光放大
                            other.el.style.opacity = '1';
                            other.el.style.filter = 'blur(0px)';
                            other.el.style.transform = `${other.el.style.transform.split(' scale')[0]} scale(1.3)`;
                            other.el.style.zIndex = '99999';
                            other.el.style.color = 'var(--interactive-accent)';
                            other.el.style.textShadow = '0 12px 24px rgba(0, 122, 255, 0.4)';
                        } else if (isCoOccurring) {
                            // 关联节点：提亮，解除模糊
                            other.el.style.opacity = '0.9';
                            other.el.style.filter = 'blur(0px)';
                            other.el.style.color = 'var(--text-normal)';
                            other.el.style.textShadow = 'none';
                        } else {
                            // 无关节点：极度虚化，透明度降至极低
                            other.el.style.opacity = '0.05';
                            other.el.style.filter = `blur(8px)`;
                            other.el.style.color = 'var(--text-muted)';
                            other.el.style.textShadow = 'none';
                        }
                    });
                });
                
                node.el.addEventListener('mouseleave', () => {
                    if(!this.sphereEngine) return;
                    this.sphereEngine.isHoveringNode = false; // 交还给 3D 引擎循环
                    domNodes.forEach(other => {
                        other.el.style.textShadow = 'none';
                    });
                });
            });

            this.sphereEngine.startAnimation();
            refreshBtn.innerText = "重新扫描神经元";
            refreshBtn.disabled = false;
        };

        refreshBtn.addEventListener('click', renderData);
        setTimeout(renderData, 200); 
    }

    async onClose() {
        if (this.sphereEngine) {
            this.sphereEngine.destroy();
        }
    }
}

// --- 插件主入口 ---
export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS_HEATMAP, (leaf) => new DesktopStatsHeatmapView(leaf));
        this.addRibbonIcon('activity', '打开知识资产热力全景', () => this.activateView());
        this.addCommand({
            id: 'open-heatmap-dashboard',
            name: '打开知识资产热力全景',
            callback: () => this.activateView()
        });
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATS_HEATMAP);
    }

    async activateView() {
        const { workspace } = this.app;
        let existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_STATS_HEATMAP);
        for (let i = 0; i < existingLeaves.length; i++) {
            existingLeaves[i].detach(); 
        }

        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_STATS_HEATMAP, active: true });
            workspace.revealLeaf(leaf);
        }
    }
}
