import { App, ItemView, Plugin, WorkspaceLeaf, Notice } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

// --- 基础虚词过滤库 ---
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过'
]);

// --- 极简数据分析引擎 (仅提纯词汇，性能翻倍) ---
async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordCounts = new Map<string, number>();

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
                wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
            }
        }
    }

    return Array.from(wordCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 100) // 取 Top 100 核心概念
                .map(([word, value]) => ({ word, value }));
}

// --- 纯粹印刷体颜色引擎 ---
function getTextOpacity(value: number, max: number): number {
    const ratio = Math.min(value / max, 1);
    // 透明度从 0.35 到 1.0 平滑过渡，确保深浅层次分明
    return 0.35 + (ratio * 0.65); 
}

// --- 桌面端视图 ---
class DesktopStatsHeatmapView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "知识洞察"; }
    getIcon() { return "key"; } // 更换为更具洞察意味的钥匙图标

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-typographic-dashboard');

        // 全局容器：极简、去边框、通透
        container.setAttr('style', `
            padding: 32px 40px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif;
            -webkit-font-smoothing: antialiased;
            background-color: var(--background-secondary);
        `);

        // 极简顶部操作栏
        const headerDiv = container.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; flex-shrink: 0;' } });
        headerDiv.createEl("h1", { text: "Knowledge Insights", attr: { style: 'margin: 0; font-size: 2em; font-weight: 700; letter-spacing: -0.8px; color: var(--text-normal);' } });
        const refreshBtn = headerDiv.createEl("button", { text: "重新扫描神经元", attr: { style: 'padding: 8px 20px; cursor: pointer; background-color: var(--interactive-accent); color: var(--text-on-accent); border-radius: 24px; border: none; font-size: 0.9em; font-weight: 500; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 4px 12px rgba(0, 122, 255, 0.2);' } });
        
        refreshBtn.addEventListener('mouseenter', () => refreshBtn.style.transform = 'translateY(-2px)');
        refreshBtn.addEventListener('mouseleave', () => refreshBtn.style.transform = 'translateY(0)');

        // 核心画板：一张巨大的、带有深邃阴影的大圆角白色画布
        const wordsCanvas = container.createDiv({ 
            attr: { style: 'display: flex; flex-wrap: wrap; gap: 16px 28px; justify-content: center; align-content: center; align-items: center; background-color: var(--background-primary); border-radius: 24px; padding: 48px; box-shadow: 0 12px 40px rgba(0,0,0,0.04), 0 2px 12px rgba(0,0,0,0.02); flex: 1;' } 
        });

        const renderData = async () => {
            refreshBtn.innerText = "扫描中...";
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = '0.6';
            wordsCanvas.empty();
            
            const heatmapWords = await analyzeVaultData(this.app);

            if (heatmapWords.length === 0) {
                wordsCanvas.createEl("div", { text: "暂无足够的数据积累...", attr: { style: 'color: var(--text-muted); font-size: 1.2em;' } });
                return;
            }

            const maxWordCount = heatmapWords[0].value;

            // 渲染纯粹印刷体艺术热力词
            heatmapWords.forEach(({word, value}) => {
                const wordEl = wordsCanvas.createDiv();
                wordEl.setText(word);
                
                const opacity = getTextOpacity(value, maxWordCount);
                // 极致的字号对比度：14px -> 48px
                const fontSize = Math.max(14, Math.min(48, 12 + (value/maxWordCount)*36));
                // 字重对比：高频词极粗，低频词轻盈
                const fontWeight = value > maxWordCount * 0.5 ? '800' : (value > maxWordCount * 0.2 ? '600' : '400');
                
                wordEl.setAttr("style", `
                    color: rgba(0, 122, 255, ${opacity}); 
                    font-size: ${fontSize}px;
                    font-weight: ${fontWeight};
                    cursor: pointer;
                    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    line-height: 1;
                    user-select: none;
                    letter-spacing: -0.5px;
                `);
                
                wordEl.addEventListener('mouseenter', () => {
                    // 悬浮时：轻巧起跳，散发纯净蓝光
                    wordEl.style.transform = 'scale(1.15) translateY(-4px)';
                    wordEl.style.color = 'rgba(0, 122, 255, 1)';
                    wordEl.style.textShadow = `0 12px 24px rgba(0, 122, 255, 0.4)`;
                    new Notice(`「${word}」共出现 ${value} 次`);
                });
                
                wordEl.addEventListener('mouseleave', () => {
                    wordEl.style.transform = 'scale(1) translateY(0)';
                    wordEl.style.color = `rgba(0, 122, 255, ${opacity})`;
                    wordEl.style.textShadow = 'none';
                });
            });

            refreshBtn.innerText = "重新扫描";
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
        };

        refreshBtn.addEventListener('click', renderData);
        setTimeout(renderData, 100); 
    }
}

// --- 插件主入口 ---
export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS_HEATMAP, (leaf) => new DesktopStatsHeatmapView(leaf));
        
        this.addRibbonIcon('key', '打开知识洞察', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-typographic-insights',
            name: '打开知识洞察',
            callback: () => {
                this.activateView();
            }
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
