import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

export type WidgetState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

export class RecordingWidget {
  private widgets: Map<number, BrowserWindow> = new Map();
  private currentState: WidgetState = 'idle';
  private onDisplayAdded: ((_event: Electron.Event, display: Electron.Display) => void) | null = null;
  private onDisplayRemoved: ((_event: Electron.Event, display: Electron.Display) => void) | null = null;
  private onDisplayMetricsChanged: ((_event: Electron.Event, display: Electron.Display) => void) | null = null;

  /**
   * Create one widget per connected display
   */
  init(): void {
    const displays = screen.getAllDisplays();
    for (const display of displays) {
      this.createWidgetForDisplay(display);
    }

    this.onDisplayAdded = (_event, display) => {
      this.createWidgetForDisplay(display);
    };
    screen.on('display-added', this.onDisplayAdded);

    this.onDisplayRemoved = (_event, display) => {
      this.destroyWidgetForDisplay(display.id);
    };
    screen.on('display-removed', this.onDisplayRemoved);

    this.onDisplayMetricsChanged = (_event, display) => {
      const win = this.widgets.get(display.id);
      if (win && !win.isDestroyed()) {
        const { x, y } = this.getBottomRightPosition(display);
        win.setPosition(x, y, false);
      }
    };
    screen.on('display-metrics-changed', this.onDisplayMetricsChanged);

    for (const display of displays) {
      const { x, y, width, height } = display.bounds;
      console.log(`RecordingWidget: display ${display.id} bounds=(${x},${y},${width}x${height}) internal=${display.internal}`);
    }
    console.log(`RecordingWidget: created ${this.widgets.size} widget(s) across ${displays.length} display(s)`);
  }

  /**
   * Create a 60x60 frameless widget at bottom-right of a display
   */
  private createWidgetForDisplay(display: Electron.Display): void {
    if (this.widgets.has(display.id)) return;

    const { x, y } = this.getBottomRightPosition(display);

    const win = new BrowserWindow({
      width: 60,
      height: 60,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'widget-preload.js'),
      },
    });

    // macOS: highest z-level + visible on fullscreen spaces
    if (process.platform === 'darwin') {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    win.loadURL(`data:text/html,${encodeURIComponent(this.getInlineHTML())}`);
    win.showInactive();

    // Push current state so late-added displays reflect the active state
    if (this.currentState !== 'idle') {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) {
          win.webContents.send('widget-state-update', { status: this.currentState });
        }
      });
    }

    this.widgets.set(display.id, win);
  }

  /**
   * Destroy widget for a disconnected display
   */
  private destroyWidgetForDisplay(displayId: number): void {
    const win = this.widgets.get(displayId);
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    this.widgets.delete(displayId);
  }

  /**
   * Bottom-right position within the display's work area
   */
  private getBottomRightPosition(display: Electron.Display): { x: number; y: number } {
    const size = 60;
    const margin = 20;
    const { x: aX, y: aY, width: aW, height: aH } = display.workArea;
    return {
      x: aX + aW - size - margin,
      y: aY + aH - size - margin,
    };
  }

  /**
   * Push state to all widget windows
   */
  updateAllWidgets(state: WidgetState): void {
    this.currentState = state;
    for (const [id, win] of this.widgets) {
      if (win.isDestroyed()) {
        this.widgets.delete(id);
        continue;
      }
      win.webContents.send('widget-state-update', { status: state });
    }
  }

  /**
   * Destroy all widgets and remove listeners
   */
  destroy(): void {
    for (const [id, win] of this.widgets) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
      this.widgets.delete(id);
    }
    if (this.onDisplayAdded) {
      screen.removeListener('display-added', this.onDisplayAdded);
      this.onDisplayAdded = null;
    }
    if (this.onDisplayRemoved) {
      screen.removeListener('display-removed', this.onDisplayRemoved);
      this.onDisplayRemoved = null;
    }
    if (this.onDisplayMetricsChanged) {
      screen.removeListener('display-metrics-changed', this.onDisplayMetricsChanged);
      this.onDisplayMetricsChanged = null;
    }
  }

  /**
   * Inline HTML for the circular mic button widget
   */
  private getInlineHTML(): string {
    const csp = [
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');

    return `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    :root {
      --sumi-black: #1C1C1C;
      --washi-white: #FAF8F5;
      --vermillion: #C23B22;
      --moss-stone: #6B7B5E;
      --diluted-ink: #8B8B8B;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: transparent;
      user-select: none;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }

    .widget-btn {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      margin: 2px;
      transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1),
                  background 0.3s ease;
      background: var(--washi-white);
      box-shadow: 0 4px 16px rgba(28, 28, 28, 0.15), 0 2px 4px rgba(28, 28, 28, 0.08);
    }

    .widget-btn:hover {
      transform: scale(1.08);
    }

    .widget-btn:active {
      transform: scale(0.95);
    }

    .widget-btn svg {
      width: 24px;
      height: 24px;
      stroke: var(--sumi-black);
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: stroke 0.3s ease;
    }

    /* States */
    .widget-btn.recording {
      background: var(--vermillion);
    }
    .widget-btn.recording svg {
      stroke: var(--washi-white);
    }

    .widget-btn.processing {
      background: var(--sumi-black);
    }
    .widget-btn.processing svg {
      stroke: var(--washi-white);
    }

    .widget-btn.success {
      background: var(--moss-stone);
    }
    .widget-btn.success svg {
      stroke: var(--washi-white);
    }

    .widget-btn.error {
      background: var(--vermillion);
    }
    .widget-btn.error svg {
      stroke: var(--washi-white);
    }

    /* Pulse ring for recording */
    .pulse-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid var(--vermillion);
      opacity: 0;
      pointer-events: none;
    }

    .recording .pulse-ring {
      animation: pulse 2s ease-out infinite;
    }

    .recording .pulse-ring.delay {
      animation-delay: 0.6s;
    }

    /* Spinner for processing */
    .widget-btn.processing svg.icon-processing {
      animation: spin 1.2s linear infinite;
    }

    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <button class="widget-btn" id="btn" onclick="window.widgetAPI && window.widgetAPI.toggleRecording()">
    <div class="pulse-ring"></div>
    <div class="pulse-ring delay"></div>
    <svg id="icon" viewBox="0 0 24 24">
      <!-- Mic icon (idle) -->
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="none"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>
  </button>
  <script>
    var icons = {
      idle: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="none"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>',
      recording: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"></circle>',
      processing: '<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>',
      success: '<polyline points="20 6 9 17 4 12"></polyline>',
      error: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    };

    function updateWidget(state) {
      var btn = document.getElementById('btn');
      var icon = document.getElementById('icon');
      btn.className = 'widget-btn ' + state.status;
      icon.innerHTML = icons[state.status] || icons.idle;
      if (state.status === 'processing') {
        icon.classList.add('icon-processing');
      } else {
        icon.classList.remove('icon-processing');
      }
    }

    if (window.widgetAPI) {
      window.widgetAPI.onStateUpdate(updateWidget);
    }
  </script>
</body>
</html>`;
  }
}

// Singleton
let recordingWidgetInstance: RecordingWidget | null = null;

export function getRecordingWidget(): RecordingWidget {
  if (!recordingWidgetInstance) {
    recordingWidgetInstance = new RecordingWidget();
  }
  return recordingWidgetInstance;
}

export function initRecordingWidget(): void {
  const widget = getRecordingWidget();
  widget.init();
}
