//! The Windows functions, messages and structures the native capture box uses, declared by hand
//! (like win.rs and watch.rs: no Windows crate). Handles are plain `isize`s. Functions that older
//! Windows versions lack, or that live in libraries the box only sometimes needs (the file picker,
//! the PNG encoder), are looked up when needed (`proc_addr`), so they never slow the app's start.
#![allow(non_snake_case, clippy::upper_case_acronyms, dead_code)]

use std::ffi::c_void;

pub type WndProc = unsafe extern "system" fn(isize, u32, usize, isize) -> isize;

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct POINT {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct SIZE {
    pub cx: i32,
    pub cy: i32,
}

#[repr(C)]
pub struct MSG {
    pub hwnd: isize,
    pub message: u32,
    pub wparam: usize,
    pub lparam: isize,
    pub time: u32,
    pub pt: POINT,
    pub private: u32,
}

#[repr(C)]
pub struct WNDCLASSEXW {
    pub size: u32,
    pub style: u32,
    pub wndproc: Option<WndProc>,
    pub cls_extra: i32,
    pub wnd_extra: i32,
    pub instance: isize,
    pub icon: isize,
    pub cursor: isize,
    pub background: isize,
    pub menu_name: *const u16,
    pub class_name: *const u16,
    pub icon_sm: isize,
}

#[repr(C)]
pub struct PAINTSTRUCT {
    pub hdc: isize,
    pub erase: i32,
    pub paint: RECT,
    pub restore: i32,
    pub inc_update: i32,
    pub reserved: [u8; 32],
}

#[repr(C)]
#[derive(Default)]
pub struct MONITORINFO {
    pub size: u32,
    pub monitor: RECT,
    pub work: RECT,
    pub flags: u32,
}

#[repr(C)]
pub struct TRACKMOUSEEVENT {
    pub size: u32,
    pub flags: u32,
    pub track: isize,
    pub hover_time: u32,
}

#[repr(C)]
#[derive(Default)]
pub struct TEXTMETRICW {
    pub height: i32,
    pub ascent: i32,
    pub descent: i32,
    pub internal_leading: i32,
    pub external_leading: i32,
    pub ave_char_width: i32,
    pub max_char_width: i32,
    pub weight: i32,
    pub overhang: i32,
    pub digitized_aspect_x: i32,
    pub digitized_aspect_y: i32,
    pub first_char: u16,
    pub last_char: u16,
    pub default_char: u16,
    pub break_char: u16,
    pub italic: u8,
    pub underlined: u8,
    pub struck_out: u8,
    pub pitch_and_family: u8,
    pub char_set: u8,
}

#[repr(C)]
#[derive(Default)]
pub struct BITMAPINFOHEADER {
    pub size: u32,
    pub width: i32,
    pub height: i32,
    pub planes: u16,
    pub bit_count: u16,
    pub compression: u32,
    pub size_image: u32,
    pub x_ppm: i32,
    pub y_ppm: i32,
    pub clr_used: u32,
    pub clr_important: u32,
}

/// BITMAPINFO with room for three colour masks (unused with BI_RGB).
#[repr(C)]
#[derive(Default)]
pub struct BITMAPINFO {
    pub header: BITMAPINFOHEADER,
    pub colors: [u32; 3],
}

impl BITMAPINFO {
    /// 32-bit pixels, rows from the top.
    pub fn top_down(w: i32, h: i32) -> BITMAPINFO {
        BITMAPINFO { header: BITMAPINFOHEADER { size: 40, width: w, height: -h, planes: 1, bit_count: 32, compression: BI_RGB, ..Default::default() }, ..Default::default() }
    }
}

#[repr(C)]
pub struct KEYBDINPUT {
    pub vk: u16,
    pub scan: u16,
    pub flags: u32,
    pub time: u32,
    pub extra: usize,
}

/// INPUT for a key (the union's other members are no bigger than this plus the padding).
#[repr(C)]
pub struct INPUT {
    pub kind: u32,
    pub ki: KEYBDINPUT,
    pub pad: [u8; 8],
}

#[repr(C)]
pub struct NCCALCSIZE_PARAMS {
    pub rgrc: [RECT; 3],
    pub pos: *mut c_void,
}

#[repr(C)]
pub struct OPENFILENAMEW {
    pub size: u32,
    pub owner: isize,
    pub instance: isize,
    pub filter: *const u16,
    pub custom_filter: *mut u16,
    pub max_cust_filter: u32,
    pub filter_index: u32,
    pub file: *mut u16,
    pub max_file: u32,
    pub file_title: *mut u16,
    pub max_file_title: u32,
    pub initial_dir: *const u16,
    pub title: *const u16,
    pub flags: u32,
    pub file_offset: u16,
    pub file_extension: u16,
    pub def_ext: *const u16,
    pub cust_data: isize,
    pub hook: *const c_void,
    pub template_name: *const u16,
    pub reserved_ptr: *mut c_void,
    pub reserved: u32,
    pub flags_ex: u32,
}

#[repr(C)]
pub struct GUID {
    pub d1: u32,
    pub d2: u16,
    pub d3: u16,
    pub d4: [u8; 8],
}

#[repr(C)]
pub struct GdiplusStartupInput {
    pub version: u32,
    pub debug_callback: *const c_void,
    pub suppress_background_thread: i32,
    pub suppress_external_codecs: i32,
}

#[repr(C)]
pub struct DROPFILES {
    pub files_offset: u32,
    pub pt: POINT,
    pub nc: i32,
    pub wide: i32,
}

/// WM_COPYDATA's data: how a second box hands its words to the open one.
#[repr(C)]
pub struct COPYDATASTRUCT {
    pub data: usize,
    pub size: u32,
    pub ptr: *const c_void,
}

#[repr(C)]
pub struct OSVERSIONINFOW {
    pub size: u32,
    pub major: u32,
    pub minor: u32,
    pub build: u32,
    pub platform: u32,
    pub csd: [u16; 128],
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct FILETIME {
    pub low: u32,
    pub high: u32,
}

impl FILETIME {
    pub fn ticks(&self) -> u64 {
        ((self.high as u64) << 32) | self.low as u64
    }
}

// The structures must be exactly Windows' sizes (64-bit), or Windows reads past them.
#[cfg(target_pointer_width = "64")]
const _: () = {
    use std::mem::size_of;
    assert!(size_of::<MSG>() == 48);
    assert!(size_of::<WNDCLASSEXW>() == 80);
    assert!(size_of::<PAINTSTRUCT>() == 72);
    assert!(size_of::<MONITORINFO>() == 40);
    assert!(size_of::<TRACKMOUSEEVENT>() == 24);
    assert!(size_of::<TEXTMETRICW>() == 60);
    assert!(size_of::<BITMAPINFOHEADER>() == 40);
    assert!(size_of::<INPUT>() == 40);
    assert!(size_of::<NCCALCSIZE_PARAMS>() == 56);
    assert!(size_of::<OPENFILENAMEW>() == 152);
    assert!(size_of::<GdiplusStartupInput>() == 24);
    assert!(size_of::<DROPFILES>() == 20);
    assert!(size_of::<OSVERSIONINFOW>() == 276);
    assert!(size_of::<COPYDATASTRUCT>() == 24);
};

// messages
pub const WM_DESTROY: u32 = 0x0002;
pub const WM_SIZE: u32 = 0x0005;
pub const WM_ACTIVATE: u32 = 0x0006;
pub const WM_SETFOCUS: u32 = 0x0007;
pub const WM_SETTEXT: u32 = 0x000C;
pub const WM_PAINT: u32 = 0x000F;
pub const WM_CLOSE: u32 = 0x0010;
pub const WM_ERASEBKGND: u32 = 0x0014;
pub const WM_SETCURSOR: u32 = 0x0020;
pub const WM_SETFONT: u32 = 0x0030;
pub const WM_COPYDATA: u32 = 0x004A;
pub const SMTO_ABORTIFHUNG: u32 = 0x0002;
pub const WM_CONTEXTMENU: u32 = 0x007B;
pub const WM_NCCALCSIZE: u32 = 0x0083;
pub const WM_NCHITTEST: u32 = 0x0084;
pub const WM_NCLBUTTONDBLCLK: u32 = 0x00A3;
pub const WM_NCRBUTTONUP: u32 = 0x00A5;
pub const WM_KEYDOWN: u32 = 0x0100;
pub const WM_CHAR: u32 = 0x0102;
pub const WM_SYSKEYDOWN: u32 = 0x0104;
pub const WM_SYSCHAR: u32 = 0x0106;
pub const WM_COMMAND: u32 = 0x0111;
pub const WM_TIMER: u32 = 0x0113;
pub const WM_CTLCOLOREDIT: u32 = 0x0133;
pub const WM_CTLCOLORSTATIC: u32 = 0x0138;
pub const WM_MOUSEMOVE: u32 = 0x0200;
pub const WM_LBUTTONDOWN: u32 = 0x0201;
pub const WM_LBUTTONUP: u32 = 0x0202;
pub const WM_MOUSEWHEEL: u32 = 0x020A;
pub const WM_CAPTURECHANGED: u32 = 0x0215;
pub const WM_DROPFILES: u32 = 0x0233;
pub const WM_MOUSELEAVE: u32 = 0x02A3;
pub const WM_DPICHANGED: u32 = 0x02E0;
pub const WM_PASTE: u32 = 0x0302;
pub const WM_APP: u32 = 0x8000;

// edit controls
pub const EM_GETSEL: u32 = 0x00B0;
pub const EM_SETSEL: u32 = 0x00B1;
pub const EM_LINESCROLL: u32 = 0x00B6;
pub const EM_SCROLLCARET: u32 = 0x00B7;
pub const EM_GETLINECOUNT: u32 = 0x00BA;
pub const EM_REPLACESEL: u32 = 0x00C2;
pub const EM_SETLIMITTEXT: u32 = 0x00C5;
pub const EM_GETFIRSTVISIBLELINE: u32 = 0x00CE;
pub const EM_SETREADONLY: u32 = 0x00CF;
pub const EM_SETMARGINS: u32 = 0x00D3;
pub const EC_LEFTMARGIN: usize = 1;
pub const EC_RIGHTMARGIN: usize = 2;
pub const EN_SETFOCUS: u32 = 0x0100;
pub const EN_CHANGE: u32 = 0x0300;
pub const EN_UPDATE: u32 = 0x0400;
pub const ES_MULTILINE: u32 = 0x0004;
pub const ES_AUTOVSCROLL: u32 = 0x0040;
pub const ES_AUTOHSCROLL: u32 = 0x0080;

// window styles
pub const WS_CHILD: u32 = 0x4000_0000;
pub const WS_VISIBLE: u32 = 0x1000_0000;
pub const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
pub const WS_CLIPCHILDREN: u32 = 0x0200_0000;
pub const WS_CAPTION: u32 = 0x00C0_0000;
pub const WS_POPUP: u32 = 0x8000_0000;
pub const WS_EX_TOPMOST: u32 = 0x0000_0008;
pub const WS_EX_WINDOWEDGE: u32 = 0x0000_0100;
pub const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
pub const SW_HIDE: i32 = 0;
pub const SW_SHOWNOACTIVATE: i32 = 4;
pub const SW_SHOW: i32 = 5;
pub const SWP_NOSIZE: u32 = 0x0001;
pub const SWP_NOMOVE: u32 = 0x0002;
pub const SWP_NOZORDER: u32 = 0x0004;
pub const SWP_NOACTIVATE: u32 = 0x0010;
pub const SWP_FRAMECHANGED: u32 = 0x0020;
pub const HWND_TOPMOST: isize = -1;
pub const RDW_INVALIDATE: u32 = 0x0001;
pub const RDW_ALLCHILDREN: u32 = 0x0080;
pub const RDW_UPDATENOW: u32 = 0x0100;
pub const GWLP_WNDPROC: i32 = -4;

// mouse and keys
pub const HTNOWHERE: isize = 0;
pub const HTCLIENT: isize = 1;
pub const HTCAPTION: isize = 2;
pub const IDC_ARROW: usize = 32512;
pub const IDC_IBEAM: usize = 32513;
pub const IDC_WAIT: usize = 32514;
pub const IDC_HAND: usize = 32649;
pub const TME_LEAVE: u32 = 2;
pub const MK_LBUTTON: usize = 0x0001;
pub const VK_LBUTTON: i32 = 0x01;
pub const VK_RBUTTON: i32 = 0x02;
pub const VK_BACK: i32 = 0x08;
pub const VK_TAB: i32 = 0x09;
pub const VK_RETURN: i32 = 0x0D;
pub const VK_SHIFT: i32 = 0x10;
pub const VK_CONTROL: i32 = 0x11;
pub const VK_MENU: i32 = 0x12;
pub const VK_ESCAPE: i32 = 0x1B;
pub const VK_SPACE: i32 = 0x20;
pub const VK_PRIOR: i32 = 0x21;
pub const VK_NEXT: i32 = 0x22;
pub const VK_UP: i32 = 0x26;
pub const VK_DOWN: i32 = 0x28;
pub const VK_DELETE: i32 = 0x2E;
pub const VK_LMENU: u16 = 0xA4;
pub const INPUT_KEYBOARD: u32 = 1;
pub const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
pub const KEYEVENTF_KEYUP: u32 = 0x0002;
pub const SM_SWAPBUTTON: i32 = 23;
pub const SM_CXSIZEFRAME: i32 = 32;
pub const SM_CXPADDEDBORDER: i32 = 92;

// menus
pub const MF_STRING: u32 = 0x0000;
pub const MF_CHECKED: u32 = 0x0008;
pub const TPM_RETURNCMD: u32 = 0x0100;
pub const TPM_NONOTIFY: u32 = 0x0080;
pub const SB_VERT: i32 = 1;

// monitors
pub const MONITOR_DEFAULTTONULL: u32 = 0;
pub const MONITOR_DEFAULTTOPRIMARY: u32 = 1;
pub const MONITOR_DEFAULTTONEAREST: u32 = 2;

// drawing
pub const DT_VCENTER: u32 = 0x0004;
pub const DT_WORDBREAK: u32 = 0x0010;
pub const DT_SINGLELINE: u32 = 0x0020;
pub const DT_NOCLIP: u32 = 0x0100;
pub const DT_CALCRECT: u32 = 0x0400;
pub const DT_NOPREFIX: u32 = 0x0800;
pub const DT_END_ELLIPSIS: u32 = 0x8000;
pub const TRANSPARENT: i32 = 1;
pub const DEFAULT_CHARSET: u32 = 1;
pub const CLEARTYPE_QUALITY: u32 = 5;
pub const FF_SWISS: u32 = 0x20;
pub const SRCCOPY: u32 = 0x00CC_0020;
pub const CAPTUREBLT: u32 = 0x4000_0000;
pub const BI_RGB: u32 = 0;
pub const DIB_RGB_COLORS: u32 = 0;

// clipboard and memory
pub const CF_BITMAP: u32 = 2;
pub const CF_DIB: u32 = 8;
pub const CF_UNICODETEXT: u32 = 13;
pub const CF_HDROP: u32 = 15;
pub const GMEM_MOVEABLE: u32 = 0x0002;
pub const GMEM_ZEROINIT: u32 = 0x0040;
pub const IMAGE_BITMAP: u32 = 0;
pub const LR_CREATEDIBSECTION: u32 = 0x2000;

// the window frame (Desktop Window Manager)
pub const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
pub const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
pub const DWMWA_BORDER_COLOR: u32 = 34;
pub const DWMWCP_ROUND: u32 = 2;
pub const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: isize = -4;
pub const MDT_EFFECTIVE_DPI: u32 = 0;

// the file picker
pub const OFN_HIDEREADONLY: u32 = 0x0000_0004;
pub const OFN_NOCHANGEDIR: u32 = 0x0000_0008;
pub const OFN_ALLOWMULTISELECT: u32 = 0x0000_0200;
pub const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;
pub const OFN_FILEMUSTEXIST: u32 = 0x0000_1000;
pub const OFN_EXPLORER: u32 = 0x0008_0000;
pub const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x0000_0800;

#[link(name = "user32")]
extern "system" {
    pub fn RegisterClassExW(c: *const WNDCLASSEXW) -> u16;
    pub fn CreateWindowExW(ex: u32, class: *const u16, title: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32, parent: isize, menu: isize, inst: isize, param: *mut c_void) -> isize;
    pub fn DestroyWindow(h: isize) -> i32;
    pub fn DefWindowProcW(h: isize, m: u32, w: usize, l: isize) -> isize;
    pub fn CallWindowProcW(prev: isize, h: isize, m: u32, w: usize, l: isize) -> isize;
    pub fn SetWindowLongPtrW(h: isize, i: i32, v: isize) -> isize;
    pub fn GetMessageW(m: *mut MSG, h: isize, min: u32, max: u32) -> i32;
    pub fn TranslateMessage(m: *const MSG) -> i32;
    pub fn DispatchMessageW(m: *const MSG) -> isize;
    pub fn PostQuitMessage(code: i32);
    pub fn PostMessageW(h: isize, m: u32, w: usize, l: isize) -> i32;
    pub fn SendMessageW(h: isize, m: u32, w: usize, l: isize) -> isize;
    pub fn SendMessageTimeoutW(h: isize, m: u32, w: usize, l: isize, flags: u32, timeout_ms: u32, result: *mut usize) -> isize;
    pub fn ShowWindow(h: isize, cmd: i32) -> i32;
    pub fn UpdateWindow(h: isize) -> i32;
    pub fn RedrawWindow(h: isize, r: *const RECT, rgn: isize, flags: u32) -> i32;
    pub fn SetForegroundWindow(h: isize) -> i32;
    pub fn GetForegroundWindow() -> isize;
    pub fn SetFocus(h: isize) -> isize;
    pub fn GetFocus() -> isize;
    pub fn SetWindowPos(h: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    pub fn MoveWindow(h: isize, x: i32, y: i32, w: i32, hh: i32, repaint: i32) -> i32;
    pub fn GetClientRect(h: isize, r: *mut RECT) -> i32;
    pub fn GetWindowRect(h: isize, r: *mut RECT) -> i32;
    pub fn InvalidateRect(h: isize, r: *const RECT, erase: i32) -> i32;
    pub fn BeginPaint(h: isize, ps: *mut PAINTSTRUCT) -> isize;
    pub fn EndPaint(h: isize, ps: *const PAINTSTRUCT) -> i32;
    pub fn GetDC(h: isize) -> isize;
    pub fn ReleaseDC(h: isize, dc: isize) -> i32;
    pub fn DrawTextW(dc: isize, s: *const u16, n: i32, r: *mut RECT, fmt: u32) -> i32;
    pub fn LoadCursorW(inst: isize, id: usize) -> isize;
    pub fn SetCursor(c: isize) -> isize;
    pub fn GetCursorPos(p: *mut POINT) -> i32;
    pub fn ScreenToClient(h: isize, p: *mut POINT) -> i32;
    pub fn ClientToScreen(h: isize, p: *mut POINT) -> i32;
    pub fn MonitorFromPoint(p: POINT, flags: u32) -> isize;
    pub fn MonitorFromWindow(h: isize, flags: u32) -> isize;
    pub fn GetMonitorInfoW(m: isize, mi: *mut MONITORINFO) -> i32;
    pub fn SetTimer(h: isize, id: usize, ms: u32, f: *const c_void) -> usize;
    pub fn KillTimer(h: isize, id: usize) -> i32;
    pub fn TrackMouseEvent(t: *mut TRACKMOUSEEVENT) -> i32;
    pub fn SetCapture(h: isize) -> isize;
    pub fn ReleaseCapture() -> i32;
    pub fn GetKeyState(vk: i32) -> i16;
    pub fn GetAsyncKeyState(vk: i32) -> i16;
    pub fn GetSystemMetrics(i: i32) -> i32;
    pub fn SendInput(n: u32, inputs: *const INPUT, size: i32) -> u32;
    pub fn MapVirtualKeyW(code: u32, kind: u32) -> u32;
    pub fn CreatePopupMenu() -> isize;
    pub fn AppendMenuW(m: isize, flags: u32, id: usize, text: *const u16) -> i32;
    pub fn TrackPopupMenuEx(m: isize, flags: u32, x: i32, y: i32, h: isize, p: *const c_void) -> i32;
    pub fn DestroyMenu(m: isize) -> i32;
    pub fn ShowScrollBar(h: isize, bar: i32, show: i32) -> i32;
    pub fn GetWindowTextLengthW(h: isize) -> i32;
    pub fn GetWindowTextW(h: isize, s: *mut u16, n: i32) -> i32;
    pub fn SetWindowTextW(h: isize, s: *const u16) -> i32;
    pub fn IsWindow(h: isize) -> i32;
    pub fn GetParent(h: isize) -> isize;
    pub fn HideCaret(h: isize) -> i32;
    pub fn ShowCaret(h: isize) -> i32;
    pub fn GetWindowThreadProcessId(h: isize, pid: *mut u32) -> u32;
    pub fn OpenClipboard(owner: *mut c_void) -> i32;
    pub fn CloseClipboard() -> i32;
    pub fn GetClipboardData(format: u32) -> *mut c_void;
    pub fn IsClipboardFormatAvailable(format: u32) -> i32;
    pub fn RegisterClipboardFormatW(name: *const u16) -> u32;
    pub fn EmptyClipboard() -> i32;
    pub fn SetClipboardData(format: u32, h: *mut c_void) -> *mut c_void;
    pub fn SetProcessDPIAware() -> i32;
    pub fn FindWindowExW(parent: isize, after: isize, class: *const u16, title: *const u16) -> isize;
    pub fn CopyImage(h: isize, kind: u32, cx: i32, cy: i32, flags: u32) -> isize;
    pub fn IsWindowVisible(h: isize) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    pub fn CreateFontW(h: i32, w: i32, esc: i32, orient: i32, weight: i32, italic: u32, underline: u32, strike: u32, charset: u32, out_prec: u32, clip_prec: u32, quality: u32, pitch: u32, face: *const u16) -> isize;
    pub fn SelectObject(dc: isize, o: isize) -> isize;
    pub fn DeleteObject(o: isize) -> i32;
    pub fn CreateSolidBrush(c: u32) -> isize;
    pub fn SetTextColor(dc: isize, c: u32) -> u32;
    pub fn SetBkColor(dc: isize, c: u32) -> u32;
    pub fn SetBkMode(dc: isize, mode: i32) -> i32;
    pub fn GetTextExtentPoint32W(dc: isize, s: *const u16, n: i32, sz: *mut SIZE) -> i32;
    pub fn GetTextMetricsW(dc: isize, tm: *mut TEXTMETRICW) -> i32;
    pub fn GetTextFaceW(dc: isize, n: i32, s: *mut u16) -> i32;
    pub fn CreateCompatibleDC(dc: isize) -> isize;
    pub fn DeleteDC(dc: isize) -> i32;
    pub fn CreateDIBSection(dc: isize, bi: *const BITMAPINFO, usage: u32, bits: *mut *mut c_void, section: isize, offset: u32) -> isize;
    pub fn BitBlt(dst: isize, x: i32, y: i32, w: i32, h: i32, src: isize, sx: i32, sy: i32, rop: u32) -> i32;
    pub fn GdiFlush() -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    pub fn GetModuleHandleW(name: *const u16) -> isize;
    pub fn LoadLibraryExW(name: *const u16, file: isize, flags: u32) -> isize;
    pub fn GetProcAddress(m: isize, name: *const u8) -> *const c_void;
    pub fn GlobalAlloc(flags: u32, n: usize) -> *mut c_void;
    pub fn GlobalFree(h: *mut c_void) -> *mut c_void;
    pub fn GlobalLock(h: *mut c_void) -> *mut c_void;
    pub fn GlobalUnlock(h: *mut c_void) -> i32;
    pub fn GlobalSize(h: *mut c_void) -> usize;
    pub fn GetCurrentProcess() -> isize;
    pub fn GetCurrentProcessId() -> u32;
    pub fn GetProcessTimes(p: isize, created: *mut FILETIME, exited: *mut FILETIME, kernel: *mut FILETIME, user: *mut FILETIME) -> i32;
    pub fn GetSystemTimePreciseAsFileTime(t: *mut FILETIME);
    pub fn GetTickCount64() -> u64;
}

#[link(name = "dwmapi")]
extern "system" {
    pub fn DwmSetWindowAttribute(h: isize, attr: u32, value: *const c_void, size: u32) -> i32;
    pub fn DwmFlush() -> i32;
}

#[link(name = "uxtheme")]
extern "system" {
    pub fn SetWindowTheme(h: isize, app: *const u16, list: *const u16) -> i32;
}

#[link(name = "shell32")]
extern "system" {
    pub fn DragAcceptFiles(h: isize, accept: i32);
    pub fn DragQueryFileW(drop: isize, i: u32, s: *mut u16, n: u32) -> u32;
    pub fn DragFinish(drop: isize);
}

#[link(name = "ole32")]
extern "system" {
    pub fn CoInitializeEx(reserved: *mut c_void, flags: u32) -> i32;
    pub fn CreateStreamOnHGlobal(h: *mut c_void, delete_on_release: i32, stream: *mut *mut c_void) -> i32;
    pub fn GetHGlobalFromStream(stream: *mut c_void, h: *mut *mut c_void) -> i32;
}

#[link(name = "ntdll")]
extern "system" {
    pub fn RtlGetVersion(v: *mut OSVERSIONINFOW) -> i32;
}

/// A NUL-ended UTF-16 copy of `s`, as Windows takes text.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// A function in a Windows library, found when first needed (None when this Windows lacks it).
/// Libraries come from the system folder only.
pub fn proc_addr(dll: &str, name: &str) -> Option<*const c_void> {
    let d = wide(dll);
    let mut n = name.as_bytes().to_vec();
    n.push(0);
    unsafe {
        let mut m = GetModuleHandleW(d.as_ptr());
        if m == 0 {
            m = LoadLibraryExW(d.as_ptr(), 0, LOAD_LIBRARY_SEARCH_SYSTEM32);
        }
        if m == 0 {
            return None;
        }
        let p = GetProcAddress(m, n.as_ptr());
        (!p.is_null()).then_some(p)
    }
}

pub fn loword(v: usize) -> u32 {
    (v & 0xFFFF) as u32
}
pub fn hiword(v: usize) -> u32 {
    ((v >> 16) & 0xFFFF) as u32
}
/// The signed x and y packed in a mouse message's lParam.
pub fn point_of(l: isize) -> POINT {
    POINT { x: (l & 0xFFFF) as u16 as i16 as i32, y: ((l >> 16) & 0xFFFF) as u16 as i16 as i32 }
}
