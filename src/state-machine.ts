import { EventEmitter } from 'events';

export type RecordingState = 'idle' | 'recording' | 'processing' | 'inserting' | 'error';

export type StateTrigger = 
  | 'hotkey_press' 
  | 'hotkey_release' 
  | 'transcription_complete' 
  | 'insertion_complete' 
  | 'error'
  | 'reset';

export interface StateTransition {
  from: RecordingState;
  to: RecordingState;
  trigger: StateTrigger;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<RecordingState, Partial<Record<StateTrigger, RecordingState>>> = {
  idle: {
    hotkey_press: 'recording',
  },
  recording: {
    hotkey_release: 'processing',
    error: 'idle',
  },
  processing: {
    transcription_complete: 'inserting',
    error: 'idle',
  },
  inserting: {
    insertion_complete: 'idle',
    error: 'idle',
  },
  error: {
    reset: 'idle',
  },
};

export interface RecordingStateMachineEvents {
  stateChange: (state: RecordingState, previousState: RecordingState) => void;
  error: (error: Error) => void;
}

export class RecordingStateMachine extends EventEmitter {
  private _currentState: RecordingState = 'idle';
  private _recordingStartTime: number | null = null;
  private _minRecordingDuration: number;

  constructor(minRecordingDuration: number = 200) {
    super();
    this._minRecordingDuration = minRecordingDuration;
  }

  get currentState(): RecordingState {
    return this._currentState;
  }

  get recordingStartTime(): number | null {
    return this._recordingStartTime;
  }

  getRecordingDuration(): number {
    if (!this._recordingStartTime) return 0;
    return Date.now() - this._recordingStartTime;
  }

  /**
   * Attempt to transition to a new state based on a trigger.
   * Returns true if transition was successful, false otherwise.
   */
  transition(trigger: StateTrigger): boolean {
    const validTransitions = VALID_TRANSITIONS[this._currentState];
    const nextState = validTransitions?.[trigger];

    if (!nextState) {
      console.warn(`Invalid transition: ${this._currentState} + ${trigger}`);
      return false;
    }

    // Special handling for hotkey_press -> recording
    if (trigger === 'hotkey_press' && nextState === 'recording') {
      this._recordingStartTime = Date.now();
    }

    // Special handling for hotkey_release -> processing
    // Check minimum duration requirement
    if (trigger === 'hotkey_release' && this._currentState === 'recording') {
      const duration = this.getRecordingDuration();
      if (duration < this._minRecordingDuration) {
        console.log(`Recording too short (${duration}ms < ${this._minRecordingDuration}ms), ignoring`);
        // Reset to idle without processing
        const previousState = this._currentState;
        this._currentState = 'idle';
        this._recordingStartTime = null;
        this.emit('stateChange', 'idle', previousState);
        return false;
      }
    }

    const previousState = this._currentState;
    this._currentState = nextState;

    // Clear recording start time when leaving recording state
    if (previousState === 'recording' && nextState !== 'recording') {
      // Keep the start time for duration calculation until we're done
    }

    // Clear recording start time when returning to idle
    if (nextState === 'idle') {
      this._recordingStartTime = null;
    }

    console.log(`State transition: ${previousState} -> ${nextState} (trigger: ${trigger})`);
    this.emit('stateChange', nextState, previousState);

    return true;
  }

  /**
   * Force reset to idle state
   */
  reset(): void {
    const previousState = this._currentState;
    this._currentState = 'idle';
    this._recordingStartTime = null;
    if (previousState !== 'idle') {
      this.emit('stateChange', 'idle', previousState);
    }
  }

  /**
   * Check if a transition is valid without performing it
   */
  canTransition(trigger: StateTrigger): boolean {
    const validTransitions = VALID_TRANSITIONS[this._currentState];
    return !!validTransitions?.[trigger];
  }
}

// Singleton instance
let stateMachineInstance: RecordingStateMachine | null = null;

export function getStateMachine(minRecordingDuration?: number): RecordingStateMachine {
  if (!stateMachineInstance) {
    stateMachineInstance = new RecordingStateMachine(minRecordingDuration);
  }
  return stateMachineInstance;
}
