import { systemPreferences, shell, dialog, Notification } from 'electron';

export type PermissionState = 'granted' | 'denied' | 'not_determined' | 'restricted' | 'unknown';

export interface PermissionStatus {
  microphone: PermissionState;
  accessibility: PermissionState;
}

export class PermissionService {
  /**
   * Check all required permissions
   */
  async checkAll(): Promise<PermissionStatus> {
    return {
      microphone: await this.checkMicrophone(),
      accessibility: this.checkAccessibility(),
    };
  }

  /**
   * Check microphone permission
   */
  async checkMicrophone(): Promise<PermissionState> {
    if (process.platform !== 'darwin') {
      return 'granted'; // Assume granted on non-macOS
    }

    const status = systemPreferences.getMediaAccessStatus('microphone');
    return this.mapMediaStatus(status);
  }

  /**
   * Request microphone permission
   */
  async requestMicrophone(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return true;
    }

    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return granted;
    } catch (err) {
      console.error('Error requesting microphone permission:', err);
      return false;
    }
  }

  /**
   * Check accessibility permission (needed for keyboard simulation)
   */
  checkAccessibility(): PermissionState {
    if (process.platform !== 'darwin') {
      return 'granted';
    }

    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    return trusted ? 'granted' : 'denied';
  }

  /**
   * Prompt for accessibility permission
   * This will show the system dialog asking to add the app to accessibility
   */
  promptAccessibility(): boolean {
    if (process.platform !== 'darwin') {
      return true;
    }

    // This will prompt the user if not already trusted
    return systemPreferences.isTrustedAccessibilityClient(true);
  }

  /**
   * Open System Preferences to Accessibility settings
   */
  openAccessibilitySettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
  }

  /**
   * Open System Preferences to Microphone settings
   */
  openMicrophoneSettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    }
  }

  /**
   * Show permission setup dialog
   */
  async showPermissionDialog(status: PermissionStatus): Promise<void> {
    const missingPermissions: string[] = [];

    if (status.microphone !== 'granted') {
      missingPermissions.push('Microphone (for voice recording)');
    }
    if (status.accessibility !== 'granted') {
      missingPermissions.push('Accessibility (for text insertion)');
    }

    if (missingPermissions.length === 0) {
      return;
    }

    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Permissions Required',
      message: 'Koe needs additional permissions to work properly.',
      detail: `The following permissions are required:\n\n${missingPermissions.map(p => `• ${p}`).join('\n')}\n\nWould you like to open System Preferences to grant these permissions?`,
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
    });

    if (result.response === 0) {
      // Open the appropriate settings
      if (status.microphone !== 'granted') {
        this.openMicrophoneSettings();
      } else if (status.accessibility !== 'granted') {
        this.openAccessibilitySettings();
      }
    }
  }

  /**
   * Show notification about missing permissions
   */
  showPermissionNotification(permission: 'microphone' | 'accessibility'): void {
    const titles: Record<string, string> = {
      microphone: 'Microphone Access Required',
      accessibility: 'Accessibility Access Required',
    };

    const bodies: Record<string, string> = {
      microphone: 'Please grant microphone access in System Preferences to use voice transcription.',
      accessibility: 'Please grant accessibility access in System Preferences to enable text insertion.',
    };

    const notification = new Notification({
      title: titles[permission],
      body: bodies[permission],
    });

    notification.on('click', () => {
      if (permission === 'microphone') {
        this.openMicrophoneSettings();
      } else {
        this.openAccessibilitySettings();
      }
    });

    notification.show();
  }

  /**
   * Map Electron media status to our PermissionState
   */
  private mapMediaStatus(status: string): PermissionState {
    switch (status) {
      case 'granted':
        return 'granted';
      case 'denied':
        return 'denied';
      case 'not-determined':
        return 'not_determined';
      case 'restricted':
        return 'restricted';
      default:
        return 'unknown';
    }
  }
}

// Singleton instance
let permissionServiceInstance: PermissionService | null = null;

export function getPermissionService(): PermissionService {
  if (!permissionServiceInstance) {
    permissionServiceInstance = new PermissionService();
  }
  return permissionServiceInstance;
}
