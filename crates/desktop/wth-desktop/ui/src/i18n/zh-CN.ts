export const zhCN = {
  // App
  "app.title": "Wide Thought Host",
  "app.subtitle": "桌面代理",
  "app.search": "搜索",
  "app.sessions": "会话",
  "app.files": "文件",
  "app.settings": "设置",
  "app.newSession": "新建会话",
  "app.terminal": "终端面板",

  // Chat
  "chat.placeholder": "输入消息… @ 提及文件 / 指令",
  "chat.generating": "正在生成…",
  "chat.send": "发送",
  "chat.abort": "中止",
  "chat.empty": "输入消息开始对话",
  "chat.thinking": "正在思考…",
  "chat.copy": "复制",
  "chat.copied": "已复制",
  "chat.hint": "Enter 发送 · Shift+Enter 换行 · @ 提及文件 · / 指令",

  // Settings
  "settings.title": "设置",
  "settings.general": "通用",
  "settings.models": "模型与 API",
  "settings.appearance": "外观",
  "settings.mcp": "MCP 与工具",
  "settings.skills": "技能",
  "settings.plugins": "插件",
  "settings.memory": "记忆",
  "settings.hooks": "Hooks",
  "settings.shortcuts": "快捷键",
  "settings.usage": "用量",
  "settings.diagnostics": "诊断",
  "settings.about": "关于",
  "settings.saved": "设置已保存",
  "settings.language": "界面语言",
  "settings.theme": "模式",
  "settings.themeDark": "深色",
  "settings.themeLight": "浅色",
  "settings.themeStyle": "主题风格",
  "settings.fontScale": "字体缩放",
  "settings.fontFamily": "字体族",
  "settings.closeAction": "关闭主窗口",
  "settings.closeTray": "隐藏到托盘",
  "settings.closeQuit": "退出应用",

  // Sidebar
  "sidebar.today": "今天",
  "sidebar.thisWeek": "本周",
  "sidebar.earlier": "更早",
  "sidebar.empty": "还没有会话",
  "sidebar.export": "导出会话",
  "sidebar.rename": "重命名",
  "sidebar.pin": "置顶",
  "sidebar.unpin": "取消置顶",
  "sidebar.delete": "删除",

  // StatusBar
  "status.ready": "就绪",
  "status.thinking": "思考中",
  "status.sessions": "会话",
  "status.messages": "消息",
} as const;

export type TranslationKey = keyof typeof zhCN;
