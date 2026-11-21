// Type descriptions for the things the page reads from `window` that a browser doesn't have.
// This file is only read by the type checker (jsconfig.json, `npm run typecheck`) and by editors;
// the app never loads it, so nothing here changes how the app runs.
//
// It has no `import`/`export` on purpose: that makes it "global", so the `interface Window`
// below adds to the browser's own description of `window` instead of replacing it.

/** The Android app's bridge: functions written in Kotlin (android/MainActivity.kt, the `Bridge`
 *  class, each marked @JavascriptInterface) that the page can call. Only there on Android.
 *  Ones marked `?` may be missing in an older Android app, so the page checks before calling them. */
interface LeanAndroid {
  /** Whether the app may read and write all files (needed to open notes anywhere on the phone). */
  hasAllFilesAccess(): boolean;
  /** Open Android's settings screen where people allow that. */
  openAllFilesSettings(): void;
  /** Tell the home-screen widget where the notes and journals are. */
  setWidgetConfig?(vault: string, journalsDir: string, fileFormat: string, titleFormat: string): void;
  /** Settings for "share to thinky" / quick capture, as a JSON text. */
  setCaptureConfig?(json: string): void;
  /** Today's to-dos for the widget, as a JSON text. */
  setWidgetTasks?(json: string): void;
  /** Ask the widget to draw itself again. */
  refreshWidget?(): void;
  /** The widget's link and highlight colours (CSS colour texts). */
  setWidgetText?(link: string, mark: string): void;
  /** The widget's background, text, faint text and accent colours (CSS colour texts). */
  setWidgetColors?(bg: string, ink: string, faint: string, accent: string): void;
  /** The phone's status/navigation bar colour; `light` = dark icons on a light bar. */
  setBarColors?(bg: string, light: boolean): void;
  /** Send the app to the background (Back pressed with nothing left to go back to). */
  leave?(): void;
  /** Which home-screen shortcut opened the app ('search', …), once; null if none. */
  takeShortcut?(): string | null;
  /** Bring up the on-screen keyboard. */
  showKeyboard?(): void;
  /** Print the page (Android's print dialog), with this title. */
  print?(title: string): void;
  /** Save an AI service's key; returns why it couldn't, or '' when saved. */
  aiKeySet(service: string, key: string): string;
  /** The same, with the address the key belongs to (newer apps). */
  aiKeySetFor?(service: string, key: string, base: string): string;
  /** Whether a key is saved for that AI service. */
  aiKeyHas(service: string): boolean;
  /** Send an AI request (a JSON text); the answer comes back later as a 'lean-ai' event on `document`. */
  aiSend(id: string, service: string, req: string): void;
  /** Download and check the app update with this release tag (progress comes back as events). */
  update?(tag: string): void;
  /** Open Android's installer for the downloaded update. */
  installUpdate(): void;
  /** Whether this copy came from Google Play (which then does the updating). */
  fromPlay?(): boolean;
}

/** The parts of Tauri's page-side library (window.__TAURI__, given by the desktop and Android app
 *  because tauri.conf.json sets withGlobalTauri) that the page uses. Not there in a plain browser. */
interface TauriGlobal {
  core: {
    /** Run a Rust command; resolves with its answer. Answers differ per command, so `any`. */
    invoke(cmd: string, args?: Record<string, unknown>): Promise<any>;
    /** The address the page can load a file from, through the app's own `protocol` (e.g. 'vault'). */
    convertFileSrc?(path: string, protocol?: string): string;
  };
  event?: {
    /** Listen to an event from the Rust side. `payload` differs per event, so `any`.
     *  Resolves with a function that stops listening. */
    listen?(event: string, fn: (e: { event: string; payload: any }) => void): Promise<() => void>;
  };
  opener?: {
    /** Open a link in the system's browser (or the app that handles it). */
    openUrl?(url: string): Promise<void>;
  };
  window?: {
    /** The app's own window (used to draw our own title bar buttons on Windows). */
    getCurrentWindow?(): TauriWindow;
  };
  app?: {
    /** The app's version, e.g. '0.6.4'. */
    getVersion(): Promise<string>;
    /** Android: be told when Back is pressed (only in newer Tauri versions, so it may be missing). */
    onBackButtonPress?(fn: () => void): Promise<unknown>;
  };
}

/** The few things the page does with the app's window. */
interface TauriWindow {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Be told when the window changes size; resolves with a function that stops listening. */
  onResized(fn: () => void): Promise<() => void>;
}

interface Window {
  /** The Android bridge (see above); undefined everywhere else. */
  LeanAndroid?: LeanAndroid;
  /** Tauri's library (see above); undefined in a plain browser (the dev server). */
  __TAURI__?: TauriGlobal;
  /** The app object (app.js), kept for the tests and for looking around in the browser's console. */
  leanApp?: object;
  /** The browser's "Save as…" dialog for files: only some browsers have it (Chrome, Edge), so the
   *  page checks first (export.js). Not in TypeScript's own list of browser features yet. */
  showSaveFilePicker?(options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle>;
}
