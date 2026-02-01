import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Recording control
  onStartRecording: (callback: () => void) => {
    ipcRenderer.on('start-recording', callback);
  },
  onStopRecording: (callback: () => void) => {
    ipcRenderer.on('stop-recording', callback);
  },
  onResetRecordingState: (callback: () => void) => {
    ipcRenderer.on('reset-recording-state', callback);
  },
  
  // Send transcription result to main process
  sendTranscriptionComplete: (text: string) => {
    ipcRenderer.send('transcription-complete', text);
  },
  sendTranscriptionError: (error: string) => {
    ipcRenderer.send('transcription-error', error);
  },
  
  // Hotkey release (for push-to-talk mode)
  sendHotkeyRelease: () => {
    ipcRenderer.send('hotkey-release');
  },
  
  // Get recording state
  getRecordingState: () => {
    return ipcRenderer.invoke('get-recording-state');
  },
  
  // Hotkey configuration
  getHotkey: () => {
    return ipcRenderer.invoke('get-hotkey');
  },
  updateHotkey: (accelerator: string) => {
    return ipcRenderer.invoke('update-hotkey', accelerator);
  },

  // Open URL in default browser
  openExternal: (url: string) => {
    return ipcRenderer.invoke('open-external', url);
  },

  // Settings and jobs
  getSettings: () => {
    return ipcRenderer.invoke('get-settings');
  },
  setSettings: (settings: Record<string, unknown>) => {
    return ipcRenderer.invoke('set-settings', settings);
  },
  listTranscriptionJobs: () => {
    return ipcRenderer.invoke('transcription-job-list');
  },
  getTranscriptionJob: (jobId: string) => {
    return ipcRenderer.invoke('transcription-job-get', jobId);
  },
  getJobAudio: (jobId: string) => {
    return ipcRenderer.invoke('transcription-job-audio', jobId);
  },
  enqueueTranscriptionJob: (payload: { path?: string; name?: string; bytes?: ArrayBuffer }) => {
    return ipcRenderer.invoke('transcription-job-enqueue', payload);
  },
  saveLiveTranscription: (payload: { text: string; title?: string; summary?: string; provider?: string; audioBytes?: ArrayBuffer; duration?: string }) => {
    return ipcRenderer.invoke('transcription-job-save', payload);
  },
  polishTranscriptionJob: (payload: { jobId: string; style?: string; customPrompt?: string }) => {
    return ipcRenderer.invoke('transcription-job-polish', payload);
  },
  deleteTranscriptionJob: (jobId: string) => {
    return ipcRenderer.invoke('transcription-job-delete', jobId);
  },
  exportTranscriptionJob: (jobId: string) => {
    return ipcRenderer.invoke('transcription-job-export', jobId);
  },

  // OpenAI realtime
  openAIRealtimeStart: () => {
    return ipcRenderer.invoke('openai-realtime-start');
  },
  openAIRealtimeStop: () => {
    return ipcRenderer.invoke('openai-realtime-stop');
  },
  openAIRealtimeDisconnect: () => {
    return ipcRenderer.invoke('openai-realtime-disconnect');
  },
  openAIRealtimeSendAudio: (audio: ArrayBuffer) => {
    ipcRenderer.send('openai-realtime-audio', audio);
  },
  onOpenAIRealtimeEvent: (callback: (payload: any) => void) => {
    ipcRenderer.on('openai-realtime-event', (_event, payload) => callback(payload));
  },
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI?: {
      onStartRecording: (callback: () => void) => void;
      onStopRecording: (callback: () => void) => void;
      onResetRecordingState: (callback: () => void) => void;
      sendTranscriptionComplete: (text: string) => void;
      sendTranscriptionError: (error: string) => void;
      sendHotkeyRelease: () => void;
      getRecordingState: () => Promise<{ state: string; isRecording: boolean; duration: number }>;
      getHotkey: () => Promise<{ accelerator: string; enabled: boolean }>;
      updateHotkey: (accelerator: string) => Promise<boolean>;
      openExternal: (url: string) => Promise<boolean>;
      getSettings: () => Promise<Record<string, unknown>>;
      setSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
      listTranscriptionJobs: () => Promise<any[]>;
      getTranscriptionJob: (jobId: string) => Promise<any>;
      getJobAudio: (jobId: string) => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
      enqueueTranscriptionJob: (payload: { path?: string; name?: string; bytes?: ArrayBuffer }) => Promise<any>;
      saveLiveTranscription: (payload: { text: string; title?: string; summary?: string; provider?: string; audioBytes?: ArrayBuffer; duration?: string }) => Promise<any>;
      polishTranscriptionJob: (payload: { jobId: string; style?: string; customPrompt?: string }) => Promise<any>;
      deleteTranscriptionJob: (jobId: string) => Promise<{ deleted: boolean }>;
      exportTranscriptionJob: (jobId: string) => Promise<{ title: string; markdown: string; filename: string }>;
      openAIRealtimeStart: () => Promise<boolean>;
      openAIRealtimeStop: () => Promise<boolean>;
      openAIRealtimeDisconnect: () => Promise<boolean>;
      openAIRealtimeSendAudio: (audio: ArrayBuffer) => void;
      onOpenAIRealtimeEvent: (callback: (payload: any) => void) => void;
    };
  }
}
