(() => {
  const MODULE_DIR = "/data/adb/modules/ColorOSDynamic";
  const CONFIG_PATH = `${MODULE_DIR}/touch_opt.conf`;
  const RATE_PATH = `${MODULE_DIR}/rate_code.conf`;
  const MONITOR_CONFIG_PATH = `${MODULE_DIR}/monitor_config.conf`;
  const APP_NAMES_PATH = `${MODULE_DIR}/app_names.conf`;
  const FLAG_PATH = `${MODULE_DIR}/touch_enabled.flag`;
  const STATUS_PATH = "/data/adb/ColorOSDynamic/service.status";
  const PID_PATH = "/data/adb/ColorOSDynamic/service.pid";
  const WATCHDOG_PID_PATH = "/data/adb/ColorOSDynamic/watchdog.pid";
  const WATCHDOG_STATUS_PATH = "/data/adb/ColorOSDynamic/watchdog.status";
  const STOP_PATH = "/data/adb/ColorOSDynamic/stop.flag";
  const RESTART_PATH = "/data/adb/ColorOSDynamic/restart.flag";
  const SERVICE_PATH = `${MODULE_DIR}/service.sh`;
  // 进程识别同时匹配完整模块路径与「模块目录名 + service.sh」组合；
  // 不按纯 service.sh 文件名匹配，避免误杀其他模块的进程。
  const SERVICE_CMD_MATCH = `grep -Fq -e '${SERVICE_PATH}' -e 'ColorOSDynamic/service.sh'`;
  const MAX_WRITE_COMMAND = 64 * 1024;
  const PACKAGE_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
  const COMMAND_PATTERN = /^touchHidlTest -c wo \d{1,4} \d{1,4} [A-Za-z0-9]{1,8}$/;
  const DEFAULT_RATES = [
    ["125", "ratePowerSave"], ["240", "rateBalanced"], ["360", "rateResponsive"],
    ["241", "rateCompatibility"], ["361", "rateCompatibility"], ["362", "rateCompatibility"], ["600", "rateSmooth"]
  ];
  const DEFAULT_SHORTCUTS = [
    { action: "enable", rate: "360" },
    { action: "disable", rate: "360" },
    { action: "setGlobal", rate: "360" }
  ];
  const COPY = {
    zh: {
      documentTitle: "ColorOS Touch | 触控采样率", brandCaption: "触控采样率管理", mainNavigation: "底部导航",
      statusGridLabel: "触控服务状态",
      languageLabel: "界面语言", themeLabel: "界面主题", systemShort: "系统", lightShort: "浅色", darkShort: "深色",
      homeEyebrow: "DEVICE / INPUT CONTROL", homeTitle: "首页", homeDescription: "查看触控服务状态并快速调整常用操作。",
      engineEyebrow: "TOUCH ENGINE", engineTitle: "动态触控调整", engineDescription: "根据前台应用规则自动调整触控采样率。",
      enabled: "已启用", disabled: "未启用", toggleLabel: "启用触控自动调整", serviceStatus: "服务状态",
      foregroundApp: "前台应用", unknownApp: "暂未检测", appliedRate: "当前采样率", quickEyebrow: "QUICK ACTIONS",
      quickTitle: "快捷操作", configureShortcuts: "配置快捷操作", quickConfigEyebrow: "QUICK CONFIG",
      globalRateTitle: "全局采样率", quickConfigHint: "应用规则仍优先于全局值。", globalRateLabel: "全局触控采样率",
      homeFootnote: "配置更改保存后生效；停止服务不会重置硬件当前值。",
      configEyebrow: "PROFILES / COMMANDS", configTitle: "配置", configDescription: "设置采样率、应用规则、检测回退和快捷操作。",
      baselineEyebrow: "BASELINE / ALL APPS", globalHint: "未命中应用规则时采用此值。",
      rulesEyebrow: "PER-APP / PRIORITY RULES", rulesTitle: "应用规则",
      rulesHint: "应用名称和图标仅用于展示，规则文件仍保存包名与采样率。", appColumn: "应用", rateColumn: "采样率",
      packageLabel: "应用包名", packagePlaceholder: "com.example.app", newRuleRateLabel: "采样率", addAppButton: "添加应用",
      removeRule: "删除规则", emptyRules: "还没有应用规则。添加包名，为特定应用设定采样率。",
      fallbackTitle: "检测方式回退", fallbackHint: "名单应用进入前台时切换回退方式；离开后恢复 Activity 事件监听。系统观察器不可用时会按此间隔轮询。名单只影响检测方式，不改变采样率规则。",
      fallbackToggle: "启用应用检测回退", fallbackMethodLabel: "回退方式", fallbackMethodObserver: "cmd activity 前台进程观察（设备支持时）",
      fallbackMethodPolling: "定时轮询", fallbackIntervalLabel: "轮询间隔（秒）", fallbackPackagesLabel: "回退名单应用",
      fallbackPackagePlaceholder: "com.example.game", fallbackAddButton: "添加到名单", fallbackNoApps: "尚未添加回退应用。",
      fallbackRemove: "从回退名单移除", invalidFallbackInterval: "轮询间隔必须为 1 到 60 秒。",
      duplicateFallbackPackage: "应用 {package} 已在回退名单中。", fallbackAppAdded: "已加入检测回退名单，请保存更改。",
      fallbackAppRemoved: "已从检测回退名单移除，请保存更改。", fallbackActiveFor: "（回退：{app}）",
      shortcutSettingsEyebrow: "HOME / QUICK ACTIONS", shortcutSettingsTitle: "快捷操作设置",
      shortcutSettingsHint: "选择首页三个操作槽执行的动作。", shortcutSlot: "操作 {number}",
      shortcutNone: "不显示", shortcutEnable: "启用自动触控调整", shortcutDisable: "停止自动调整",
      shortcutSetGlobal: "设置全局触控采样率", shortcutRate: "目标采样率", actionEnable: "启用自动调整",
      actionDisable: "停止自动调整", actionSetGlobal: "设置全局采样率：{rate} Hz", actionUnavailable: "配置快捷操作",
      commandsEyebrow: "ADVANCED / COMMAND MAP", commandsTitle: "采样率命令映射",
      commandsHint: "仅支持安全格式的 touchHidlTest 命令。修改后保存并重启服务以应用。",
      rateIdLabel: "采样率编号", commandLabel: "触控命令", commandPlaceholder: "touchHidlTest -c wo 0 26 12c",
      addMappingButton: "添加映射", removeMapping: "删除映射", mappingInUse: "此映射正在使用，请先修改相关采样率。",
      aboutEyebrow: "MODULE / DIAGNOSTICS", aboutTitle: "关于", aboutDescription: "模块参数、设备信息和服务运行日志。",
      paramsEyebrow: "MODULE INFORMATION", paramsTitle: "模块参数", moduleVersion: "模块版本",
      managerLabel: "Root 管理器", deviceLabel: "设备", androidLabel: "Android 版本", eventModeLabel: "前台检测方式",
      heartbeatLabel: "最近心跳", logsEyebrow: "SERVICE / LAST 100 LINES", logsTitle: "运行日志",
      logsHint: "记录应用切换、规则命中和触控命令结果。", refreshLabel: "刷新日志", emptyLog: "暂无日志",
      navHome: "首页", navConfig: "配置", navAbout: "关于", loading: "正在读取状态…",
      statusUnavailable: "状态不可用", statusDisabled: "未启用", statusWaiting: "等待系统启动", statusStarting: "启动中",
      statusRunning: "运行中", statusDegraded: "降级运行", statusError: "异常", engineUnavailable: "连接不可用",
      engineStateOff: "服务未运行", engineStateWaiting: "等待系统启动完成", engineStateStarting: "服务正在启动",
      engineStateRunning: "正在监听前台应用变化", engineStateDegraded: "服务降级运行，请查看运行日志",
      engineStateError: "服务进程异常退出", engineStateUnavailable: "无法读取管理器状态",
      eventModeEvents: "Activity 事件", eventModeObserver: "系统进程观察", eventModePolling: "定时轮询", eventModeStarting: "启动中", noHeartbeat: "暂无",
      recentHeartbeat: "{seconds} 秒前", ratePowerSave: "省电", rateBalanced: "均衡", rateResponsive: "跟手",
      rateCompatibility: "兼容", rateSmooth: "顺滑", appCount: "{count} 个应用", appCountOne: "1 个应用",
      invalidPackage: "请输入有效的应用包名。", duplicatePackage: "应用 {package} 已存在。",
      invalidGlobal: "请选择有效的全局采样率。", invalidRuleRate: "采样率 {rate} 没有命令映射。",
      duplicatePackageSave: "应用包名重复：{package}。", invalidRateId: "采样率编号须为 1–9999。",
      invalidCommand: "仅支持指定格式的 touchHidlTest 命令。", rateExists: "采样率 {rate} 已存在。",
      settingsSaved: "触控设置已保存。", ruleAdded: "应用规则已添加，请保存更改。", ruleRemoved: "应用规则已移除，请保存更改。",
      mappingAdded: "触控命令映射已添加，请保存更改。", mappingRemoved: "触控命令映射已移除，请保存更改。",
      enabledMessage: "触控动态调整已开启。", disabledMessage: "触控动态调整已关闭。",
      unsavedState: "有未保存的更改", saveButton: "保存更改", dialogTitle: "有未保存的修改",
      dialogCopy: "离开前要如何处理这些更改？", dialogSave: "保存", dialogDiscard: "放弃", dialogContinue: "继续编辑",
      serviceActionError: "操作失败：{error}", managerKsu: "KernelSU", managerMagisk: "Magisk", managerUnknown: "未知",
      nameFallback: "应用 {package}", statusEngineOn: "自动调整已启用", statusEngineOff: "自动调整已关闭",
      refreshFailed: "读取服务状态失败。", setGlobalDone: "全局采样率已更新。",
      systemLanguage: "系统语言", systemTheme: "系统主题", appPackage: "包名 {package}",
      savedButRestartFailed: "配置已保存，但服务重启失败：{error}。请重新保存或手动重启服务。",
      configTooLarge: "配置内容超过 64 KB，请删减应用规则或命令映射后重试。",
      duplicateRulesMerged: "检测到 {count} 个重复包名，保存后将合并为一条规则。",
      shortcutRateInvalid: "采样率已失效，请重新配置此快捷操作。"
    },
    en: {
      documentTitle: "ColorOS Touch | Touch sampling", brandCaption: "Touch sampling manager", mainNavigation: "Main navigation",
      statusGridLabel: "Touch service status",
      languageLabel: "Interface language", themeLabel: "Interface theme", systemShort: "System", lightShort: "Light", darkShort: "Dark",
      homeEyebrow: "DEVICE / INPUT CONTROL", homeTitle: "Home", homeDescription: "Check service health and run common touch actions.",
      engineEyebrow: "TOUCH ENGINE", engineTitle: "Dynamic touch control", engineDescription: "Adjust touch sampling for the foreground app.",
      enabled: "Enabled", disabled: "Disabled", toggleLabel: "Enable automatic touch adjustment", serviceStatus: "Service status",
      foregroundApp: "Foreground app", unknownApp: "Not detected", appliedRate: "Applied rate", quickEyebrow: "QUICK ACTIONS",
      quickTitle: "Quick actions", configureShortcuts: "Configure quick actions", quickConfigEyebrow: "QUICK CONFIG",
      globalRateTitle: "Global sampling rate", quickConfigHint: "App rules still take priority.", globalRateLabel: "Global touch sampling rate",
      homeFootnote: "Saved settings take effect when applied. Stopping the service leaves the hardware rate unchanged.",
      configEyebrow: "PROFILES / COMMANDS", configTitle: "Configuration", configDescription: "Set sampling rates, app rules, detection fallback, and shortcuts.",
      baselineEyebrow: "BASELINE / ALL APPS", globalHint: "Used when no app rule matches.",
      rulesEyebrow: "PER-APP / PRIORITY RULES", rulesTitle: "App rules",
      rulesHint: "Names and icons are for display; rules still store package names and rates.", appColumn: "Application", rateColumn: "Rate",
      packageLabel: "App package", packagePlaceholder: "com.example.app", newRuleRateLabel: "Sampling rate", addAppButton: "Add app",
      removeRule: "Remove rule", emptyRules: "No app rules yet. Add a package name to set a rate for a specific app.",
      fallbackTitle: "Detection fallback", fallbackHint: "Switch methods while a listed app is in the foreground, then restore Activity event monitoring after it leaves. If the system observer is unavailable, polling uses this interval. This does not change touch-rate rules.",
      fallbackToggle: "Enable per-app detection fallback", fallbackMethodLabel: "Fallback method", fallbackMethodObserver: "cmd activity observer (if supported)",
      fallbackMethodPolling: "Timed polling", fallbackIntervalLabel: "Polling interval (seconds)", fallbackPackagesLabel: "Fallback apps",
      fallbackPackagePlaceholder: "com.example.game", fallbackAddButton: "Add to list", fallbackNoApps: "No fallback apps added.",
      fallbackRemove: "Remove from fallback list", invalidFallbackInterval: "Polling interval must be from 1 to 60 seconds.",
      duplicateFallbackPackage: "{package} is already in the fallback list.", fallbackAppAdded: "App added to the detection fallback list. Save your changes.",
      fallbackAppRemoved: "App removed from the detection fallback list. Save your changes.", fallbackActiveFor: " (fallback: {app})",
      shortcutSettingsEyebrow: "HOME / QUICK ACTIONS", shortcutSettingsTitle: "Quick action settings",
      shortcutSettingsHint: "Choose the action for each of the three home shortcuts.", shortcutSlot: "Action {number}",
      shortcutNone: "Hidden", shortcutEnable: "Enable automatic touch adjustment", shortcutDisable: "Stop automatic adjustment",
      shortcutSetGlobal: "Set global touch sampling rate", shortcutRate: "Target rate", actionEnable: "Enable automatic adjustment",
      actionDisable: "Stop automatic adjustment", actionSetGlobal: "Set global rate: {rate} Hz", actionUnavailable: "Configure quick actions",
      commandsEyebrow: "ADVANCED / COMMAND MAP", commandsTitle: "Sampling rate command map",
      commandsHint: "Only supported touchHidlTest command formats are accepted. Save and restart the service to apply changes.",
      rateIdLabel: "Rate identifier", commandLabel: "Touch command", commandPlaceholder: "touchHidlTest -c wo 0 26 12c",
      addMappingButton: "Add mapping", removeMapping: "Remove mapping", mappingInUse: "This mapping is in use. Change its references first.",
      aboutEyebrow: "MODULE / DIAGNOSTICS", aboutTitle: "About", aboutDescription: "Module parameters, device details, and service logs.",
      paramsEyebrow: "MODULE INFORMATION", paramsTitle: "Module parameters", moduleVersion: "Module version",
      managerLabel: "Root manager", deviceLabel: "Device", androidLabel: "Android version", eventModeLabel: "Foreground detection",
      heartbeatLabel: "Last heartbeat", logsEyebrow: "SERVICE / LAST 100 LINES", logsTitle: "Service log",
      logsHint: "Foreground changes, matched rules, and touch command results.", refreshLabel: "Refresh logs", emptyLog: "No log entries yet",
      navHome: "Home", navConfig: "Config", navAbout: "About", loading: "Loading status…",
      statusUnavailable: "Unavailable", statusDisabled: "Not enabled", statusWaiting: "Waiting for system boot", statusStarting: "Starting",
      statusRunning: "Running", statusDegraded: "Degraded", statusError: "Error", engineUnavailable: "Connection unavailable",
      engineStateOff: "Service is stopped", engineStateWaiting: "Waiting for system startup to complete", engineStateStarting: "Service is starting",
      engineStateRunning: "Monitoring foreground app changes", engineStateDegraded: "Service is degraded; check the run log",
      engineStateError: "Service process exited unexpectedly", engineStateUnavailable: "Unable to read manager status",
      eventModeEvents: "Activity events", eventModeObserver: "System process observer", eventModePolling: "Timed polling", eventModeStarting: "Starting", noHeartbeat: "None",
      recentHeartbeat: "{seconds}s ago", ratePowerSave: "Power save", rateBalanced: "Balanced", rateResponsive: "Responsive",
      rateCompatibility: "Compatibility", rateSmooth: "Smooth", appCount: "{count} apps", appCountOne: "1 app",
      invalidPackage: "Enter a valid app package name.", duplicatePackage: "{package} is already in the rules.",
      invalidGlobal: "Choose a valid global sampling rate.", invalidRuleRate: "Rate {rate} has no command mapping.",
      duplicatePackageSave: "Duplicate app package: {package}.", invalidRateId: "Rate identifier must be between 1 and 9999.",
      invalidCommand: "Only supported touchHidlTest command formats are accepted.", rateExists: "Rate {rate} already exists.",
      settingsSaved: "Touch settings saved.", ruleAdded: "App rule added. Save your changes to apply it.", ruleRemoved: "App rule removed. Save your changes to apply it.",
      mappingAdded: "Command mapping added. Save your changes to apply it.", mappingRemoved: "Command mapping removed. Save your changes to apply it.",
      enabledMessage: "Dynamic touch control enabled.", disabledMessage: "Dynamic touch control stopped.",
      unsavedState: "Unsaved changes", saveButton: "Save changes", dialogTitle: "Unsaved changes",
      dialogCopy: "How should these changes be handled before leaving?", dialogSave: "Save", dialogDiscard: "Discard", dialogContinue: "Continue editing",
      serviceActionError: "Action failed: {error}", managerKsu: "KernelSU", managerMagisk: "Magisk", managerUnknown: "Unknown",
      nameFallback: "App {package}", statusEngineOn: "Automatic adjustment is enabled", statusEngineOff: "Automatic adjustment is stopped",
      refreshFailed: "Unable to read service status.", setGlobalDone: "Global sampling rate updated.",
      systemLanguage: "System language", systemTheme: "System theme", appPackage: "Package {package}",
      savedButRestartFailed: "Settings saved, but the service restart failed: {error}. Save again or restart the service manually.",
      configTooLarge: "Configuration exceeds 64 KB. Remove some app rules or command mappings and try again.",
      duplicateRulesMerged: "Found {count} duplicate package names; they will be merged when saved.",
      shortcutRateInvalid: "This sampling rate is no longer available. Reconfigure the shortcut."
    }
  };

  const $ = (id) => document.getElementById(id);
  const localRead = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const localWrite = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* WebView storage may be unavailable. */ }
  };
  const systemLanguage = () => /^zh(?:-|$)/i.test(navigator.language || "") ? "zh" : "en";
  const mediaTheme = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const state = {
    languageMode: localRead("touch-ui-language-mode", "system"),
    themeMode: localRead("touch-ui-theme-mode", "system"),
    language: "zh", theme: "light", games: [], rates: new Map(), rateLayout: [], globalRate: "125",
    fallbackEnabled: false, fallbackMethod: "observer", fallbackInterval: "3", fallbackPackages: [],
    shortcuts: readShortcuts(), appInfo: new Map(), appNames: new Map(), service: {}, enabled: false,
    loaded: false, unavailable: false, dirty: false, original: null, callbackId: 0,
    polling: false, pollingSince: 0, messageTimer: 0, enabledAt: 0
  };
  if (!["system", "zh", "en"].includes(state.languageMode)) state.languageMode = "system";
  if (!["system", "light", "dark"].includes(state.themeMode)) state.themeMode = "system";
  let pendingAction = null;
  let exitFallbackUsed = false;

  function readShortcuts() {
    try {
      const parsed = JSON.parse(localStorage.getItem("touch-ui-shortcuts") || "null");
      if (Array.isArray(parsed) && parsed.length === 3) {
        return parsed.map((entry) => ({
          action: ["", "enable", "disable", "setGlobal"].includes(entry.action) ? entry.action : "",
          rate: /^\d{1,4}$/.test(String(entry.rate || "")) ? String(entry.rate) : "360"
        }));
      }
    } catch { /* Use defaults for damaged or unavailable preferences. */ }
    return DEFAULT_SHORTCUTS.map((item) => ({ ...item }));
  }

  function t(key, values = {}) {
    let value = COPY[state.language][key] || COPY.zh[key] || key;
    for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  }

  function exec(command) {
    return new Promise((resolve, reject) => {
      const callback = `touch_webui_cb_${Date.now()}_${state.callbackId++}`;
      const timeout = window.setTimeout(() => {
        delete window[callback];
        reject(new Error("Root command timed out"));
      }, 8000);
      window[callback] = (code, stdout, stderr) => {
        window.clearTimeout(timeout);
        delete window[callback];
        if (Number(code) !== 0) reject(new Error((stderr || stdout || `Command failed (${code})`).trim()));
        else resolve(String(stdout || "").trim());
      };
      try {
        if (window.ksu && typeof window.ksu.exec === "function") window.ksu.exec(command, "{}", callback);
        else if (window.magisk && typeof window.magisk.exec === "function") window.magisk.exec(command, callback);
        else throw new Error("Root WebUI command interface is unavailable");
      } catch (error) {
        window.clearTimeout(timeout);
        delete window[callback];
        reject(error);
      }
    });
  }

  function updatePreferences() {
    state.language = state.languageMode === "system" ? systemLanguage() : state.languageMode;
    state.theme = state.themeMode === "system"
      ? (mediaTheme && mediaTheme.matches ? "dark" : "light")
      : state.themeMode;
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dataset.themeMode = state.themeMode;
    document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
    const pageColor = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
    document.querySelector('meta[name="theme-color"]').content = pageColor || (state.theme === "dark" ? "#18211f" : "#eaf1ee");
    document.querySelectorAll("[data-language-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.languageMode === state.languageMode));
    });
    document.querySelectorAll("[data-theme-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.themeMode === state.themeMode));
    });
  }

  function setMessage(message, isError = false) {
    const element = $("message");
    element.textContent = message;
    element.classList.toggle("error", isError);
    element.classList.add("visible");
    window.clearTimeout(state.messageTimer);
    state.messageTimer = window.setTimeout(() => element.classList.remove("visible"), 3600);
  }

  function updateDirty() {
    if (!state.original) return;
    const now = JSON.stringify({
      games: state.games,
      globalRate: state.globalRate,
      rates: [...state.rates.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
      fallbackEnabled: state.fallbackEnabled,
      fallbackMethod: state.fallbackMethod,
      fallbackInterval: state.fallbackInterval,
      fallbackPackages: state.fallbackPackages,
      shortcuts: state.shortcuts
    });
    state.dirty = now !== state.original;
    $("save-bar").hidden = !state.dirty;
  }

  function snapshot() {
    state.original = JSON.stringify({
      games: state.games,
      globalRate: state.globalRate,
      rates: [...state.rates.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
      fallbackEnabled: state.fallbackEnabled,
      fallbackMethod: state.fallbackMethod,
      fallbackInterval: state.fallbackInterval,
      fallbackPackages: state.fallbackPackages,
      shortcuts: state.shortcuts
    });
  }

  function restoreDraft() {
    if (!state.original) return;
    const data = JSON.parse(state.original);
    state.games = data.games;
    state.globalRate = data.globalRate;
    state.rates = new Map(data.rates);
    state.fallbackEnabled = data.fallbackEnabled;
    state.fallbackMethod = data.fallbackMethod;
    state.fallbackInterval = data.fallbackInterval;
    state.fallbackPackages = data.fallbackPackages;
    state.shortcuts = data.shortcuts;
    state.dirty = false;
    renderAll();
    setMessage(t("settingsSaved"));
  }

  function applyTranslations() {
    // renderRates() 会把「添加应用」的采样率下拉重置为 360；先记住选择再恢复。
    const draftNewRate = $("new-rate").value || "";
    updatePreferences();
    document.title = t("documentTitle");
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAria)); });
    renderAll();
    if (draftNewRate && [...$("new-rate").options].some((option) => option.value === draftNewRate)) {
      $("new-rate").value = draftNewRate;
    }
  }

  function toBase64(text) {
    const value = String(text);
    try {
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch {
      return btoa(unescape(encodeURIComponent(value)));
    }
  }

  function cleanName(value) {
    // 去掉名称开头的 #，避免 serializeConfig 写出 "##名称"。
    return String(value || "").replace(/[\r\n=\t]/g, "").trim().replace(/^#+\s*/, "").trim().slice(0, 60);
  }

  function parseAppNames(text) {
    const names = new Map();
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const split = line.indexOf("=");
      if (split < 1) continue;
      const packageName = line.slice(0, split).trim();
      const name = cleanName(line.slice(split + 1));
      if (PACKAGE_PATTERN.test(packageName) && name) names.set(packageName, name);
    }
    return names;
  }

  function serializeAppNames() {
    const lines = ["# App display names; package=name"];
    for (const [packageName, name] of state.appNames) {
      if (PACKAGE_PATTERN.test(packageName) && cleanName(name)) lines.push(`${packageName}=${cleanName(name)}`);
    }
    return lines.join("\n") + "\n";
  }

  async function persistAppNames() {
    if (!window.ksu && !window.magisk) return;
    try {
      const payload = toBase64(serializeAppNames());
      // 独立临时文件名：避免与 writeSettings() 的 APP_NAMES_PATH.tmp 并发覆盖。
      await exec(`printf '%s' '${payload}' | base64 -d > '${APP_NAMES_PATH}.names.tmp' && chmod 0600 '${APP_NAMES_PATH}.names.tmp' && mv '${APP_NAMES_PATH}.names.tmp' '${APP_NAMES_PATH}'`);
    } catch { /* Name cache is optional; package names remain usable. */ }
  }

  async function execWithRetry(command) {
    try { return await exec(command); }
    catch { return await exec(command); }
  }

  function parseConfig(text) {
    const games = new Map();
    const duplicates = [];
    let globalRate = "125";
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const split = line.indexOf("=");
      if (split < 1) continue;
      const key = line.slice(0, split).trim();
      const value = line.slice(split + 1).trim();
      if (key === "global_sample_rate" && /^\d{1,4}$/.test(value)) globalRate = value;
      else if (PACKAGE_PATTERN.test(key) && /^\d{1,4}$/.test(value)) {
        // 手动编辑可能产生重复包名；记录下来提示用户「保存后将合并」。
        if (games.has(key)) duplicates.push(key);
        else games.set(key, { package: key, rate: value });
      }
    }
    return { games: [...games.values()], globalRate, duplicates };
  }

  function parseMonitorConfig(text) {
    let fallbackEnabled = false;
    let fallbackMethod = "observer";
    let fallbackInterval = "3";
    const fallbackPackages = new Set();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const split = line.indexOf("=");
      if (split < 1) continue;
      const key = line.slice(0, split).trim();
      const value = line.slice(split + 1).trim();
      if (key === "fallback_enabled") fallbackEnabled = value === "1";
      else if (key === "fallback_method" && ["observer", "polling"].includes(value)) fallbackMethod = value;
      else if (key === "poll_interval" && /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 60) fallbackInterval = value;
      else if (key === "fallback_package" && PACKAGE_PATTERN.test(value)) fallbackPackages.add(value);
    }
    return { fallbackEnabled, fallbackMethod, fallbackInterval, fallbackPackages: [...fallbackPackages] };
  }

  function parseRates(text) {
    const rates = new Map();
    for (const raw of text.split(/\r?\n/)) {
      const match = raw.trim().match(/^(\d{1,4})=(.+)$/);
      if (match && COMMAND_PATTERN.test(match[2])) rates.set(match[1], match[2]);
    }
    return rates;
  }
  // 逐行记录 rate_code.conf 的原始版式：注释、空行、无法识别的行原样保留，
  // 只有 rate=command 行在保存时用 state.rates 的最新值重写。
  function parseRateLayout(text) {
    const rows = text.split(/\r?\n/);
    if (text.endsWith("\n")) rows.pop();
    return rows.map((raw) => {
      const match = raw.trim().match(/^(\d{1,4})=(.+)$/);
      if (match && COMMAND_PATTERN.test(match[2])) {
        return { type: "rate", rate: match[1], command: match[2] };
      }
      return { type: "raw", text: raw };
    });
  }

  function rateLabel(rate) {
    const preset = DEFAULT_RATES.find(([id]) => id === rate);
    return preset ? `${rate} Hz · ${t(preset[1])}` : `${rate} Hz`;
  }

  function renderRateSelect(select, selected, { includeUnmapped = false } = {}) {
    const values = [...state.rates.keys()].sort((a, b) => Number(a) - Number(b));
    if (includeUnmapped && selected && !state.rates.has(selected)) values.unshift(selected);
    select.replaceChildren(...values.map((rate, index) => {
      const option = document.createElement("option");
      option.value = rate;
      option.textContent = state.rates.has(rate) ? rateLabel(rate) : `${rate} Hz · ${state.language === "zh" ? "无命令映射" : "No command mapping"}`;
      option.selected = rate === selected;
      if (includeUnmapped && index === 0 && !state.rates.has(rate)) option.disabled = true;
      return option;
    }));
    if (!values.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "—";
      select.append(option);
    }
  }

  function appLabel(packageName) {
    const info = state.appInfo.get(packageName);
    if (info && info.name) return info.name;
    return state.appNames.get(packageName) || packageName;
  }

  function appIcon(packageName, name) {
    const avatar = document.createElement("span");
    avatar.className = "app-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const fallback = document.createElement("span");
    fallback.className = "app-icon-placeholder";
    fallback.textContent = (name || packageName).slice(0, 1).toUpperCase();
    avatar.append(fallback);
    if (window.ksu) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = `ksu://icon/${encodeURIComponent(packageName)}`;
      image.addEventListener("error", () => image.remove(), { once: true });
      avatar.append(image);
    }
    return avatar;
  }

  function appIdentity(packageName) {
    const name = appLabel(packageName);
    const wrap = document.createElement("span");
    wrap.className = "application-identity";
    wrap.append(appIcon(packageName, name));
    const copy = document.createElement("span");
    copy.className = "application-copy";
    const title = document.createElement("strong");
    title.textContent = name;
    const pkg = document.createElement("small");
    pkg.textContent = packageName;
    copy.append(title, pkg);
    wrap.append(copy);
    return wrap;
  }

  function renderGameRules() {
    const list = $("game-rules");
    const count = state.games.length;
    $("app-count").textContent = t(count === 1 ? "appCountOne" : "appCount", { count });
    if (!count) {
      const empty = document.createElement("p");
      empty.className = "empty-rules";
      empty.textContent = t("emptyRules");
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...state.games.map((game, index) => {
      const row = document.createElement("div");
      row.className = "rule-row";
      row.append(appIdentity(game.package));
      const rate = document.createElement("select");
      rate.setAttribute("aria-label", `${game.package} ${t("rateColumn")}`);
      renderRateSelect(rate, game.rate, { includeUnmapped: true });
      rate.addEventListener("change", () => {
        state.games[index].rate = rate.value;
        updateDirty();
        renderRateList();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button remove-button";
      remove.setAttribute("aria-label", `${t("removeRule")} ${game.package}`);
      remove.title = t("removeRule");
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>';
      remove.addEventListener("click", () => {
        state.games.splice(index, 1);
        renderGameRules();
        updateDirty();
        renderRateList();
        setMessage(t("ruleRemoved"));
      });
      row.append(rate, remove);
      return row;
    }));
  }

  function renderFallbackApps() {
    const list = $("fallback-packages");
    if (!state.fallbackPackages.length) {
      const empty = document.createElement("p");
      empty.className = "empty-rules";
      empty.textContent = t("fallbackNoApps");
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...state.fallbackPackages.map((packageName, index) => {
      const row = document.createElement("div");
      row.className = "fallback-row";
      row.append(appIdentity(packageName));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button remove-button";
      remove.setAttribute("aria-label", `${t("fallbackRemove")} ${packageName}`);
      remove.title = t("fallbackRemove");
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>';
      remove.addEventListener("click", () => {
        state.fallbackPackages.splice(index, 1);
        renderFallbackApps();
        updateDirty();
        setMessage(t("fallbackAppRemoved"));
      });
      row.append(remove);
      return row;
    }));
  }

  function renderMonitorSettings() {
    $("fallback-enabled").checked = state.fallbackEnabled;
    $("fallback-method").value = state.fallbackMethod;
    $("fallback-interval").value = state.fallbackInterval;
    renderFallbackApps();
  }

  function renderRates() {
    for (const select of [$("global-rate"), $("home-global-rate"), $("new-rate")]) {
      const selected = select === $("new-rate") ? (state.rates.has("360") ? "360" : [...state.rates.keys()][0]) : state.globalRate;
      renderRateSelect(select, selected);
      select.value = selected || "";
    }
    $("global-rate-value").textContent = state.globalRate;
    renderGameRules();
    renderMonitorSettings();
    renderShortcuts();
    renderRateList();
  }

  function renderShortcutSettings() {
    const root = $("shortcut-settings");
    root.replaceChildren(...state.shortcuts.map((shortcut, index) => {
      const row = document.createElement("div");
      row.className = "shortcut-setting-row";
      const label = document.createElement("label");
      label.className = "field shortcut-select-field";
      const caption = document.createElement("span");
      caption.textContent = t("shortcutSlot", { number: index + 1 });
      const action = document.createElement("select");
      action.setAttribute("aria-label", caption.textContent);
      const options = [["", "shortcutNone"], ["enable", "shortcutEnable"], ["disable", "shortcutDisable"], ["setGlobal", "shortcutSetGlobal"]];
      action.replaceChildren(...options.map(([value, key]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = t(key);
        option.selected = shortcut.action === value;
        return option;
      }));
      action.addEventListener("change", () => {
        state.shortcuts[index].action = action.value;
        updateDirty();
        renderShortcuts();
        renderRateList();
      });
      label.append(caption, action);
      row.append(label);
      if (shortcut.action === "setGlobal") {
        row.classList.add("has-rate");
        const rateLabel = document.createElement("label");
        rateLabel.className = "field shortcut-rate-field";
        const rateCaption = document.createElement("span");
        rateCaption.textContent = t("shortcutRate");
        const rate = document.createElement("select");
        rate.setAttribute("aria-label", `${caption.textContent} ${t("shortcutRate")}`);
        renderRateSelect(rate, shortcut.rate);
        rate.value = shortcut.rate;
        rate.addEventListener("change", () => {
          state.shortcuts[index].rate = rate.value;
          updateDirty();
          renderShortcuts();
          renderRateList();
        });
        rateLabel.append(rateCaption, rate);
        row.append(rateLabel);
      }
      return row;
    }));
  }

  function shortcutTitle(shortcut) {
    if (shortcut.action === "enable") return t("actionEnable");
    if (shortcut.action === "disable") return t("actionDisable");
    if (shortcut.action === "setGlobal") {
      return state.rates.has(shortcut.rate) ? t("actionSetGlobal", { rate: shortcut.rate }) : t("shortcutRateInvalid");
    }
    return t("actionUnavailable");
  }

  function renderShortcuts() {
    renderShortcutSettings();
    const root = $("quick-actions");
    const configured = state.shortcuts.filter((shortcut) => shortcut.action);
    if (!configured.length) {
      const empty = document.createElement("p");
      empty.className = "empty-rules";
      empty.textContent = t("actionUnavailable");
      root.replaceChildren(empty);
      return;
    }
    root.replaceChildren(...state.shortcuts.map((shortcut, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quick-action";
      const invalidRate = shortcut.action === "setGlobal" && !state.rates.has(shortcut.rate);
      button.disabled = !shortcut.action || invalidRate;
      if (invalidRate) button.title = t("shortcutRateInvalid");
      const icon = document.createElement("span");
      icon.className = `quick-action-icon ${shortcut.action || "empty"}`;
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = shortcut.action === "enable" ? "▶" : shortcut.action === "disable" ? "Ⅱ" : shortcut.action === "setGlobal" ? "Hz" : "·";
      const label = document.createElement("span");
      label.className = "quick-action-label";
      label.textContent = shortcutTitle(shortcut);
      button.append(icon, label);
      if (shortcut.action && !invalidRate) button.addEventListener("click", () => runShortcut(index));
      return button;
    }));
  }

  function renderRateList() {
    const list = $("rate-list");
    const values = [...state.rates.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    list.replaceChildren(...values.map(([rate, command]) => {
      const row = document.createElement("li");
      const rateLabelNode = document.createElement("strong");
      rateLabelNode.textContent = `${rate} Hz`;
      const code = document.createElement("code");
      code.textContent = command;
      const remove = document.createElement("button");
      const inUse = state.globalRate === rate || state.games.some((game) => game.rate === rate) || state.shortcuts.some((item) => item.action === "setGlobal" && item.rate === rate);
      remove.type = "button";
      remove.className = "icon-button remove-button mapping-remove";
      remove.disabled = inUse;
      remove.title = inUse ? t("mappingInUse") : t("removeMapping");
      remove.setAttribute("aria-label", `${t("removeMapping")} ${rate} Hz`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
      remove.addEventListener("click", () => {
        if (inUse) return;
        state.rates.delete(rate);
        renderRates();
        updateDirty();
        setMessage(t("mappingRemoved"));
      });
      row.append(rateLabelNode, code, remove);
      return row;
    }));
  }

  function renderService() {
    const status = state.service.state || (state.enabled ? "starting" : "disabled");
    const labels = {
      disabled: "statusDisabled", waiting: "statusWaiting", starting: "statusStarting",
      running: "statusRunning", degraded: "statusDegraded", error: "statusError", unavailable: "statusUnavailable"
    };
    const descriptions = {
      disabled: "engineStateOff", waiting: "engineStateWaiting", starting: "engineStateStarting",
      running: "engineStateRunning", degraded: "engineStateDegraded", error: "engineStateError", unavailable: "engineStateUnavailable"
    };
    const statusNode = $("service-status");
    statusNode.textContent = t(labels[status] || "statusUnavailable");
    statusNode.className = `status-value ${status}`;
    $("enabled").checked = state.enabled;
    $("enabled-label").textContent = t(state.enabled ? "enabled" : "disabled");
    $("enabled-state-dot").className = `state-dot ${state.enabled ? "enabled-dot" : ""}`;
    $("status-description").textContent = t(descriptions[status] || "engineStateUnavailable");
    const foreground = state.enabled ? (state.service.foreground_package || "") : "";
    $("foreground-package").textContent = foreground || "—";
    const reportedName = (state.service.foreground_name || "").trim();
    const knownName = reportedName || (state.appInfo.get(foreground) || {}).name || state.appNames.get(foreground) || "";
    $("foreground-name").textContent = foreground ? (knownName || t("unknownApp")) : t("unknownApp");
    const iconHost = $("foreground-icon");
    iconHost.replaceChildren();
    if (foreground) iconHost.append(appIcon(foreground, appLabel(foreground)));
    else {
      const fallback = document.createElement("span");
      fallback.className = "app-icon-placeholder";
      fallback.textContent = "—";
      iconHost.append(fallback);
    }
    $("current-rate").textContent = state.enabled && state.service.rate ? state.service.rate : "—";
    const modeLabel = state.service.mode === "events" ? "eventModeEvents"
      : state.service.mode === "observer" ? "eventModeObserver"
        : state.service.mode === "polling" ? "eventModePolling" : "eventModeStarting";
    let modeText = t(modeLabel);
    if (state.service.fallback_active === "1" && state.service.fallback_package) {
      modeText += t("fallbackActiveFor", { app: appLabel(state.service.fallback_package) });
    }
    $("event-mode").textContent = modeText;
    const heartbeat = Number(state.service.heartbeat || 0);
    $("heartbeat-time").textContent = heartbeat ? t("recentHeartbeat", { seconds: Math.max(0, Math.floor(Date.now() / 1000 - heartbeat)) }) : t("noHeartbeat");
  }

  function renderAll() {
    renderRates();
    renderService();
    updateDirty();
  }

  function parseFields(text) {
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1).trim();
    }
    return values;
  }

  async function managerInfo() {
    const isKsu = Boolean(window.ksu);
    const isMagisk = Boolean(window.magisk);
    $("manager-name").textContent = t(isKsu ? "managerKsu" : isMagisk ? "managerMagisk" : "managerUnknown");
    try {
      // 每条 getprop 加固定前缀：某个属性为空时不会让后续字段整体前移。
      const output = await exec("printf 'M:%s\\n' \"$(getprop ro.product.manufacturer)\"; printf 'D:%s\\n' \"$(getprop ro.product.model)\"; printf 'A:%s\\n' \"$(getprop ro.build.version.release)\"");
      const lines = output.split(/\r?\n/);
      const pick = (prefix) => (lines.find((line) => line.startsWith(prefix)) || "").slice(2).trim();
      const manufacturer = pick("M:");
      const model = pick("D:");
      const android = pick("A:");
      $("device-info").textContent = [manufacturer, model].filter(Boolean).join(" ") || "—";
      $("android-version").textContent = android || "—";
    } catch {
      $("device-info").textContent = "—";
      $("android-version").textContent = "—";
    }
  }

  async function loadApplicationInfo(packages) {
    const unique = [...new Set(packages)].filter((name) => PACKAGE_PATTERN.test(name) && !state.appInfo.has(name));
    if (!unique.length || !window.ksu || typeof window.ksu.getPackagesInfo !== "function") return;
    try {
      let result = await window.ksu.getPackagesInfo(JSON.stringify(unique));
      if (typeof result === "string") result = JSON.parse(result);
      if (!Array.isArray(result) && result && typeof result === "object") result = Object.values(result);
      if (!Array.isArray(result)) return;
      let namesChanged = false;
      for (const info of result) {
        if (!info || typeof info !== "object") continue;
        const packageName = info.packageName || info.package_name || info.package || info.name;
        if (!unique.includes(packageName)) continue;
        const displayName = info.appName || info.appLabel || info.label || info.applicationLabel || info.title || packageName;
        state.appInfo.set(packageName, { name: displayName });
        const cleaned = cleanName(displayName);
        if (cleaned && cleaned !== packageName && state.appNames.get(packageName) !== cleaned) {
          state.appNames.set(packageName, cleaned);
          namesChanged = true;
        }
      }
      if (namesChanged) persistAppNames();
      renderGameRules();
      renderFallbackApps();
      renderService();
    } catch { /* Package names and placeholder icons remain available without the optional KSU API. */ }
  }

  function serializeConfig() {
    if (!state.rates.has(state.globalRate)) throw new Error(t("invalidGlobal"));
    const unique = new Set();
    for (const game of state.games) {
      if (!PACKAGE_PATTERN.test(game.package)) throw new Error(t("invalidPackage"));
      if (!state.rates.has(game.rate)) throw new Error(t("invalidRuleRate", { rate: game.rate }));
      if (unique.has(game.package)) throw new Error(t("duplicatePackageSave", { package: game.package }));
      unique.add(game.package);
    }
    const lines = [`global_sample_rate=${state.globalRate}`];
    for (const { package: name, rate } of state.games) {
      const label = cleanName(state.appNames.get(name) || "");
      if (label) lines.push(`#${label}`);
      lines.push(`${name}=${rate}`);
    }
    return lines.join("\n") + "\n";
  }

  // 保留原注释块不动：raw 行原样输出，rate 行只重写等号右边。
  // 删除映射时其上方注释作为孤立注释保留；新增映射追加到末尾；
  // 重复 rate 行只输出第一个。返回的 layout 由 writeSettings 在写盘成功后提交。
  function serializeRates() {
    const emitted = new Set();
    const nextLayout = [];
    const lines = [];
    for (const entry of state.rateLayout || []) {
      if (entry.type === "raw") {
        lines.push(entry.text);
        nextLayout.push({ type: "raw", text: entry.text });
        continue;
      }
      if (emitted.has(entry.rate) || !state.rates.has(entry.rate)) continue;
      const command = state.rates.get(entry.rate);
      lines.push(`${entry.rate}=${command}`);
      nextLayout.push({ type: "rate", rate: entry.rate, command });
      emitted.add(entry.rate);
    }
    for (const [rate, command] of [...state.rates.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (emitted.has(rate)) continue;
      lines.push(`${rate}=${command}`);
      nextLayout.push({ type: "rate", rate, command });
      emitted.add(rate);
    }
    return { text: lines.join("\n") + "\n", layout: nextLayout };
  }

  function serializeMonitorConfig() {
    if (!["observer", "polling"].includes(state.fallbackMethod)) throw new Error(t("fallbackMethodLabel"));
    if (!/^\d{1,2}$/.test(state.fallbackInterval) || Number(state.fallbackInterval) < 1 || Number(state.fallbackInterval) > 60) {
      throw new Error(t("invalidFallbackInterval"));
    }
    const unique = new Set();
    for (const packageName of state.fallbackPackages) {
      if (!PACKAGE_PATTERN.test(packageName)) throw new Error(t("invalidPackage"));
      if (unique.has(packageName)) throw new Error(t("duplicateFallbackPackage", { package: packageName }));
      unique.add(packageName);
    }
    return [
      `fallback_enabled=${state.fallbackEnabled ? 1 : 0}`,
      `fallback_method=${state.fallbackMethod}`,
      `poll_interval=${state.fallbackInterval}`,
      ...state.fallbackPackages.map((packageName) => `fallback_package=${packageName}`),
      ""
    ].join("\n");
  }

  async function writeSettings() {
    const config = toBase64(serializeConfig());
    const ratesOutput = serializeRates();
    const rates = toBase64(ratesOutput.text);
    const monitor = toBase64(serializeMonitorConfig());
    const names = toBase64(serializeAppNames());
    const command = `printf '%s' '${config}' | base64 -d > '${CONFIG_PATH}.tmp' && printf '%s' '${rates}' | base64 -d > '${RATE_PATH}.tmp' && printf '%s' '${monitor}' | base64 -d > '${MONITOR_CONFIG_PATH}.tmp' && printf '%s' '${names}' | base64 -d > '${APP_NAMES_PATH}.tmp' && chmod 0600 '${CONFIG_PATH}.tmp' '${RATE_PATH}.tmp' '${MONITOR_CONFIG_PATH}.tmp' '${APP_NAMES_PATH}.tmp' && mv '${CONFIG_PATH}.tmp' '${CONFIG_PATH}' && mv '${RATE_PATH}.tmp' '${RATE_PATH}' && mv '${MONITOR_CONFIG_PATH}.tmp' '${MONITOR_CONFIG_PATH}' && mv '${APP_NAMES_PATH}.tmp' '${APP_NAMES_PATH}'`;
    // 单条 exec 命令长度上限保护；保留「四个 .tmp 全写好再统一 chmod+mv」的准原子性。
    if (command.length > MAX_WRITE_COMMAND) throw new Error(t("configTooLarge"));
    await exec(command);
    // 写盘成功后才提交新版式，避免写入失败时内存与磁盘不一致、再次保存重复追加。
    state.rateLayout = ratesOutput.layout;
  }

  async function restartIfEnabled() {
    if (!state.enabled) return;
    // 交给常驻监督进程热重启工作进程：不杀监督进程、不写 stop.flag、不重新拉起服务，
    // 彻底避开「旧进程卡在 wait + 新进程被单实例检查挡掉」的竞态。
    // restart.flag 是边沿触发标记，重试可能让监督进程多热重启一次，因此不做重试。
    await exec(`: > '${RESTART_PATH}'`);
    state.service = { ...state.service, state: "starting" };
    renderService();
  }

  async function saveSettings() {
    serializeConfig();
    const previous = state.original ? JSON.parse(state.original) : null;
    const currentRates = [...state.rates.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    const runtimeChanged = !previous
      || previous.globalRate !== state.globalRate
      || JSON.stringify(previous.games) !== JSON.stringify(state.games)
      || JSON.stringify(previous.rates) !== JSON.stringify(currentRates)
      || previous.fallbackEnabled !== state.fallbackEnabled
      || previous.fallbackMethod !== state.fallbackMethod
      || previous.fallbackInterval !== state.fallbackInterval
      || JSON.stringify(previous.fallbackPackages) !== JSON.stringify(state.fallbackPackages);
    if (runtimeChanged) await writeSettings();
    localWrite("touch-ui-shortcuts", JSON.stringify(state.shortcuts));
    state.dirty = false;
    snapshot();
    $("save-bar").hidden = true;
    setMessage(t("settingsSaved"));
    if (runtimeChanged) {
      // 磁盘已写入、dirty 已清；重启失败只提示，不回滚 UI，不抛到外层覆盖「已保存」。
      try {
        await restartIfEnabled();
      } catch (error) {
        setMessage(t("savedButRestartFailed", { error: error.message }), true);
      }
    }
  }

  async function refreshStatus() {
    // exec 若在 WebView 后台卡住，polling 会永久为 true；超时强制解锁。
    // exec() 单次 8s、execWithRetry 最多两次共 16s，阈值必须大于最坏耗时。
    if (state.polling) {
      if (Date.now() - state.pollingSince > 20000) state.polling = false;
      else return;
    }
    state.polling = true;
    state.pollingSince = Date.now();
    try {
      const snapshot = await execWithRetry(
        `enabled=$(cat '${FLAG_PATH}' 2>/dev/null || true); ` +
        `status=$(cat '${STATUS_PATH}' 2>/dev/null || true); ` +
        `watchdog_status=$(cat '${WATCHDOG_STATUS_PATH}' 2>/dev/null || true); ` +
        `boot=$(getprop sys.boot_completed 2>/dev/null || true); ` +
        `process=stopped; pid=$(cat '${PID_PATH}' 2>/dev/null); ` +
        `case "$pid" in ''|*[!0-9]*) ;; *) if kill -0 "$pid" 2>/dev/null && tr '\\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null | ${SERVICE_CMD_MATCH}; then process=running; fi ;; esac; ` +
        `watchdog=stopped; wpid=$(cat '${WATCHDOG_PID_PATH}' 2>/dev/null); ` +
        `case "$wpid" in ''|*[!0-9]*) ;; *) if kill -0 "$wpid" 2>/dev/null; then watchdog=running; fi ;; esac; ` +
        `printf 'enabled=%s\\nprocess=%s\\npid_value=%s\\nwatchdog=%s\\nboot=%s\\n--status--\\n%s\\n--watchdog--\\n%s\\n' "$enabled" "$process" "$pid" "$watchdog" "$boot" "$status" "$watchdog_status"`
      );
      const statusSep = snapshot.indexOf("--status--\n");
      const watchdogSep = snapshot.indexOf("--watchdog--\n");
      const fields = parseFields(statusSep >= 0 ? snapshot.slice(0, statusSep) : snapshot);
      const statusBlock = statusSep >= 0
        ? snapshot.slice(statusSep + 11, watchdogSep >= 0 ? watchdogSep : snapshot.length) : "";
      const watchdogBlock = watchdogSep >= 0 ? snapshot.slice(watchdogSep + 13) : "";
      const reported = parseFields(statusBlock);
      const watchdog = parseFields(watchdogBlock);
      const isEnabled = fields.enabled === "1";
      if (isEnabled && !state.enabledAt) state.enabledAt = Date.now();
      if (!isEnabled) state.enabledAt = 0;
      state.enabled = isEnabled;

      const processRunning = fields.process === "running";
      const watchdogRunning = fields.watchdog === "running";
      const heartbeat = Number(reported.heartbeat || 0);
      const heartbeatFresh = heartbeat > 0 && Date.now() / 1000 - heartbeat <= 45;
      const stateSince = Number(reported.state_since || 0);
      const recentlyStarted = stateSince > 0 && Date.now() / 1000 - stateSince < 20000;
      const pidMatches = Boolean(reported.pid) && Boolean(fields.pid_value) && reported.pid === fields.pid_value;
      // 只有工作进程确实在跑、心跳新鲜、且状态文件属于当前进程，才算真的运行中。
      const workerEvidence = processRunning && heartbeatFresh && pidMatches;
      const watchdogHeartbeat = Number(watchdog.watchdog_heartbeat || 0);
      const watchdogFresh = watchdogHeartbeat > 0 && Date.now() / 1000 - watchdogHeartbeat <= 30;
      const watchdogState = watchdog.watchdog_state || "";
      const staleError = reported.state === "error" && (workerEvidence || watchdogFresh);
      let serviceState = "disabled";
      if (state.enabled) {
        if (!processRunning && !watchdogRunning && !watchdogFresh) {
          serviceState = fields.boot !== "1" ? "waiting" : recentlyStarted ? "starting" : "error";
        } else if (!workerEvidence) {
          // 工作进程不在、心跳停了，或状态文件是上一个进程留下的：不能显示运行中。
          serviceState = (watchdogRunning || watchdogFresh) && recentlyStarted ? "starting" : "error";
        } else if (reported.state === "starting" || watchdogState === "cooldown") {
          serviceState = "starting";
        } else if (reported.state === "error") {
          serviceState = staleError ? "starting" : "error";
        } else if (["running", "degraded"].includes(reported.state)) {
          serviceState = reported.state;
        } else {
          serviceState = "starting";
        }
      }
      state.service = {
        ...reported, ...watchdog, process: fields.process, watchdog: fields.watchdog,
        stale_error: staleError ? "1" : "0", state: serviceState
      };
      state.unavailable = false;
      renderService();
      if (reported.foreground_package || reported.fallback_package) {
        loadApplicationInfo([reported.foreground_package, reported.fallback_package].filter(Boolean));
      }
    } catch {
      // 读不到磁盘状态时，不能继续显示「已启用 / 运行中」这类确定性结论。
      state.unavailable = true;
      state.service = { ...state.service, state: "unavailable" };
      renderService();
      setMessage(t("refreshFailed"), true);
    } finally {
      state.loaded = true;
      state.polling = false;
      state.pollingSince = 0;
    }
  }

  async function refreshLog() {
    try {
      const log = await exec(`tail -n 100 '${MODULE_DIR}/touch_opt.log' 2>/dev/null || true`);
      $("log-output").textContent = log || t("emptyLog");
    } catch (error) { $("log-output").textContent = error.message; }
  }

  async function load() {
    try {
      const [configText, rateText, enabledText, monitorText, namesText] = await Promise.all([
        exec(`cat '${CONFIG_PATH}' 2>/dev/null || true`),
        exec(`cat '${RATE_PATH}' 2>/dev/null || true`),
        exec(`cat '${FLAG_PATH}' 2>/dev/null || true`),
        exec(`cat '${MONITOR_CONFIG_PATH}' 2>/dev/null || true`),
        exec(`cat '${APP_NAMES_PATH}' 2>/dev/null || true`)
      ]);
      if (!rateText) throw new Error("Touch rate mapping is unavailable");
      state.rates = parseRates(rateText);
      state.rateLayout = parseRateLayout(rateText);
      state.appNames = parseAppNames(namesText);
      const config = parseConfig(configText);
      const monitorConfig = parseMonitorConfig(monitorText);
      state.games = config.games;
      state.globalRate = config.globalRate;
      state.fallbackEnabled = monitorConfig.fallbackEnabled;
      state.fallbackMethod = monitorConfig.fallbackMethod;
      state.fallbackInterval = monitorConfig.fallbackInterval;
      state.fallbackPackages = monitorConfig.fallbackPackages;
      state.enabled = enabledText === "1";
      state.shortcuts = readShortcuts();
      state.loaded = true;
      state.unavailable = false;
      snapshot();
      applyTranslations();
      await Promise.all([refreshStatus(), refreshLog(), managerInfo()]);
      loadApplicationInfo(state.games.map((game) => game.package).concat(state.fallbackPackages, state.service.foreground_package || [], state.service.fallback_package || []));
      if (config.duplicates.length) {
        setMessage(t("duplicateRulesMerged", { count: config.duplicates.length }), true);
      }
    } catch (error) {
      state.unavailable = true;
      state.service = { state: "unavailable" };
      renderAll();
      setMessage(error.message, true);
    }
  }

  function goTo(page) {
    if (!["home", "config", "about"].includes(page)) return;
    document.querySelectorAll(".page").forEach((element) => {
      const active = element.dataset.page === page;
      element.hidden = !active;
      element.classList.toggle("active", active);
    });
    document.querySelectorAll(".nav-item").forEach((button) => {
      const active = button.dataset.goto === page;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (page === "about") refreshLog();
    // 先切 hidden 再立即置顶，避免 smooth 动画与 page-in 动画叠加造成视觉错位。
    $("app-shell").scrollTo({ top: 0, behavior: "auto" });
  }

  function askBeforeAction(action) {
    if (!state.dirty) return Promise.resolve().then(action).catch((error) => setMessage(t("serviceActionError", { error: error.message }), true));
    pendingAction = action;
    if (!$("unsaved-dialog").open) $("unsaved-dialog").showModal();
    return Promise.resolve();
  }

  async function finishPending(choice) {
    const task = pendingAction;
    if (choice === "continue") {
      pendingAction = null;
      $("unsaved-dialog").close();
      return;
    }
    try {
      if (choice === "save") await saveSettings();
      else restoreDraft();
      pendingAction = null;
      $("unsaved-dialog").close();
      if (task) await task();
    } catch (error) {
      setMessage(t("serviceActionError", { error: error.message }), true);
    }
  }

  async function setEnabled(enabled) {
    try {
      if (enabled) {
        if (state.dirty) await saveSettings();
        await exec(`rm -f '${STOP_PATH}' '${RESTART_PATH}' && printf '1\\n' > '${FLAG_PATH}.tmp' && chmod 0600 '${FLAG_PATH}.tmp' && mv '${FLAG_PATH}.tmp' '${FLAG_PATH}' && (nohup sh '${SERVICE_PATH}' >/dev/null 2>&1 </dev/null &)`);
        state.enabledAt = Date.now();
        setMessage(t("enabledMessage"));
      } else {
        await exec(`printf '0\\n' > '${FLAG_PATH}.tmp' && chmod 0600 '${FLAG_PATH}.tmp' && mv '${FLAG_PATH}.tmp' '${FLAG_PATH}' && : > '${STOP_PATH}' && rm -f '${RESTART_PATH}' && { for f in '${WATCHDOG_PID_PATH}' '${PID_PATH}'; do pid=$(cat "$f" 2>/dev/null); case "$pid" in ''|*[!0-9]*) ;; *) if kill -0 "$pid" 2>/dev/null && tr '\\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null | ${SERVICE_CMD_MATCH}; then kill "$pid" 2>/dev/null || true; fi ;; esac; done; }`);
        state.enabledAt = 0;
        setMessage(t("disabledMessage"));
      }
    } finally {
      // root 命令可能超时或返回非零，但磁盘状态可能已经改变。
      // 无论成功失败都重新渲染并强制回读磁盘，避免界面冻结在上一次状态。
      state.enabled = enabled;
      state.service = { ...state.service, state: enabled ? "starting" : "disabled" };
      renderService();
      window.setTimeout(refreshStatus, 300);
    }
  }

  function runShortcut(index) {
    const shortcut = { ...state.shortcuts[index] };
    if (!shortcut.action) return;
    askBeforeAction(async () => {
      if (shortcut.action === "enable") return setEnabled(true);
      if (shortcut.action === "disable") return setEnabled(false);
      if (shortcut.action === "setGlobal") {
        if (!state.rates.has(shortcut.rate)) throw new Error(t("invalidRuleRate", { rate: shortcut.rate }));
        state.globalRate = shortcut.rate;
        $("global-rate").value = shortcut.rate;
        $("home-global-rate").value = shortcut.rate;
        $("global-rate-value").textContent = shortcut.rate;
        updateDirty();
        await saveSettings();
        setMessage(t("setGlobalDone"));
      }
    });
  }

  function exitWebUi(guardReinserted) {
    try {
      if (window.ksu && typeof window.ksu.exit === "function") return window.ksu.exit();
      if (window.magisk && typeof window.magisk.exit === "function") return window.magisk.exit();
    } catch { /* Fall back to the WebView history. */ }
    // ksu.exit()/magisk.exit() 可用时上面已直接 return；只有两者都缺失才走到这里，
    // 因此下面的兜底是低优先级。历史条目不足时 go(-2) 会被浏览器忽略。
    window.history.go(guardReinserted ? -2 : -1);
    if (exitFallbackUsed) return;
    exitFallbackUsed = true;
    window.setTimeout(() => {
      if (document.hidden) return;
      // 只尝试一次关闭，不主动 back()，避免与 guardBack 的守卫形成循环。
      try { window.close(); } catch { /* WebView 可能禁止脚本关闭窗口。 */ }
    }, 400);
  }

  function guardBack() {
    window.history.pushState({ touchUiGuard: true }, "", `${window.location.pathname}${window.location.search}#touch-ui`);
    window.addEventListener("popstate", () => {
      if (state.dirty) {
        pendingAction = () => exitWebUi(true);
        // 连续 popstate 时对话框可能已经打开，重复 showModal() 会抛 InvalidStateError。
        if (!$("unsaved-dialog").open) $("unsaved-dialog").showModal();
        window.history.pushState({ touchUiGuard: true }, "", `${window.location.pathname}${window.location.search}#touch-ui`);
      } else {
        exitWebUi(false);
      }
    });
  }

  function changeGlobalRate(value) {
    if (state.globalRate === value) return;
    state.globalRate = value;
    $("global-rate").value = value;
    $("home-global-rate").value = value;
    $("global-rate-value").textContent = value;
    updateDirty();
    renderRateList();
  }

  document.querySelectorAll("[data-language-mode]").forEach((button) => button.addEventListener("click", () => {
    state.languageMode = button.dataset.languageMode;
    localWrite("touch-ui-language-mode", state.languageMode);
    applyTranslations();
  }));
  document.querySelectorAll("[data-theme-mode]").forEach((button) => button.addEventListener("click", () => {
    state.themeMode = button.dataset.themeMode;
    localWrite("touch-ui-theme-mode", state.themeMode);
    applyTranslations();
  }));
  document.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => goTo(button.dataset.goto)));
  $("global-rate").addEventListener("change", (event) => changeGlobalRate(event.target.value));
  $("home-global-rate").addEventListener("change", (event) => changeGlobalRate(event.target.value));
  $("add-rule-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const packageName = $("new-package").value.trim();
    const rate = $("new-rate").value;
    if (!PACKAGE_PATTERN.test(packageName)) return setMessage(t("invalidPackage"), true);
    if (state.games.some((game) => game.package === packageName)) return setMessage(t("duplicatePackage", { package: packageName }), true);
    state.games.push({ package: packageName, rate });
    $("new-package").value = "";
    renderGameRules();
    updateDirty();
    renderRateList();
    loadApplicationInfo([packageName]);
    setMessage(t("ruleAdded"));
  });
  $("fallback-enabled").addEventListener("change", (event) => {
    state.fallbackEnabled = event.target.checked;
    updateDirty();
  });
  $("fallback-method").addEventListener("change", (event) => {
    state.fallbackMethod = event.target.value;
    renderMonitorSettings();
    updateDirty();
  });
  $("fallback-interval").addEventListener("input", (event) => {
    state.fallbackInterval = event.target.value;
    updateDirty();
  });
  $("add-fallback-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const packageName = $("fallback-package").value.trim();
    if (!PACKAGE_PATTERN.test(packageName)) return setMessage(t("invalidPackage"), true);
    if (state.fallbackPackages.includes(packageName)) return setMessage(t("duplicateFallbackPackage", { package: packageName }), true);
    state.fallbackPackages.push(packageName);
    $("fallback-package").value = "";
    renderFallbackApps();
    updateDirty();
    loadApplicationInfo([packageName]);
    setMessage(t("fallbackAppAdded"));
  });
  $("rate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const rate = $("rate-id").value.trim();
    const command = $("rate-command").value.trim();
    if (!/^\d{1,4}$/.test(rate) || Number(rate) < 1) return setMessage(t("invalidRateId"), true);
    if (!COMMAND_PATTERN.test(command)) return setMessage(t("invalidCommand"), true);
    if (state.rates.has(rate)) return setMessage(t("rateExists", { rate }), true);
    state.rates.set(rate, command);
    $("rate-id").value = "";
    $("rate-command").value = "";
    renderRates();
    updateDirty();
    setMessage(t("mappingAdded"));
  });
  $("enabled").addEventListener("change", (event) => {
    const requested = event.target.checked;
    event.target.checked = state.enabled;
    askBeforeAction(() => setEnabled(requested));
  });
  $("save-settings").addEventListener("click", async () => {
    try { await saveSettings(); } catch (error) { setMessage(error.message, true); }
  });
  $("refresh-log").addEventListener("click", refreshLog);
  $("dialog-save").addEventListener("click", () => finishPending("save"));
  $("dialog-discard").addEventListener("click", () => finishPending("discard"));
  $("dialog-continue").addEventListener("click", () => finishPending("continue"));
  $("unsaved-dialog").addEventListener("cancel", () => { pendingAction = null; });

  const onSystemThemeChange = () => { if (state.themeMode === "system") applyTranslations(); };
  if (mediaTheme) {
    if (typeof mediaTheme.addEventListener === "function") mediaTheme.addEventListener("change", onSystemThemeChange);
    else if (typeof mediaTheme.addListener === "function") mediaTheme.addListener(onSystemThemeChange);
  }
  window.addEventListener("languagechange", () => { if (state.languageMode === "system") applyTranslations(); });

  applyTranslations();
  guardBack();
  load();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refreshStatus();
    if (!$("page-about").hidden) refreshLog();
  });
  window.setInterval(() => {
    refreshStatus();
    if (!$("page-about").hidden) refreshLog();
  }, 5000);
})();
