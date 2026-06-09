import { App, ItemView, Plugin, WorkspaceLeaf, Notice, Modal, TFile, setIcon } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

// --- 终极虚词与学术废料清洗库 ---
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个', '如果是', '怎么', '如果',
    '可以说', '这样', '很多', '非常', '进行', '然后', '可能', '因为', '所以',
    'doi', 'rsc', 'pubs', 'sup', 'crossref', 'crossrefhttps', 'suphttps', 
    'articlelanding', 'span', 'colspan', 'rowspan', 'idx', 'fsw', 'cashttps', 
    'coiresolver', 'pubmed', 'apenergy', 'applthermaleng', 'using', 'these', 
    'cells', 'images', '例如', '问题', '解答', 'pdf', 'pdf文档'
]);

// --- 深度自然语言分词与时间轴引擎 ---
async function analyzeVaultContent(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordData = new Map<string, { count: number, files: Set<TFile>, latestTime: number }>();
    
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    let globalMinTime = Infinity;
    let globalMaxTime = 0;

    for (const file of files) {
        const fileTime = file.stat.mtime; // 取笔记最后修改时间作为新鲜度指标
        const content = await app.vault.cachedRead(file);
        
        const cleanText = content
            .replace(/```[\s\S]*?```/g, ' ') 
            .replace(/---[\s\S]*?---/, ' ')  
            .replace(/<[^>]*>?/gm, ' ')      
            .replace(/https?:\/\/[^\s]+/g, ' ') 
            .replace(/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g, ' ') 
            .replace(/[0-9a-fA-F]{8,}/g, ' ') 
            .replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' '); 

        const segments = segmenter.segment(cleanText);
        for (const { segment, isWordLike } of segments) {
            if (!isWordLike) continue; 
            
            const w = segment.toLowerCase().trim();
            if (STOP_WORDS.has(w)) continue;

            const isChinese = /[\u4e00-\u9fa5]/.test(w);
            if ((isChinese && w.length >= 2) || (!isChinese && w.length >= 3 && w.length <= 20)) {
                if (!wordData.has(w)) {
                    wordData.set(w, { count: 0, files: new Set(), latestTime: 0 });
                }
                const entry = wordData.get(w)!;
                entry.count++;
                entry.files.add(file);
                // 更新该词汇的最高活跃时间
                if (fileTime > entry.latestTime) {
                    entry.latestTime = fileTime;
                }
            }
        }
    }

    // 筛选 Top 75 并计算时间极值，用于色温映射
    const sortedData = Array.from(wordData.entries())
                            .sort((a, b) => b[1].count - a[1].count)
                            .slice(0, 75);

    sortedData.forEach(item => {
        if (item[1].latestTime > globalMaxTime) globalMaxTime = item[1].latestTime;
        if (item[1].latestTime < globalMinTime) globalMinTime = item[1].latestTime;
    });

    return {
        heatmapWords: sortedData.map(([word, data]) => ({ word, value: data.count, files: Array.from(data.files), latestTime: data.latestTime })),
        globalMinTime,
        globalMaxTime
    };
}

// --- 热度色温映射引擎 (Thermal Color Mapping) ---
function getThermalColors(value: number, maxVal: number, latestTime: number, minTime: number, maxTime: number) {
    const opacity = 0.45 + (Math.min(value / maxVal, 1) * 0.55);
    let freshness = 0.5;
    if (maxTime > minTime) {
        freshness = (latestTime - minTime) / (maxTime - minTime);
    }

    // 0.0 -> 沉淀资产 -> 深靛蓝 Indigo (88, 86, 214)
    // 0.5 -> 核心常态 -> 经典蓝 Apple Blue (0, 122, 255)
    // 1.0 -> 最新焦点 -> 青冰色 Cyan (50, 173, 230)
    let r, g, b;
    if (freshness < 0.5) {
        const t = freshness * 2; 
        r = Math.round(88 + (0 - 88) * t);
        g = Math.round(86 + (122 - 86) * t);
        b = Math.round(214 + (255 - 214) * t);
    } else {
        const t = (freshness - 0.5) * 2; 
        r = Math.round(0 + (50 - 0) * t);
        g = Math.round(122 + (173 - 122) * t);
        b = Math.round(255 + (230 - 255) * t);
    }
    
    return {
        colorBase: `rgba(${r}, ${g}, ${b}, ${opacity})`,
        colorHover: `rgba(${r}, ${g}, ${b}, 1)`, // 满透明度用于高亮
        glowColor: `rgba(${r}, ${g}, ${b}, 0.35)`
    };
}

// --- 上下文溯源 Modal (保持优雅秒开) ---
class WordContextModal extends Modal {
    word: string;
    files: TFile[];

    constructor(app: App, word: string, files: TFile[]) {
        super(app);
        this.word = word;
        this.files = files;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        this.modalEl.style.maxWidth = '800px';
        this.modalEl.style.width = '90vw';
        this.modalEl.style.borderRadius = '20px';
        this.modalEl.style.padding = '32px 40px';
        this.modalEl.style.boxShadow = '0 20px 40px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05)';
        this.modalEl.style.border = '1px solid var(--background-modifier-border)';

        contentEl.createEl('h2', { 
            text: `「${this.word}」`,
            attr: { style: 'margin: 0 0 8px 0; font-size: 28px; font-weight: 700; color: var(--interactive-accent); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif; letter-spacing: -0.02em;' }
        });
        contentEl.createEl('p', {
            text: `核心正文共在 ${this.files.length} 篇笔记中被提及：`,
            attr: { style: 'margin: 0 0 24px 0; color: var(--text-muted); font-size: 15px; font-weight: 500;' }
        });

        const listContainer = contentEl.createDiv({
            attr: { style: 'max-height: 60vh; overflow-y: auto; padding-right: 12px; display: flex; flex-direction: column; gap: 16px;' }
        });

        this.files.forEach(async (file) => {
            const card = listContainer.createDiv({
                attr: { style: 'background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s ease;' }
            });
            
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = 'var(--interactive-accent)';
                card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.05)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.borderColor = 'var(--background-modifier-border)';
                card.style.boxShadow = 'none';
            });

            card.addEventListener('click', async () => {
                const leaf = this.app.workspace.getLeaf(false);
                await leaf.openFile(file);
                this.close(); 
            });

            const fileTitle = card.createEl('div', {
                attr: { style: 'font-weight: 600; font-size: 16px; color: var(--text-normal); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif; display: flex; align-items: center;' }
            });
            const fileIconSpan = fileTitle.createEl('span', { attr: { style: 'margin-right: 8px; opacity: 0.6; display: flex; align-items: center;' } });
            setIcon(fileIconSpan, 'file-text');
            fileTitle.appendChild(document.createTextNode(file.basename));

            const rawContent = await this.app.vault.cachedRead(file);
            const content = rawContent.replace(/\s+/g, ' '); 
            
            const safeWord = this.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
            const regex = new RegExp(`.{0,40}${safeWord}.{0,40}`, 'gi');
            const matches = content.match(regex) || [];

            if (matches.length > 0) {
                const snippetWrapper = card.createDiv({ attr: { style: 'margin-top: 12px; display: flex; flex-direction: column; gap: 8px;' } });
                const displayMatches = matches.slice(0, 2); 

                for (let match of displayMatches) {
                    const snippetDiv = snippetWrapper.createDiv({ attr: { style: 'font-size: 14px; color: var(--text-muted); line-height: 1.5; background: var(--background-secondary); padding: 10px 14px; border-radius: 8px;' } });
                    
                    const parts = match.split(new RegExp(`(${safeWord})`, 'gi'));
                    snippetDiv.appendChild(document.createTextNode('"...'));
                    parts.forEach(part => {
                        if (part.toLowerCase() === this.word.toLowerCase()) {
                            snippetDiv.createEl('span', { text: part, attr: { style: 'color: var(--interactive-accent); font-weight: 600; background: rgba(0, 122, 255, 0.1); padding: 2px 4px; border-radius: 4px;' } });
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
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "知识洞察"; }
    getIcon() { return "key"; } 

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-typographic-dashboard');

        container.setAttr('style', `
            padding: 32px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
            -webkit-font-smoothing: antialiased;
            background-color: var(--background-secondary);
        `);

        const headerDiv = container.createDiv({ 
            attr: { 
                style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-shrink: 0; cursor: pointer; user-select: none; opacity: 0.9; transition: opacity 0.2s ease;',
                title: '点击重新深入扫描核心正文'
            } 
        });
        
        const titleDiv = headerDiv.createDiv({
            attr: { style: 'display: flex; align-items: center; white-space: nowrap;' }
        });
        const iconSpan = titleDiv.createEl('span', { attr: { style: 'width: 24px; height: 24px; color: var(--interactive-accent); margin-right: 12px; display: flex; align-items: center;' } });
        setIcon(iconSpan, 'activity'); 
        
        const titleText = titleDiv.createEl("h1", { 
            text: "Knowledge Insights", 
            attr: { 
                style: 'margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-normal); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif;' 
            } 
        });

        const startScanning = async () => {
            headerDiv.style.opacity = '0.4';
            titleText.innerText = "Scanning Brain...";
            headerDiv.style.pointerEvents = 'none';
            await this.renderWords();
            headerDiv.style.pointerEvents = 'auto';
            titleText.innerText = "Knowledge Insights";
            headerDiv.style.opacity = '0.9';
        }
        
        headerDiv.addEventListener('mouseenter', () => headerDiv.style.opacity = '1');
        headerDiv.addEventListener('mouseleave', () => headerDiv.style.opacity = '0.9');
        headerDiv.addEventListener('click', startScanning);

        this.wordsCanvas = container.createDiv({ 
            attr: { 
                style: 'display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: center; align-content: flex-start; align-items: baseline; background-color: var(--background-primary); border-radius: 24px; padding: 40px; box-shadow: 0 8px 24px rgba(0,0,0,0.03), 0 2px 8px rgba(0,0,0,0.02); flex: 1; position: relative;' 
            } 
        });

        await this.renderWords();
    }

    async renderWords() {
        if (!this.wordsCanvas) return;
        this.wordsCanvas.empty();
        
        const { heatmapWords, globalMinTime, globalMaxTime } = await analyzeVaultContent(this.app);

        if (heatmapWords.length === 0) {
            this.wordsCanvas.createEl("div", { text: "暂无有效术语积累", attr: { style: 'color: var(--text-muted); font-size: 14px;' } });
            return;
        }

        const maxWordCount = heatmapWords[0].value;
        const domNodes: any[] = [];

        // 第一次循环：生成 DOM 与原始样式，并存入数组以便交互联动
        heatmapWords.forEach(({word, value, files, latestTime}) => {
            const wordEl = this.wordsCanvas.createDiv();
            wordEl.setText(word);
            
            // 计算热度色温
            const { colorBase, colorHover, glowColor } = getThermalColors(value, maxWordCount, latestTime, globalMinTime, globalMaxTime);
            const fontSize = Math.max(14, Math.min(46, 14 + (value/maxWordCount)*32));
            const fontWeight = value > maxWordCount * 0.6 ? '700' : (value > maxWordCount * 0.3 ? '600' : '500');
            
            wordEl.setAttr("style", `
                color: ${colorBase}; 
                font-size: ${fontSize}px;
                font-weight: ${fontWeight};
                cursor: pointer;
                transition: all 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
                line-height: 1.1;
                user-select: none;
                letter-spacing: -0.01em;
                white-space: nowrap; 
            `);
            
            domNodes.push({ 
                el: wordEl, 
                files: new Set(files.map(f => f.path)), 
                colorBase, 
                colorHover,
                glowColor,
                word
            });

            wordEl.addEventListener('click', () => {
                new WordContextModal(this.app, word, files).open();
            });
        });

        // 核心交互：神经元共现聚光灯联动
        domNodes.forEach(node => {
            node.el.addEventListener('mouseenter', () => {
                const targetFiles = node.files;
                
                domNodes.forEach(other => {
                    let isCoOccurring = false;
                    for (let p of other.files) {
                        if (targetFiles.has(p)) {
                            isCoOccurring = true;
                            break;
                        }
                    }

                    if (other === node) {
                        // 当前悬停的词：最大化发光
                        other.el.style.transform = 'scale(1.1) translateY(-4px)';
                        other.el.style.color = other.colorHover;
                        other.el.style.opacity = '1';
                        other.el.style.textShadow = `0 12px 24px ${other.glowColor}`;
                    } else if (isCoOccurring) {
                        // 共现词汇（神经元联动）：微微浮起并亮起
                        other.el.style.transform = 'scale(1.03)';
                        other.el.style.color = other.colorHover;
                        other.el.style.opacity = '0.85';
                        other.el.style.textShadow = '0 4px 12px rgba(0,0,0,0.06)';
                    } else {
                        // 无关词汇：深海级暗淡
                        other.el.style.transform = 'scale(0.96)';
                        other.el.style.opacity = '0.12';
                        other.el.style.textShadow = 'none';
                        other.el.style.filter = 'grayscale(0.5)';
                    }
                });
            });

            node.el.addEventListener('mouseleave', () => {
                // 鼠标移出，全部恢复原本的色温与透明度
                domNodes.forEach(other => {
                    other.el.style.transform = 'scale(1) translateY(0)';
                    other.el.style.color = other.colorBase;
                    other.el.style.opacity = '1'; // 基础透明度包含在 colorBase 中
                    other.el.style.textShadow = 'none';
                    other.el.style.filter = 'none';
                });
            });
        });
    }
}

export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS_HEATMAP, (leaf) => new DesktopStatsHeatmapView(leaf));
        this.addRibbonIcon('key', '打开知识洞察', () => this.activateView());
        this.addCommand({
            id: 'open-typographic-insights',
            name: '打开知识洞察',
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
