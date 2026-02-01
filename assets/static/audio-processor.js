// Audio Worklet Processor for converting Float32 audio to Int16 PCM
// Used for OpenAI realtime transcription API

class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096; // Buffer size for sending chunks
        this.buffer = new Float32Array(0);
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const samples = input[0]; // Mono channel

            // Accumulate samples in buffer
            const newBuffer = new Float32Array(this.buffer.length + samples.length);
            newBuffer.set(this.buffer);
            newBuffer.set(samples, this.buffer.length);
            this.buffer = newBuffer;

            // When buffer is large enough, send it
            while (this.buffer.length >= this.bufferSize) {
                const chunk = this.buffer.slice(0, this.bufferSize);
                this.buffer = this.buffer.slice(this.bufferSize);

                // Convert Float32 (-1.0 to 1.0) to Int16 PCM (-32768 to 32767)
                const pcm = new Int16Array(chunk.length);
                for (let i = 0; i < chunk.length; i++) {
                    // Clamp and convert
                    const s = Math.max(-1, Math.min(1, chunk[i]));
                    pcm[i] = s < 0 ? s * 32768 : s * 32767;
                }

                // Send PCM data to main thread
                this.port.postMessage(pcm.buffer, [pcm.buffer]);
            }
        }
        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
