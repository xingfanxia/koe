import { EventEmitter } from 'events';
import WebSocket, { RawData } from 'ws';

type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'processing' | 'completed';

export interface RealtimeTextEvent {
  content: string;
  isNewResponse: boolean;
}

export interface RealtimeStructuredEvent {
  result: Record<string, unknown>;
}

export class OpenAIRealtimeClient extends EventEmitter {
  private apiKey: string;
  private model: string;
  private transcriptionModel: string;
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private pendingAudio: Buffer[] = [];
  private sendQueue: Promise<void> = Promise.resolve();
  private currentResponseText = '';
  private readyResolver: (() => void) | null = null;
  private readyRejecter: ((err: Error) => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private disconnectPromise: Promise<void> | null = null;

  constructor(apiKey: string, model: string = 'gpt-realtime-2025-08-28', transcriptionModel: string = 'gpt-4o-transcribe') {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.transcriptionModel = transcriptionModel;
  }

  async connect(): Promise<void> {
    if (this.disconnectPromise) {
      await this.disconnectPromise;
    }

    if (this.ws) {
      return this.readyPromise ?? Promise.resolve();
    }

    if (this.closed) {
      this.closed = false;
    }

    this.emitStatus('connecting');

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });

    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${this.model}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.ws = ws;

    ws.on('message', (data: RawData) => {
      this.handleMessage(data.toString());
    });

    ws.on('close', () => {
      const wasReady = this.ready;
      this.ready = false;
      this.ws = null;
      if (!wasReady && this.readyRejecter) {
        this.readyRejecter(new Error('WebSocket closed before ready'));
      }
      this.readyResolver = null;
      this.readyRejecter = null;
      this.readyPromise = null;
      this.emitStatus('idle');
    });

    ws.on('error', (err: Error) => {
      if (!this.ready && this.readyRejecter) {
        this.readyRejecter(err instanceof Error ? err : new Error(String(err)));
        this.readyResolver = null;
        this.readyRejecter = null;
        this.readyPromise = null;
      }
      this.emitError(err instanceof Error ? err.message : String(err));
    });

    return this.readyPromise;
  }

  async sendAudio(audio: ArrayBuffer | Buffer): Promise<void> {
    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
    if (!this.ready) {
      this.pendingAudio.push(buffer);
      return;
    }
    await this.enqueueSend(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: buffer.toString('base64'),
      }),
    );
  }

  async commitAudio(): Promise<void> {
    if (!this.ready || !this.ws) {
      return;
    }
    await this.sendQueue;
    this.emitStatus('processing');
    await this.enqueueSend(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      return this.disconnectPromise;
    }

    this.closed = true;
    const ws = this.ws;
    if (!ws) {
      this.ready = false;
      this.ws = null;
      return;
    }

    this.disconnectPromise = new Promise<void>((resolve) => {
      const finalize = () => {
        ws.removeListener('close', handleClose);
        ws.removeListener('error', handleError);
        this.ready = false;
        this.ws = null;
        resolve();
      };
      const handleClose = () => finalize();
      const handleError = () => finalize();
      ws.once('close', handleClose);
      ws.once('error', handleError);

      if (ws.readyState === WebSocket.CLOSED) {
        finalize();
        return;
      }
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        } else {
          ws.close();
        }
      } catch {
        finalize();
      }
    });

    try {
      await this.disconnectPromise;
    } finally {
      this.disconnectPromise = null;
    }
  }

  private async enqueueSend(payload: string): Promise<void> {
    if (!this.ws) {
      return;
    }
    this.sendQueue = this.sendQueue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.ws!.send(payload, (err?: Error) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        }),
    );
    return this.sendQueue;
  }

  private async handleSessionCreated(): Promise<void> {
    if (!this.ws) {
      return;
    }
    await this.enqueueSend(
      JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text'],
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: this.transcriptionModel,
          },
          turn_detection: null,
        },
      }),
    );
    this.ready = true;
    if (this.readyResolver) {
      this.readyResolver();
    }
    this.readyResolver = null;
    this.readyRejecter = null;
    this.emitStatus('connected');

    if (this.pendingAudio.length > 0) {
      const chunks = [...this.pendingAudio];
      this.pendingAudio = [];
      for (const chunk of chunks) {
        await this.sendAudio(chunk);
      }
    }
  }

  private handleMessage(message: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(data.type || '');
    if (type === 'session.created' || type === 'transcription_session.created') {
      void this.handleSessionCreated();
      return;
    }

    if (type === 'conversation.item.input_audio_transcription.delta') {
      const delta = String((data as { delta?: string }).delta || '');
      if (delta) {
        this.emit('text', { content: delta, isNewResponse: false } as RealtimeTextEvent);
      }
      return;
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = String((data as { transcript?: string }).transcript || '');
      if (transcript) {
        this.emit('text', { content: transcript, isNewResponse: true } as RealtimeTextEvent);
      }
      this.emitStatus('completed');
      void this.disconnect();
      return;
    }

    if (type === 'response.text.delta' || type === 'response.output_text.delta') {
      const delta = String((data as { delta?: string }).delta || '');
      if (delta) {
        this.currentResponseText += delta;
        this.emit('text', { content: delta, isNewResponse: false } as RealtimeTextEvent);
      }
      return;
    }

    if (type === 'response.done' || type === 'response.text.done' || type === 'response.output_text.done') {
      this.handleResponseDone();
      return;
    }

    if (type === 'error') {
      const messageText = String((data as { error?: { message?: string } }).error?.message || 'OpenAI error');
      this.emitError(messageText);
    }
  }

  private handleResponseDone(): void {
    const raw = (this.currentResponseText || '').trim();
    this.currentResponseText = '';

    const parsed = this.tryParseStructuredResult(raw);
    if (parsed) {
      this.emit('structured_result', { result: parsed } as RealtimeStructuredEvent);
    }

    let finalText = raw;
    if (parsed && Array.isArray((parsed as { speech_segments?: unknown }).speech_segments)) {
      const segments = (parsed as { speech_segments?: Array<{ content?: string }> }).speech_segments || [];
      finalText = segments.map((seg) => seg.content || '').filter(Boolean).join('\n');
    }

    this.emit('text', { content: finalText, isNewResponse: true } as RealtimeTextEvent);
    this.emitStatus('completed');
    void this.disconnect();
  }

  private tryParseStructuredResult(text: string): Record<string, unknown> | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private emitStatus(status: RealtimeStatus): void {
    this.emit('status', status);
  }

  private emitError(message: string): void {
    this.emit('error', message);
  }
}
