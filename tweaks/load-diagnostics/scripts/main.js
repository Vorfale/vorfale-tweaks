const SOCKET_TYPE = "load-diagnostics:client-report";
const STORAGE_KEY = "vorfaleTweaks.loadDiagnostics.lastRun";
const HISTORY_KEY = "vorfaleTweaks.loadDiagnostics.history";
const MAX_RESOURCES = 400;
const MAX_ERRORS = 80;
const MAX_HISTORY = 5;
const SLOW_RESOURCE_MS = 2000;
const LARGE_RESOURCE_BYTES = 5 * 1024 * 1024;

let context;
let run;
let observer;
let saveTimer = 0;
const remoteReports = new Map();

export function init(tweakContext) {
  context = tweakContext;
  if (!context.isEnabled()) return;

  run = createRun();

  mark("tweak:init", "Vorfale Load Diagnostics initialized");
  configurePerformanceBuffer();
  observeResources();
  captureErrors();
  captureMilestones();

  Hooks.once("ready", onReady);
  Hooks.on("getSceneControlButtons", addSceneControlButton);
  Hooks.on("vorfaleTweaks.changed", changedId => {
    if (changedId === context.id) schedulePersist();
  });
}

function onReady() {
  mark("foundry:ready", "Foundry ready hook reached");
  captureUser();
  captureEnvironment();
  capturePackageSnapshot();
  setupSocket();
  scheduleClientReport();
  schedulePersist();
}

function captureMilestones() {
  const onceHooks = [
    ["setup", "foundry:setup"],
    ["canvasInit", "canvas:init"],
    ["canvasReady", "canvas:ready"],
    ["renderSidebar", "ui:sidebar-rendered"],
    ["renderChatLog", "ui:chat-log-rendered"],
    ["renderChatInput", "ui:chat-input-rendered"],
    ["renderSceneControls", "ui:scene-controls-rendered"]
  ];

  for (const [hook, name] of onceHooks) {
    Hooks.once(hook, () => {
      mark(name);
      if (hook === "canvasReady") {
        captureSceneSnapshot();
        scheduleClientReport();
      }
    });
  }
}

function configurePerformanceBuffer() {
  try {
    performance.setResourceTimingBufferSize?.(2000);
  } catch (error) {
    recordError("performance-buffer", error);
  }
}

function observeResources() {
  if (!globalThis.PerformanceObserver) return;

  try {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) recordResource(entry);
      schedulePersist();
    });
    observer.observe({ type: "resource", buffered: true });
  } catch (error) {
    recordError("resource-observer", error);
  }
}

function captureErrors() {
  window.addEventListener("error", event => {
    recordError("window-error", event.error ?? event.message, {
      filename: event.filename,
      line: event.lineno,
      column: event.colno
    });
  });

  window.addEventListener("unhandledrejection", event => {
    recordError("unhandled-rejection", event.reason);
  });
}

function addSceneControlButton(controls) {
  const tools = controls?.tokens?.tools ?? controls?.token?.tools ?? Object.values(controls ?? {})[0]?.tools;
  if (!tools) return;

  tools.vorfaleLoadDiagnostics = {
    name: "vorfaleLoadDiagnostics",
    title: context.localize("Tooltip"),
    icon: "fa-solid fa-stopwatch",
    order: Object.keys(tools).length + 100,
    button: true,
    visible: context.isEnabled(),
    onChange: () => openReportDialog()
  };
}

function setupSocket() {
  const socket = game.socket;
  if (!socket?.on) return;

  socket.on(`module.${context.moduleId}`, data => {
    if (data?.type !== SOCKET_TYPE) return;
    if (!game.user?.isGM) return;
    if (!data.report?.user?.id) return;
    remoteReports.set(data.report.user.id, data.report);
    schedulePersist();
  });
}

function scheduleClientReport() {
  window.setTimeout(() => {
    if (!context.isEnabled()) return;
    const report = buildReport();
    if (game.user?.isGM) remoteReports.set(report.user.id, report);
    else game.socket?.emit?.(`module.${context.moduleId}`, { type: SOCKET_TYPE, report });
  }, 1500);
}

function mark(id, label = id) {
  run.marks.push({
    id,
    label,
    at: round(performance.now()),
    wallTime: new Date().toISOString()
  });
  schedulePersist();
}

function recordResource(entry) {
  if (!entry?.name) return;

  const resource = normalizeResource(entry);
  const existing = run.resources.find(item => item.name === resource.name && item.startTime === resource.startTime);
  if (existing) return;

  run.resources.push(resource);
  if (run.resources.length > MAX_RESOURCES) {
    run.resources.sort((a, b) => b.duration - a.duration);
    run.resources.length = MAX_RESOURCES;
  }
}

function normalizeResource(entry) {
  const url = safeUrl(entry.name);
  return {
    name: stripOrigin(entry.name),
    type: entry.initiatorType || classifyResource(entry.name),
    extension: getExtension(entry.name),
    module: moduleFromUrl(entry.name),
    duration: round(entry.duration),
    startTime: round(entry.startTime),
    transferSize: entry.transferSize || 0,
    encodedBodySize: entry.encodedBodySize || 0,
    decodedBodySize: entry.decodedBodySize || 0,
    host: url?.host ?? ""
  };
}

function recordError(source, error, extra = {}) {
  run.errors.push({
    source,
    message: error?.message ?? String(error ?? ""),
    stack: error?.stack ?? "",
    at: round(performance.now()),
    ...extra
  });
  if (run.errors.length > MAX_ERRORS) run.errors.splice(0, run.errors.length - MAX_ERRORS);
  schedulePersist();
}

function captureEnvironment() {
  const nav = navigator;
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;

  run.environment = {
    foundryVersion: game.version ?? game.data?.version ?? "",
    system: {
      id: game.system?.id ?? "",
      title: game.system?.title ?? "",
      version: game.system?.version ?? ""
    },
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    connection: connection ? {
      effectiveType: connection.effectiveType ?? "",
      downlink: connection.downlink ?? null,
      rtt: connection.rtt ?? null,
      saveData: connection.saveData ?? false
    } : null,
    webgl: getWebGLInfo(),
    screen: {
      width: screen.width,
      height: screen.height,
      devicePixelRatio: window.devicePixelRatio
    }
  };
}

function captureUser() {
  const user = game.user;
  run.user = {
    id: user?.id ?? run.user.id ?? "",
    name: user?.name ?? run.user.name ?? "",
    role: user?.role ?? run.user.role ?? null,
    isGM: user?.isGM ?? run.user.isGM ?? false
  };
}

function capturePackageSnapshot() {
  run.packages = {
    activeModules: Array.from(game.modules?.values?.() ?? [])
      .filter(module => module.active)
      .map(module => ({
        id: module.id,
        title: module.title,
        version: module.version
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    inactiveModuleCount: Array.from(game.modules?.values?.() ?? []).filter(module => !module.active).length
  };
}

function captureSceneSnapshot() {
  const scene = globalThis.canvas?.scene ?? game.scenes?.active ?? game.user?.viewedScene;
  if (!scene) return;

  run.scene = {
    id: scene.id,
    name: scene.name,
    active: scene.active,
    dimensions: {
      width: scene.width,
      height: scene.height,
      padding: scene.padding,
      gridSize: scene.grid?.size ?? scene.gridSize
    },
    counts: {
      tokens: scene.tokens?.size ?? scene.tokens?.length ?? 0,
      tiles: scene.tiles?.size ?? scene.tiles?.length ?? 0,
      walls: scene.walls?.size ?? scene.walls?.length ?? 0,
      lights: scene.lights?.size ?? scene.lights?.length ?? 0,
      sounds: scene.sounds?.size ?? scene.sounds?.length ?? 0,
      drawings: scene.drawings?.size ?? scene.drawings?.length ?? 0,
      regions: scene.regions?.size ?? scene.regions?.length ?? 0
    },
    background: scene.background?.src ?? scene.img ?? "",
    foreground: scene.foreground ?? "",
    darkness: scene.darkness
  };
}

function openReportDialog() {
  if (!context.isEnabled()) {
    ui.notifications.warn(context.localize("NoData"));
    return;
  }

  captureEnvironment();
  capturePackageSnapshot();
  captureSceneSnapshot();
  collectBufferedResources();
  persistNow();

  const report = buildReport();
  const html = renderReport(report);
  new Dialog({
    title: context.localize("ReportTitle"),
    content: html,
    buttons: {
      download: {
        icon: '<i class="fa-solid fa-download"></i>',
        label: context.localize("DownloadReport"),
        callback: () => downloadReport(report)
      },
      copy: {
        icon: '<i class="fa-solid fa-copy"></i>',
        label: context.localize("CopySummary"),
        callback: () => copySummary(report)
      },
      close: {
        icon: '<i class="fa-solid fa-xmark"></i>',
        label: context.localize("Close")
      }
    },
    default: "download"
  }, {
    classes: ["vorfale-load-diagnostics-dialog"],
    width: 760
  }).render(true);
}

function buildReport() {
  collectBufferedResources();
  const resources = run.resources.slice().sort((a, b) => b.duration - a.duration);
  const moduleResources = summarizeModuleResources(resources);
  const report = {
    ...run,
    completedAt: new Date().toISOString(),
    totalRuntimeMs: round(performance.now() - run.startedAt),
    resources,
    slowResources: resources.filter(resource => resource.duration >= SLOW_RESOURCE_MS).slice(0, 30),
    largeResources: resources.filter(resource => resource.transferSize >= LARGE_RESOURCE_BYTES).slice(0, 30),
    moduleResources,
    recommendations: buildRecommendations(resources, moduleResources),
    playerReports: game.user?.isGM ? Array.from(remoteReports.values()).map(summarizeRemoteReport) : []
  };
  report.summary = buildSummary(report);
  return report;
}

function buildSummary(report) {
  const ready = findMark(report, "foundry:ready");
  const canvasReady = findMark(report, "canvas:ready");
  return {
    user: report.user.name,
    totalRuntimeMs: report.totalRuntimeMs,
    readyMs: ready?.at ?? null,
    canvasReadyMs: canvasReady?.at ?? null,
    activeModules: report.packages.activeModules.length,
    resources: report.resources.length,
    slowResources: report.slowResources.length,
    largeResources: report.largeResources.length,
    errors: report.errors.length,
    scene: report.scene?.name ?? ""
  };
}

function buildRecommendations(resources, moduleResources) {
  const recommendations = [];
  const summary = {
    slowResources: resources.filter(resource => resource.duration >= SLOW_RESOURCE_MS),
    largeResources: resources.filter(resource => resource.transferSize >= LARGE_RESOURCE_BYTES),
    activeModules: run.packages.activeModules.length,
    scene: run.scene,
    connection: run.environment.connection,
    hardwareConcurrency: run.environment.hardwareConcurrency,
    deviceMemory: run.environment.deviceMemory,
    errors: run.errors.length
  };

  if (summary.slowResources.length) {
    recommendations.push(`Found ${summary.slowResources.length} resources slower than ${SLOW_RESOURCE_MS} ms. Check the slow resources list first; maps, images, videos, and remote assets are common black-screen causes.`);
  }

  if (summary.largeResources.length) {
    recommendations.push(`Found ${summary.largeResources.length} resources larger than ${formatBytes(LARGE_RESOURCE_BYTES)}. Large scene backgrounds should usually be converted to webp/jpg and kept as small as practical.`);
  }

  if (summary.activeModules > 70) {
    recommendations.push(`There are ${summary.activeModules} active modules. Test the slow player with only core/system/Vorfale Tweaks enabled to rule out module conflicts.`);
  }

  const heavyModule = moduleResources[0];
  if (heavyModule?.duration >= SLOW_RESOURCE_MS) {
    recommendations.push(`The module resource group "${heavyModule.module}" has the highest network time (${formatMs(heavyModule.duration)}). This is not execution profiling, but it is a good first suspect for slow downloads.`);
  }

  const counts = summary.scene?.counts;
  if (counts && (counts.walls > 1200 || counts.tokens > 180 || counts.tiles > 150 || counts.lights > 120 || counts.sounds > 80)) {
    recommendations.push(`The active scene is heavy: ${counts.tokens} tokens, ${counts.tiles} tiles, ${counts.walls} walls, ${counts.lights} lights, ${counts.sounds} sounds. Try loading the player into a small landing scene first.`);
  }

  if (summary.connection?.effectiveType && /(^slow-2g|^2g|^3g)/i.test(summary.connection.effectiveType)) {
    recommendations.push(`Browser reports a slow connection type (${summary.connection.effectiveType}). Prefer smaller maps/audio and avoid VPN/proxy for this player if possible.`);
  }

  if (summary.connection?.downlink && summary.connection.downlink < 3) {
    recommendations.push(`Browser reports low downlink (${summary.connection.downlink} Mbps). Large assets may take minutes to arrive.`);
  }

  if (summary.hardwareConcurrency && summary.hardwareConcurrency <= 4) {
    recommendations.push(`Client has ${summary.hardwareConcurrency} CPU threads reported. Ask the player to close heavy browser tabs/apps and use a browser with hardware acceleration enabled.`);
  }

  if (summary.deviceMemory && summary.deviceMemory <= 4) {
    recommendations.push(`Client reports ${summary.deviceMemory} GB device memory. Avoid very large scenes, animated tiles, and heavy audio/video for this player.`);
  }

  if (summary.errors) {
    recommendations.push(`Captured ${summary.errors} client errors/rejections. Check the errors section and browser console; a single failed module can keep the client on a black screen.`);
  }

  if (!recommendations.length) {
    recommendations.push("No obvious client-side bottleneck was captured. If the player still loads slowly, compare this report with their report and check server/VPN/network path.");
  }

  return recommendations;
}

function renderReport(report) {
  const summary = report.summary;
  return `
    <div class="vorfale-load-report">
      ${section(context.localize("SectionSummary"), `
        <dl class="vorfale-load-summary">
          ${row("User", escapeHTML(summary.user))}
          ${row("Ready", formatMs(summary.readyMs))}
          ${row("Canvas ready", formatMs(summary.canvasReadyMs))}
          ${row("Runtime", formatMs(summary.totalRuntimeMs))}
          ${row("Active modules", summary.activeModules)}
          ${row("Resources", summary.resources)}
          ${row("Errors", summary.errors)}
          ${row("Scene", escapeHTML(summary.scene || "-"))}
        </dl>
      `)}
      ${section(context.localize("SectionRecommendations"), orderedList(report.recommendations))}
      ${section(context.localize("SectionMilestones"), table(["Stage", "Time"], report.marks.map(mark => [mark.label, formatMs(mark.at)])))}
      ${section(context.localize("SectionSlowResources"), table(["Resource", "Time", "Size"], report.slowResources.slice(0, 12).map(resource => [shortPath(resource.name), formatMs(resource.duration), formatBytes(resource.transferSize || resource.decodedBodySize)])))}
      ${section(context.localize("SectionModules"), table(["Module", "Time", "Files"], report.moduleResources.slice(0, 12).map(item => [item.module, formatMs(item.duration), item.count])))}
      ${section(context.localize("SectionScene"), renderScene(report.scene))}
      ${game.user?.isGM ? section(context.localize("SectionPlayers"), table(["Player", "Ready", "Canvas", "Slow"], report.playerReports.map(item => [item.user, formatMs(item.readyMs), formatMs(item.canvasReadyMs), item.slowResources]))) : ""}
    </div>
  `;
}

function renderScene(scene) {
  if (!scene) return `<p class="notes">${context.localize("NoData")}</p>`;
  const counts = scene.counts ?? {};
  return `
    <dl class="vorfale-load-summary">
      ${row("Name", escapeHTML(scene.name))}
      ${row("Background", escapeHTML(shortPath(scene.background || "-")))}
      ${row("Tokens", counts.tokens ?? 0)}
      ${row("Tiles", counts.tiles ?? 0)}
      ${row("Walls", counts.walls ?? 0)}
      ${row("Lights", counts.lights ?? 0)}
      ${row("Sounds", counts.sounds ?? 0)}
      ${row("Regions", counts.regions ?? 0)}
    </dl>
  `;
}

function section(title, content) {
  return `<section><h3>${escapeHTML(title)}</h3>${content}</section>`;
}

function row(label, value) {
  return `<dt>${escapeHTML(label)}</dt><dd>${value ?? "-"}</dd>`;
}

function orderedList(items) {
  return `<ol>${items.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ol>`;
}

function table(headers, rows) {
  if (!rows.length) return `<p class="notes">${context.localize("NoData")}</p>`;
  return `
    <table>
      <thead><tr>${headers.map(header => `<th>${escapeHTML(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell ?? "-"}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `vorfale-load-diagnostics-${safeFileName(game.user?.name ?? "user")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copySummary(report) {
  const lines = [
    `Vorfale Load Diagnostics: ${report.summary.user}`,
    `Ready: ${formatMs(report.summary.readyMs)}`,
    `Canvas ready: ${formatMs(report.summary.canvasReadyMs)}`,
    `Resources: ${report.summary.resources}`,
    `Slow resources: ${report.summary.slowResources}`,
    `Errors: ${report.summary.errors}`,
    `Scene: ${report.summary.scene || "-"}`
  ];
  await navigator.clipboard?.writeText?.(lines.join("\n"));
  ui.notifications.info(context.localize("Copied"));
}

function collectBufferedResources() {
  for (const entry of performance.getEntriesByType?.("resource") ?? []) recordResource(entry);
}

function summarizeModuleResources(resources) {
  const byModule = new Map();
  for (const resource of resources) {
    if (!resource.module) continue;
    const item = byModule.get(resource.module) ?? {
      module: resource.module,
      count: 0,
      duration: 0,
      transferSize: 0,
      slowest: ""
    };
    item.count += 1;
    item.duration += resource.duration;
    item.transferSize += resource.transferSize || resource.decodedBodySize || 0;
    if (!item.slowest || resource.duration > item.slowestDuration) {
      item.slowest = resource.name;
      item.slowestDuration = resource.duration;
    }
    byModule.set(resource.module, item);
  }
  return Array.from(byModule.values()).sort((a, b) => b.duration - a.duration);
}

function summarizeRemoteReport(report) {
  return {
    user: report.user?.name ?? report.user?.id ?? "Unknown",
    readyMs: report.summary?.readyMs ?? findMark(report, "foundry:ready")?.at ?? null,
    canvasReadyMs: report.summary?.canvasReadyMs ?? findMark(report, "canvas:ready")?.at ?? null,
    slowResources: report.slowResources?.length ?? 0,
    errors: report.errors?.length ?? 0,
    scene: report.scene?.name ?? ""
  };
}

function persistNow() {
  try {
    const report = buildReport();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(report));

    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    history.unshift({
      runId: report.runId,
      user: report.user,
      startedAt: report.startedAtIso,
      summary: report.summary
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch (error) {
    console.warn("vorfale-tweaks/load-diagnostics | Could not persist diagnostics.", error);
  }
}

function schedulePersist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    if (context?.isEnabled?.()) persistNow();
  }, 1000);
}

function createRun() {
  const user = game.user;
  return {
    runId: foundry.utils.randomID(),
    startedAt: performance.now(),
    startedAtIso: new Date().toISOString(),
    user: {
      id: user?.id ?? "",
      name: user?.name ?? "",
      role: user?.role ?? null,
      isGM: user?.isGM ?? false
    },
    marks: [],
    resources: [],
    errors: [],
    environment: {},
    packages: { activeModules: [], inactiveModuleCount: 0 },
    scene: null
  };
}

function findMark(report, id) {
  return report.marks?.find(mark => mark.id === id) ?? null;
}

function getWebGLInfo() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { available: false };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      available: true,
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

function moduleFromUrl(value) {
  const path = stripOrigin(value).replaceAll("\\", "/");
  const match = path.match(/(?:^|\/)modules\/([^/]+)/i);
  return match?.[1] ?? "";
}

function getExtension(value) {
  const path = safeUrl(value)?.pathname ?? value;
  const match = String(path).match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function classifyResource(value) {
  const ext = getExtension(value);
  if (["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"].includes(ext)) return "image";
  if (["mp3", "ogg", "wav", "flac", "m4a"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["js", "mjs"].includes(ext)) return "script";
  if (["css"].includes(ext)) return "style";
  if (["json"].includes(ext)) return "json";
  return "other";
}

function stripOrigin(value) {
  const url = safeUrl(value);
  if (!url) return String(value ?? "");
  return `${url.pathname}${url.search}`.replace(/^\//, "");
}

function safeUrl(value) {
  try {
    return new URL(value, window.location.href);
  } catch (_error) {
    return null;
  }
}

function shortPath(value, max = 88) {
  const text = String(value ?? "");
  if (text.length <= max) return escapeHTML(text);
  return `${escapeHTML(text.slice(0, 30))}...${escapeHTML(text.slice(-max + 33))}`;
}

function formatMs(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Math.round(Number(value))} ms`;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function safeFileName(value) {
  return String(value ?? "user").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "user";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
