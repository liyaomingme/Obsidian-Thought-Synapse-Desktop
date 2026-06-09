import { App, ItemView, Plugin, WorkspaceLeaf, Notice } from 'obsidian';

const VIEW_TYPE_STATS_HEATMAP = "desktop-stats-heatmap-view";

// --- 基础虚词过滤库 ---
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some'
]);

// --- 日期解析引擎 ---
function parseMessyDate(dateStr: string): string | null {
    const cleanStr = dateStr.replace(/[^\d./-]/g, '');
    let match = cleanStr.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (match) return formatStandardDate(match[1], match[2], match[3]);
    match = cleanStr.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) return formatStandardDate(match[1], match[2], match[3]);
    match = cleanStr.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (match) return formatStandardDate(`20${match[1]}`, match[2], match[3]);
    match = cleanStr.match(/^(\d{2})(\d{1})(\d{1})$/);
    if (match) return formatStandardDate(`20${match[1]}`, match[2], match[3]);
    match = cleanStr.match(/^(\d{2})(\d{1,2})(\d{1,2})$/);
    if (match && cleanStr.length === 5) {
        const monthDouble = parseInt(cleanStr.substring(2, 4));
        if (monthDouble >= 10 && monthDouble <= 12) {
            return formatStandardDate(`20${match[1]}`, cleanStr.substring(2, 4), cleanStr.substring(4, 5));
        }
        return formatStandardDate(`20${match[1]}`, cleanStr.substring(2, 3), cleanStr.substring(3, 5));
    }
    return null; 
}

function formatStandardDate(year: string, month: string, day: string): string {
    const y = year.length === 2 ? `20${year}` : year;
    const m = month.padStart(2, '0');
    const d = day.padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- 数据分析引擎 ---
async function analyzeVaultData(app: App) {
    const files = app.vault.getMarkdownFiles();
    const wordCounts = new Map<string, number>();
    const dateTrend = new Map<string, number>(); 

    for (const file of files) {
        let noteDateStr = parseMessyDate(file.basename);
        if (!noteDateStr) {
            const createTime = new Date(file.stat.ctime);
            noteDateStr = createTime.toISOString().split('T')[0];
        }
        dateTrend.set(noteDateStr, (dateTrend.get(noteDateStr) || 0) + 1);

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

    return {
        heatmapWords: Array.from(wordCounts.entries())
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 100)
                            .map(([word, value]) => ({ word, value })),
        dateTrend: dateTrend
    };
}

// --- 手写 Apple 原生蓝色系颜色插值引擎 ---
function getHeatmapColor(value: number, max: number): string {
    if (value === 0) {
        return 'rgba(var(--text-muted-rgb), 0.08)'; 
    }
    const ratio = Math.min(value / max, 1);
    const opacity = 0.25 + (ratio * 0.75); 
    return `rgba(0, 122, 255, ${opacity})`;
}

// --- 桌面端视图 ---
class DesktopStatsHeatmapView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "知识资产热力"; }
    getIcon() { return "calendar-days"; } 

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-heatmap-dashboard-container');

        // 应用高分辨率全屏铺满 CSS，开启 Y 轴滚动条以容纳两大板块
        container.setAttr('style', `
            padding: 20px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            -webkit-font-smoothing: antialiased;
        `);

        // 顶部导航栏
        const headerDiv = container.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 15px; flex-shrink: 0;' } });
        headerDiv.createEl("h2", { text: "知识资产全景热力", attr: { style: 'margin: 0; font-size: 1.4em; font-weight: 600;' } });
        const refreshBtn = headerDiv.createEl("button", { text: "重新抓取", attr: { style: 'padding: 6px 14px; cursor: pointer; background-color: var(--interactive-accent); color: var(--text-on-accent); border-radius: 6px; border: none; font-size: 0.9em;' } });
        
        // 核心内容区：采用 Flex Column 纵向排版两大模块
        const contentWrapper = container.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 24px; flex: 1;' } });

        // --- 模块 1：近一年产出活跃度 (网格) ---
        const heatmapDiv = contentWrapper.createDiv({ 
            attr: { style: 'display: flex; flex-direction: column; background-color: var(--background-primary-alt); border: 1px solid var(--background-modifier-border); border-radius: 12px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);' } 
        });
        heatmapDiv.createEl("h3", { text: "近一年产出活跃度", attr: { style: 'margin: 0 0 16px 0; font-size: 1.05em; color: var(--text-muted); text-align: center; font-weight: 500;' } });
        const heatmapWrapper = heatmapDiv.createDiv({ 
            attr: { style: 'display: flex; gap: 4px; overflow-x: auto; padding-bottom: 8px; width: 100%; align-items: center; justify-content: flex-start;' } 
        });

        // --- 模块 2：核心概念热力矩阵 (词汇胶囊) ---
        const wordsDiv = contentWrapper.createDiv({ 
            attr: { style: 'display: flex; flex-direction: column; background-color: var(--background-primary-alt); border: 1px solid var(--background-modifier-border); border-radius: 12px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); flex: 1;' } 
        });
        wordsDiv.createEl("h3", { text: "核心概念热力矩阵", attr: { style: 'margin: 0 0 16px 0; font-size: 1.05em; color: var(--text-muted); text-align: center; font-weight: 500;' } });
        const wordsWrapper = wordsDiv.createDiv({ 
            attr: { style: 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-content: flex-start;' } 
        });

        const renderData = async () => {
            refreshBtn.innerText = "数据计算中...";
            refreshBtn.disabled = true;
            heatmapWrapper.empty();
            wordsWrapper.empty();
            
            const { heatmapWords, dateTrend } = await analyzeVaultData(this.app);

            // ==========================================
            // 渲染模块 1：网格热力图
            // ==========================================
            const endDate = new Date();
            const startDate = new Date();
            startDate.setFullYear(endDate.getFullYear() - 1); 
            startDate.setDate(startDate.getDate() - startDate.getDay()); 

            const weeks: {date: string, count: number}[][] = [];
            let currentWeek: {date: string, count: number}[] = [];
            let currDate = new Date(startDate);
            let maxGridCount = 1;

            for (const [_, count] of dateTrend.entries()) {
                if (count > maxGridCount) maxGridCount = count;
            }

            while (currDate <= endDate) {
                const dateStr = currDate.toISOString().split('T')[0];
                const count = dateTrend.get(dateStr) || 0;
                currentWeek.push({ date: dateStr, count });

                if (currDate.getDay() === 6) { 
                    weeks.push(currentWeek);
                    currentWeek = [];
                }
                currDate.setDate(currDate.getDate() + 1);
            }
            if (currentWeek.length > 0) weeks.push(currentWeek);

            weeks.forEach(week => {
                const col = heatmapWrapper.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
                week.forEach(day => {
                    const bgColor = getHeatmapColor(day.count, maxGridCount);
                    const cell = col.createDiv({
                        attr: { style: `width: 12px; height: 12px; background-color: ${bgColor}; border-radius: 3px; cursor: pointer; transition: transform 0.1s; border: 1px solid rgba(0,0,0,0.05);` }
                    });
                    cell.setAttr('title', `${day.date}: 产出 ${day.count} 篇`);
                    cell.addEventListener('mouseenter', () => cell.style.transform = 'scale(1.2)');
                    cell.addEventListener('mouseleave', () => cell.style.transform = 'scale(1)');
                });
            });

            // ==========================================
            // 渲染模块 2：胶囊词汇热力图
            // ==========================================
            const maxWordCount = heatmapWords.length > 0 ? heatmapWords[0].value : 1;

            heatmapWords.forEach(({word, value}) => {
                const wordEl = wordsWrapper.createDiv();
                wordEl.setText(word);
                
                const bgColor = getHeatmapColor(value, maxWordCount);
                // 优化文字颜色：在浅色背景下使用原生文字色，深色背景下使用纯白
                const textColor = value > maxWordCount * 0.4 ? '#ffffff' : 'var(--text-normal)';
                
                wordEl.setAttr("style", `
                    background-color: ${bgColor}; 
                    color: ${textColor}; 
                    padding: 4px 12px; 
                    border-radius: 14px; 
                    font-size: ${Math.max(12, Math.min(22, 11 + (value/maxWordCount)*11))}px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                    border: 1px solid var(--background-modifier-border);
                `);
                
                wordEl.addEventListener('mouseenter', () => {
                    wordEl.style.transform = 'translateY(-2px)';
                    wordEl.style.boxShadow = '0 4px 8px rgba(0, 122, 255, 0.15)';
                    new Notice(`【${word}】: 出现 ${value} 次`);
                });
                
                wordEl.addEventListener('mouseleave', () => {
                    wordEl.style.transform = 'translateY(0)';
                    wordEl.style.boxShadow = 'none';
                });
            });

            refreshBtn.innerText = "重新抓取";
            refreshBtn.disabled = false;
        };

        refreshBtn.addEventListener('click', renderData);
        setTimeout(renderData, 150); 
    }
}

// --- 插件主入口 ---
export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS_HEATMAP, (leaf) => new DesktopStatsHeatmapView(leaf));
        
        this.addRibbonIcon('calendar-days', '打开产出热力看板', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-heatmap-dashboard',
            name: '打开产出热力看板',
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
