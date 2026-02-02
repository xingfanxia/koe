import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, shell, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getOrchestrator } from './orchestrator';
import { initRecordingWidget } from './recording-widget';
import { ConfigManager, AppSettings } from './backend/config-manager';
import { GeminiTranscriber } from './backend/gemini-transcriber';
import { TranscriptionJobQueue } from './backend/job-queue';
import { OpenAIRealtimeClient, RealtimeTextEvent, RealtimeStructuredEvent } from './backend/openai-realtime';
import { MemoryManager } from './backend/memory-manager';
import { OpenAITranscriber } from './backend/openai-transcriber';
import { SynthesisProcessor } from './backend/synthesis-processor';
import { ConsensusTranscriber } from './backend/consensus-transcriber';

// Handle EPIPE errors on stdout/stderr to prevent crashes when terminal is closed
process.stdout?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
    return;
  }
  console.error('stdout error:', err);
});

process.stderr?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
    return;
  }
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isAppQuitting = false;

let configManager: ConfigManager | null = null;
let geminiTranscriber: GeminiTranscriber | null = null;
let jobQueue: TranscriptionJobQueue | null = null;
let openAIClient: OpenAIRealtimeClient | null = null;

function getRendererPath(): string {
  return path.join(__dirname, '..', 'assets', 'realtime.html');
}

function getAudioMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.webm':
      return 'audio/webm';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
    case '.mpeg':
      return 'audio/mpeg';
    case '.m4a':
    case '.mp4':
      return 'audio/mp4';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.flac':
      return 'audio/flac';
    case '.aac':
      return 'audio/aac';
    default:
      return 'application/octet-stream';
  }
}

function sendRealtimeEvent(payload: Record<string, unknown>): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('openai-realtime-event', payload);
}

function registerBackendIpcHandlers(): void {
  if (!configManager || !jobQueue || !geminiTranscriber) {
    return;
  }

  ipcMain.handle('get-settings', () => {
    const settings = configManager!.getSettings();
    const modeMap: Record<string, string> = { live: 'openai', accuracy: 'gemini' };
    const normalized = modeMap[settings.defaultMode] || settings.defaultMode || settings.defaultProvider;
    return {
      ...settings,
      defaultMode: normalized,
      defaultProvider: normalized,
    };
  });

  ipcMain.handle('set-settings', (_event, updates: Partial<AppSettings>) => {
    const modeMap: Record<string, string> = { live: 'openai', accuracy: 'gemini' };
    const next: Partial<AppSettings> = { ...updates };
    const rawMode = updates.defaultMode || updates.defaultProvider;
    if (rawMode) {
      const normalized = modeMap[rawMode] || rawMode;
      next.defaultMode = normalized;
      next.defaultProvider = normalized;
    }
    return configManager!.updateSettings(next);
  });

  ipcMain.handle('transcription-job-enqueue', async (_event, payload: { path?: string; name?: string; bytes?: ArrayBuffer }) => {
    if (payload?.path) {
      return jobQueue!.enqueueFromPath(payload.path, payload.name);
    }
    if (payload?.bytes) {
      const bytes = Buffer.from(new Uint8Array(payload.bytes));
      return jobQueue!.enqueueFromBytes(bytes, payload.name || 'recording.webm');
    }
    throw new Error('Missing audio payload');
  });

  ipcMain.handle(
    'transcription-job-save',
    (_event, payload: { text?: string; title?: string; summary?: string; provider?: string; audioBytes?: ArrayBuffer; duration?: string }) => {
      const text = String(payload?.text || '').trim();
      if (!text) {
        throw new Error('Missing transcription text');
      }
      const provider = payload?.provider || 'openai';
      const audioBuffer = payload?.audioBytes ? Buffer.from(new Uint8Array(payload.audioBytes)) : undefined;
      return jobQueue!.createTextJob(text, provider, payload?.title, payload?.summary, audioBuffer, payload?.duration);
    },
  );

  ipcMain.handle('transcription-job-list', () => {
    return jobQueue!.listJobs();
  });

  ipcMain.handle('transcription-job-get', (_event, jobId: string) => {
    const record = jobQueue!.getJob(jobId);
    if (!record) {
      throw new Error('Job not found');
    }
    const result = jobQueue!.readJobResult(jobId);
    return result ? { ...record, result } : record;
  });

  ipcMain.handle('transcription-job-audio', (_event, jobId: string) => {
    try {
      if (!jobId || !/^[\w-]+$/.test(jobId) || jobId.includes('..')) {
        return null;
      }
      const record = jobQueue!.getJob(jobId);
      if (!record?.audio_path) {
        return null;
      }
      const recordingsDir = configManager!.getRecordingsDir();
      const resolvedAudio = path.resolve(recordingsDir, record.audio_path);
      const recordingsResolved = path.resolve(recordingsDir);
      if (!resolvedAudio.startsWith(recordingsResolved + path.sep)) {
        return null;
      }
      if (!fs.existsSync(resolvedAudio)) {
        return null;
      }
      const stat = fs.statSync(resolvedAudio);
      if (!stat.isFile()) {
        return null;
      }
      const data = fs.readFileSync(resolvedAudio);
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return { data: arrayBuffer, mimeType: getAudioMimeType(resolvedAudio) };
    } catch (err) {
      console.warn('Failed to read job audio:', err);
      return null;
    }
  });

  ipcMain.handle('transcription-job-polish', async (_event, payload: { jobId: string; style?: string; customPrompt?: string }) => {
    const jobId = payload?.jobId;
    if (!jobId) {
      throw new Error('Job ID is required');
    }

    // Pre-flight check: Gemini API key is required for polish
    const geminiApiKey = configManager!.getApiKey('gemini');
    if (!geminiApiKey) {
      throw new Error('Google API key required. Go to Settings to add your key.');
    }

    const record = jobQueue!.getJob(jobId);
    if (!record) {
      throw new Error('Job not found');
    }
    const result = jobQueue!.readJobResult(jobId);
    if (!result || !result.speech_segments) {
      throw new Error('Transcription result not found');
    }
    const rawText = result.speech_segments.map((seg) => seg.content).join('\n').trim();
    if (!rawText) {
      throw new Error('No transcript segments found');
    }
    const settings = configManager!.getSettings();
    const style = payload.style || settings.polishStyle;
    const customPrompt = payload.customPrompt || settings.customPolishPrompt;

    try {
      const polished = await geminiTranscriber!.polishText(rawText, style, customPrompt);
      const readability = jobQueue!.updateReadability(jobId, polished);
      return { status: 'ok', readability, style };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Polish failed';
      // Surface common API errors with user-friendly messages
      if (message.includes('API key not valid') || message.includes('INVALID_ARGUMENT')) {
        throw new Error('Invalid Google API key. Check your key in Settings.');
      }
      if (message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
        throw new Error('API quota exceeded. Try again later or check your billing.');
      }
      if (message.includes('model') || message.includes('not found') || message.includes('404')) {
        throw new Error(`Model not available. Check geminiModel setting or try a different model.`);
      }
      throw new Error(message);
    }
  });

  ipcMain.handle('transcription-job-delete', (_event, jobId: string) => {
    if (!jobId) {
      throw new Error('Job ID is required');
    }
    const deleted = jobQueue!.deleteJob(jobId);
    return { deleted };
  });

  ipcMain.handle('transcription-job-export', (_event, jobId: string) => {
    if (!jobId) {
      throw new Error('Job ID is required');
    }
    const exportData = jobQueue!.getJobExportData(jobId);
    if (!exportData) {
      throw new Error('Job not found');
    }
    return exportData;
  });

  ipcMain.handle('openai-realtime-start', async () => {
    const apiKey = configManager!.getApiKey('openai');
    if (!apiKey) {
      throw new Error('OpenAI API key is not set');
    }
    if (openAIClient) {
      await openAIClient.disconnect();
      openAIClient = null;
    }
    openAIClient = new OpenAIRealtimeClient(apiKey);
    openAIClient.on('status', (status: string) => {
      sendRealtimeEvent({ type: 'status', status });
    });
    openAIClient.on('text', (event: RealtimeTextEvent) => {
      sendRealtimeEvent({ type: 'text', content: event.content, isNewResponse: event.isNewResponse });
    });
    openAIClient.on('structured_result', (event: RealtimeStructuredEvent) => {
      sendRealtimeEvent({ type: 'structured_result', result: event.result });
    });
    openAIClient.on('error', (message: string) => {
      sendRealtimeEvent({ type: 'error', content: message });
    });
    await openAIClient.connect();
    return true;
  });

  ipcMain.on('openai-realtime-audio', (_event, audio: ArrayBuffer) => {
    if (!openAIClient) {
      return;
    }
    void openAIClient.sendAudio(audio);
  });

  ipcMain.handle('openai-realtime-stop', async () => {
    if (openAIClient) {
      await openAIClient.commitAudio();
    }
    return true;
  });

  ipcMain.handle('openai-realtime-disconnect', async () => {
    if (openAIClient) {
      await openAIClient.disconnect();
      openAIClient = null;
    }
    return true;
  });

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        await shell.openExternal(url);
        return true;
      }
    } catch {
      console.warn('Invalid URL for openExternal:', url);
    }
    return false;
  });
}

// Create the main window (hidden by default for menu bar app)
function createWindow(): void {
  const rendererPath = getRendererPath();
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    titleBarStyle: 'hiddenInset',
    show: true,
    skipTaskbar: false,
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'audioCapture', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'];
    if (allowedPermissions.includes(permission)) {
      console.log(`Permission granted: ${permission}`);
      callback(true);
    } else {
      console.log(`Permission denied: ${permission}`);
      callback(false);
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'audioCapture', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'];
    return allowedPermissions.includes(permission);
  });

  console.log('Preload script path:', path.join(__dirname, 'preload.js'));

  mainWindow.webContents.session.clearCache().then(() => {
    console.log('Cache cleared');
    mainWindow!.loadFile(rendererPath);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Main window finished loading');
  });

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    console.log(`Renderer [${level}]: ${message}`);
  });

  mainWindow.on('close', (event) => {
    if (!isAppQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      // Keep dock icon visible when window is hidden
      app.dock?.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create the menu bar tray icon
function createTray(): void {
  const iconPath = path.join(__dirname, '..', 'assets', 'trayIcon.png');
  let icon: Electron.NativeImage;

  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = createDefaultTrayIcon();
    }
  } catch {
    icon = createDefaultTrayIcon();
  }

  icon = icon.resize({ width: 22, height: 22 });
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Koe - Fn to record');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Start Recording (Fn)',
      click: () => {
        mainWindow?.webContents.send('start-recording');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isAppQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
      app.dock?.show();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

function createDefaultTrayIcon(): Electron.NativeImage {
  return nativeImage.createEmpty();
}

app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('enable-speech-dispatcher');

app.whenReady().then(async () => {
  configManager = new ConfigManager();
  geminiTranscriber = new GeminiTranscriber(configManager);

  // Initialize consensus transcription services
  const memoryManager = new MemoryManager(configManager);
  const openAITranscriber = new OpenAITranscriber(configManager);
  const synthesisProcessor = new SynthesisProcessor(configManager);
  const consensusTranscriber = new ConsensusTranscriber(configManager, openAITranscriber, synthesisProcessor, memoryManager);

  jobQueue = new TranscriptionJobQueue(configManager, geminiTranscriber, consensusTranscriber);
  jobQueue.start();

  // Set dock icon for dev mode (packaged builds use icon.icns from build config)
  try {
    const dockIconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    app.dock?.setIcon(dockIconPath);
  } catch (e) {
    console.error('Failed to set dock icon:', e);
  }

  createWindow();
  createTray();
  registerBackendIpcHandlers();

  // macOS dock menu with Quit option
  if (app.dock) {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isAppQuitting = true;
          app.quit();
        },
      },
    ]);
    app.dock.setMenu(dockMenu);
  }

  initRecordingWidget();

  const orchestrator = getOrchestrator();
  if (mainWindow) {
    orchestrator.initialize(mainWindow, getRendererPath());
    await orchestrator.start();
  }

  mainWindow?.show();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
    mainWindow?.show();
    mainWindow?.focus();
  });
});

app.on('window-all-closed', () => {
  // Menu bar app stays alive until explicit quit.
});

app.on('before-quit', () => {
  isAppQuitting = true;
});

app.on('will-quit', (event) => {
  const orchestrator = getOrchestrator();
  orchestrator.stop();

  globalShortcut.unregisterAll();

  if (tray) {
    tray.destroy();
    tray = null;
  }

  if (jobQueue) {
    jobQueue.stop();
  }

  if (openAIClient) {
    void openAIClient.disconnect();
    openAIClient = null;
  }

  // Force exit after cleanup — keyspy child process can keep the app alive
  // if SIGTERM doesn't kill the native binary fast enough.
  event.preventDefault();
  setTimeout(() => process.exit(0), 200);
});
