import { App, ItemView, Plugin, WorkspaceLeaf, Modal, Notice } from 'obsidian';
// 彻底抛弃 D3 依赖，解决深浅色适配冲突，手写原生态防崩溃渲染引擎

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
        // 极淡的灰色，增加在浅色模式下的通透感
        return 'rgba(var(--text-muted-rgb), 0.08)'; 
    }
    const ratio = Math.min(value / max, 1);
    // 苹果系统经典蓝 (0, 122, 255) 的动态透明度插值
    const opacity = 0.25 + (ratio * 0.75); 
    return `rgba(0, 122, 255, ${opacity})`;
}

// --- 热力词 Modal 组件 ---
class WordHeatmapModal extends Modal {
    words: {word: string, value: number}[];
    
    constructor(app: App, words: {word: string, value: number}[]) {
        super(app);
        this.words = words;
    }

    onOpen() {
        let { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { 
            text: "核心概念热力矩阵", 
            attr: { style: "text-align: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 600; margin-bottom: 24px;" } 
        });

        const wordsContainer = contentEl.createDiv({ 
            attr: { style: "display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 10px;" } 
        });
        
        const maxCount = this.words.length > 0 ? this.words[0].value : 1;

        this.words.forEach(({word, value}) => {
            const wordEl = wordsContainer.createDiv();
            wordEl.setText(word);
            
            const bgColor = getHeatmapColor(value, maxCount);
            // 动态计算文字颜色：当背景色过深时，自动将文字变为白色
            const textColor = value > maxCount * 0.4 ? '#ffffff' : '#333333';
            
            wordEl.setAttr("style", `
                background-color: ${bgColor}; 
                color: ${textColor}; 
                padding: 6px 14px; 
                border-radius: 16px; 
                font-size: ${Math.max(12, Math.min(24, 12 + (value/maxCount)*12))}px;
                font-weight: 500;
                cursor: pointer;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                border: 1px solid rgba(0,0,0,0.05);
            `);
            
            wordEl.addEventListener('mouseenter', () => {
                wordEl.style.transform = 'translateY(-2px)';
                wordEl.style.boxShadow = '0 4px 12px rgba(0, 122, 255, 0.2)';
                new Notice(`【${word}】: 出现 ${value} 次`);
            });
            
            wordEl.addEventListener('mouseleave', () => {
                wordEl.style.transform = 'translateY(0)';
                wordEl.style.boxShadow = 'none';
            });
        });
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

// --- 桌面端视图 ---
class DesktopStatsHeatmapView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE_STATS_HEATMAP; }
    getDisplayText() { return "知识资产热力"; }
    // 关键修正 1：更换为无论深浅色主题都绝对清晰可见的“calendar-days”日历图标
    getIcon() { return "calendar-days"; } 

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('stats-heatmap-dashboard-container');

        // 应用高分辨率全屏铺满 CSS
        container.setAttr('style', `
            padding: 20px 30px;
            display: flex;
            flex-direction: column;
            height: 100%;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            -webkit-font-smoothing: antialiased;
        `);

        // 顶部导航栏
        const headerDiv = container.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 15px; flex-shrink: 0;' } });
        headerDiv.createEl("h2", { text: "知识资产全景热力", attr: { style: 'margin: 0; font-size: 1.6em; font-weight: 600;' } });
        const refreshBtn = headerDiv.createEl("button", { text: "重新抓取数据", attr: { style: 'padding: 6px 16px; cursor: pointer; background-color: var(--interactive-accent); color: var(--text-on-accent); border-radius: 6px; border: none;' } });
        
        const contentWrapper = container.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 30px; flex: 1; min-height: 0;' } });

        // 关键重构 2：热力排版从右向左改为直观的从左向右，手写 CSS Flex 网格算法
        const heatmapDiv = contentWrapper.createDiv({ 
            attr: { style: 'flex: 1; display: flex; flex-direction: column; background-color: var(--background-primary-alt); border: 1px solid var(--background-modifier-border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);' } 
        });
        heatmapDiv.createEl("h3", { text: "笔记产出活跃度", attr: { style: 'margin: 0 0 20px 0; font-size: 1.1em; color: var(--text-muted); text-align: center; font-weight: 500;' } });
        
        // 核心原生态热力图容器 (使用 Flex 排版增加透气呼吸感)
        const heatmapWrapper = heatmapDiv.createDiv({ 
            attr: { style: 'display: flex; gap: 5px; overflow-x: auto; padding: 10px; width: 100%; height: 100%; align-items: center; justify-content: flex-start;' } 
        });

        const renderData = async () => {
            refreshBtn.innerText = "数据计算中...";
            refreshBtn.disabled = true;
            heatmapWrapper.empty();
            
            const { heatmapWords, dateTrend } = await analyzeVaultData(this.app);

            // 1. 算法：生成过去 1 年的周数据矩阵
            const endDate = new Date();
            const startDate = new Date();
            startDate.setFullYear(endDate.getFullYear() - 1); // 往前推 1 年
            // 对齐到周日
            startDate.setDate(startDate.getDate() - startDate.getDay()); 

            const weeks: {date: string, count: number}[][] = [];
            let currentWeek: {date: string, count: number}[] = [];
            let currDate = new Date(startDate);
            let maxCount = 1;

            for (const [_, count] of dateTrend.entries()) {
                if (count > maxCount) maxCount = count;
            }

            while (currDate <= endDate) {
                const dateStr = currDate.toISOString().split('T')[0];
                const count = dateTrend.get(dateStr) || 0;
                currentWeek.push({ date: dateStr, count });

                if (currDate.getDay() === 6) { // 周六结束一周
                    weeks.push(currentWeek);
                    currentWeek = [];
                }
                currDate.setDate(currDate.getDate() + 1);
            }
            if (currentWeek.length > 0) weeks.push(currentWeek);

            // 关键重构 3：使用原生态 HTML 渲染“呼吸感”胶囊方块网格
            weeks.forEach(week => {
                const col = heatmapWrapper.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 5px;' } });
                week.forEach(day => {
                    const bgColor = getHeatmapColor(day.count, maxCount);
                    // 每一个小格都是圆润的胶囊药丸样式
                    const cell = col.createDiv({
                        attr: {
                            style: `width: 14px; height: 14px; background-color: ${bgColor}; border-radius: 4px; cursor: pointer; transition: transform 0.1s;`
                        }
                    });
                    cell.setAttr('title', `${day.date}: 产出 ${day.count} 篇`);
                    
                    cell.addEventListener('mouseenter', () => cell.style.transform = 'scale(1.2)');
                    cell.addEventListener('mouseleave', () => cell.style.transform = 'scale(1)');
                });
            });

            refreshBtn.innerText = "重新抓取数据";
            refreshBtn.disabled = false;

            // 渲染完毕后自动弹出热力词 Modal
            new WordHeatmapModal(this.app, heatmapWords).open();
        };

        refreshBtn.addEventListener('click', renderData);
        setTimeout(renderData, 150); 
    }
}

// --- 插件主入口 ---
export default class DesktopStatsPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_STATS_HEATMAP, (leaf) => new DesktopStatsHeatmapView(leaf));
        
        // 此图标也同步更换为清晰可见的日历图标
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
            existingLeaves[i].detach(); // 安全清理所有的旧视图，彻底封杀崩溃可能
        }

        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_STATS_HEATMAP, active: true });
            workspace.revealLeaf(leaf);
        }
    }
}
