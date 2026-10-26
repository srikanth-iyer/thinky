//! Pictures and files for the capture box: the file picker, the clipboard (its text, a picture
//! such as a Win+Shift+S screenshot, or files copied in Explorer), and turning a picture into a
//! PNG file with Windows' own encoder (GDI+), loaded only when a picture is pasted.

use super::ffi::*;
use outline_core::capture_box::png_len;
use std::ffi::c_void;
use std::path::PathBuf;

pub fn clipboard_text() -> String {
    crate::win::clipboard_text()
}

/// What pasting brings.
pub enum Clip {
    /// text: the text box pastes it itself
    Text,
    /// files copied in Explorer
    Files(Vec<PathBuf>),
    /// a picture, as PNG
    Picture(Vec<u8>),
    /// a picture as a bitmap of our own (a copy), to be turned into PNG away from the box's thread
    Bitmap(isize),
    Problem(String),
}

/// The clipboard, opened (another program may hold it for a moment).
fn open_clipboard(owner: isize) -> bool {
    for _ in 0..10 {
        if unsafe { OpenClipboard(owner as *mut c_void) } != 0 {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    false
}

/// A copy of a block of global memory (the clipboard's and streams' way of holding data).
unsafe fn global_bytes(h: *mut c_void) -> Option<Vec<u8>> {
    if h.is_null() {
        return None;
    }
    let n = GlobalSize(h);
    let p = GlobalLock(h) as *const u8;
    if p.is_null() {
        return None;
    }
    let v = std::slice::from_raw_parts(p, n).to_vec();
    GlobalUnlock(h);
    Some(v)
}

/// The files in a list of dropped or copied files.
pub unsafe fn drop_paths(drop: isize) -> Vec<PathBuf> {
    let n = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0);
    let mut out = Vec::new();
    for i in 0..n {
        let len = DragQueryFileW(drop, i, std::ptr::null_mut(), 0);
        let mut buf = vec![0u16; len as usize + 1];
        let got = DragQueryFileW(drop, i, buf.as_mut_ptr(), buf.len() as u32);
        out.push(PathBuf::from(String::from_utf16_lossy(&buf[..got as usize])));
    }
    out
}

/// What a paste in the note would bring. Text wins (the text box pastes it as usual); else files
/// copied in Explorer; else a picture (its PNG as it is, or a copy of the bitmap, which the caller
/// turns into PNG on another thread with `png_from_bitmap` and then frees).
pub fn clipboard_items(owner: isize) -> Clip {
    unsafe {
        if IsClipboardFormatAvailable(CF_UNICODETEXT) != 0 {
            return Clip::Text;
        }
        let png_name = wide("PNG");
        let png_fmt = RegisterClipboardFormatW(png_name.as_ptr());
        let files = IsClipboardFormatAvailable(CF_HDROP) != 0;
        let png = png_fmt != 0 && IsClipboardFormatAvailable(png_fmt) != 0;
        let bitmap = IsClipboardFormatAvailable(CF_BITMAP) != 0 || IsClipboardFormatAvailable(CF_DIB) != 0;
        if !files && !png && !bitmap {
            return Clip::Text;
        }
        if !open_clipboard(owner) {
            return Clip::Problem("The clipboard is busy; try pasting again.".into());
        }
        let mut out = None;
        if files {
            let h = GetClipboardData(CF_HDROP);
            if !h.is_null() {
                out = Some(Clip::Files(drop_paths(h as isize)));
            }
        }
        if out.is_none() && png {
            if let Some(b) = global_bytes(GetClipboardData(png_fmt)).and_then(|b| png_len(&b).map(|n| b[..n].to_vec())) {
                out = Some(Clip::Picture(b));
            }
        }
        if out.is_none() && bitmap {
            // a copy (quick): the clipboard's own bitmap is only ours while it's open
            let h = GetClipboardData(CF_BITMAP) as isize;
            let copy = if h != 0 { CopyImage(h, IMAGE_BITMAP, 0, 0, LR_CREATEDIBSECTION) } else { 0 };
            out = Some(if copy != 0 { Clip::Bitmap(copy) } else { Clip::Problem("Couldn't take the picture from the clipboard.".into()) });
        }
        CloseClipboard();
        out.unwrap_or(Clip::Text)
    }
}

type Startup = unsafe extern "system" fn(*mut usize, *const GdiplusStartupInput, *mut c_void) -> i32;
type Shutdown = unsafe extern "system" fn(usize);
type FromHbitmap = unsafe extern "system" fn(isize, isize, *mut *mut c_void) -> i32;
type SaveToStream = unsafe extern "system" fn(*mut c_void, *mut c_void, *const GUID, *const c_void) -> i32;
type Dispose = unsafe extern "system" fn(*mut c_void) -> i32;

/// GDI+'s PNG encoder.
const PNG_ENCODER: GUID = GUID { d1: 0x557C_F406, d2: 0x1A04, d3: 0x11D3, d4: [0x9A, 0x73, 0x00, 0x00, 0xF8, 0x1E, 0xF3, 0x2E] };

/// A COM object's Release (third in its table of functions).
unsafe fn release(obj: *mut c_void) {
    let table = *(obj as *const *const usize);
    let f: unsafe extern "system" fn(*mut c_void) -> u32 = std::mem::transmute(*table.add(2));
    f(obj);
}

/// A bitmap as PNG bytes, by Windows' GDI+ (gdiplus.dll, loaded only now).
pub fn png_from_bitmap(hbm: isize) -> Option<Vec<u8>> {
    let get = |name: &str| proc_addr("gdiplus.dll", name);
    unsafe {
        let startup: Startup = std::mem::transmute(get("GdiplusStartup")?);
        let shutdown: Shutdown = std::mem::transmute(get("GdiplusShutdown")?);
        let from_hbitmap: FromHbitmap = std::mem::transmute(get("GdipCreateBitmapFromHBITMAP")?);
        let save: SaveToStream = std::mem::transmute(get("GdipSaveImageToStream")?);
        let dispose: Dispose = std::mem::transmute(get("GdipDisposeImage")?);
        let input = GdiplusStartupInput { version: 1, debug_callback: std::ptr::null(), suppress_background_thread: 0, suppress_external_codecs: 0 };
        let mut token = 0usize;
        if startup(&mut token, &input, std::ptr::null_mut()) != 0 {
            return None;
        }
        let mut out = None;
        let mut img: *mut c_void = std::ptr::null_mut();
        if from_hbitmap(hbm, 0, &mut img) == 0 && !img.is_null() {
            let mut stream: *mut c_void = std::ptr::null_mut();
            if CreateStreamOnHGlobal(std::ptr::null_mut(), 1, &mut stream) == 0 && !stream.is_null() {
                if save(img, stream, &PNG_ENCODER, std::ptr::null()) == 0 {
                    let mut hg: *mut c_void = std::ptr::null_mut();
                    if GetHGlobalFromStream(stream, &mut hg) == 0 {
                        out = global_bytes(hg).and_then(|b| png_len(&b).map(|n| b[..n].to_vec()));
                    }
                }
                release(stream);
            }
            dispose(img);
        }
        shutdown(token);
        out
    }
}

/// The file picker ("Picture or file…"): one file or several. Nothing picked: none.
pub fn pick(owner: isize) -> Vec<PathBuf> {
    type GetOpen = unsafe extern "system" fn(*mut OPENFILENAMEW) -> i32;
    let Some(p) = proc_addr("comdlg32.dll", "GetOpenFileNameW") else { return Vec::new() };
    unsafe {
        CoInitializeEx(std::ptr::null_mut(), 2); // the dialog's shell parts want this thread ready for COM
        let f: GetOpen = std::mem::transmute(p);
        let mut buf = vec![0u16; 1 << 16];
        let filter: Vec<u16> = "All files\0*.*\0Pictures\0*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg;*.avif\0\0".encode_utf16().collect();
        let title = wide("Add a picture or file");
        let mut ofn: OPENFILENAMEW = std::mem::zeroed();
        ofn.size = std::mem::size_of::<OPENFILENAMEW>() as u32;
        ofn.owner = owner;
        ofn.filter = filter.as_ptr();
        ofn.filter_index = 1;
        ofn.file = buf.as_mut_ptr();
        ofn.max_file = buf.len() as u32;
        ofn.title = title.as_ptr();
        ofn.flags = OFN_ALLOWMULTISELECT | OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY | OFN_NOCHANGEDIR;
        if f(&mut ofn) == 0 {
            return Vec::new();
        }
        // one file: its whole path; several: the folder, then each name
        let parts: Vec<String> = buf.split(|&c| c == 0).take_while(|s| !s.is_empty()).map(String::from_utf16_lossy).collect();
        match parts.len() {
            0 => Vec::new(),
            1 => vec![PathBuf::from(&parts[0])],
            _ => parts[1..].iter().map(|n| PathBuf::from(&parts[0]).join(n)).collect(),
        }
    }
}

// ----- for the self-test -----

/// A small made-up picture (stripes), as a bitmap.
pub fn test_bitmap() -> isize {
    let (w, h) = (64, 48);
    unsafe {
        let bi = BITMAPINFO::top_down(w, h);
        let mut bits: *mut c_void = std::ptr::null_mut();
        let dc = GetDC(0);
        let hbm = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &mut bits, 0, 0);
        ReleaseDC(0, dc);
        if hbm != 0 && !bits.is_null() {
            let px = std::slice::from_raw_parts_mut(bits as *mut u32, (w * h) as usize);
            for (i, p) in px.iter_mut().enumerate() {
                let (x, y) = (i as i32 % w, i as i32 / w);
                *p = if (x / 8 + y / 8) % 2 == 0 { 0x0B7B66 } else { 0xF7F8F6 };
            }
        }
        hbm
    }
}

/// Put text, or a picture, on the clipboard.
pub fn set_clipboard(owner: isize, text: Option<&str>, bitmap: isize) -> bool {
    unsafe {
        if !open_clipboard(owner) {
            return false;
        }
        EmptyClipboard();
        let mut ok = true;
        if let Some(t) = text {
            let w = wide(t);
            let g = GlobalAlloc(GMEM_MOVEABLE, w.len() * 2);
            let p = GlobalLock(g) as *mut u16;
            if p.is_null() {
                ok = false;
            } else {
                std::ptr::copy_nonoverlapping(w.as_ptr(), p, w.len());
                GlobalUnlock(g);
                ok = !SetClipboardData(CF_UNICODETEXT, g).is_null();
            }
        }
        if bitmap != 0 {
            ok &= !SetClipboardData(CF_BITMAP, bitmap as *mut c_void).is_null();
        }
        CloseClipboard();
        ok
    }
}

/// A list of files as Explorer hands them over when they're dropped (freed by the receiver).
pub fn make_drop(paths: &[PathBuf]) -> isize {
    let mut names: Vec<u16> = Vec::new();
    for p in paths {
        names.extend(p.to_string_lossy().encode_utf16());
        names.push(0);
    }
    names.push(0);
    let head = std::mem::size_of::<DROPFILES>();
    unsafe {
        let g = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, head + names.len() * 2);
        let p = GlobalLock(g) as *mut u8;
        if p.is_null() {
            return 0;
        }
        let df = DROPFILES { files_offset: head as u32, pt: POINT { x: 20, y: 20 }, nc: 0, wide: 1 };
        std::ptr::copy_nonoverlapping(&df as *const DROPFILES as *const u8, p, head);
        std::ptr::copy_nonoverlapping(names.as_ptr() as *const u8, p.add(head), names.len() * 2);
        GlobalUnlock(g);
        g as isize
    }
}

/// What's on the screen in `r`, as PNG (the box with Windows' shadow and corners around it).
pub fn screenshot(r: RECT) -> Option<Vec<u8>> {
    let (w, h) = (r.right - r.left, r.bottom - r.top);
    if w <= 0 || h <= 0 {
        return None;
    }
    unsafe {
        let screen = GetDC(0);
        let mem = CreateCompatibleDC(screen);
        let bi = BITMAPINFO::top_down(w, h);
        let mut bits: *mut c_void = std::ptr::null_mut();
        let hbm = CreateDIBSection(screen, &bi, DIB_RGB_COLORS, &mut bits, 0, 0);
        let mut out = None;
        if hbm != 0 {
            let old = SelectObject(mem, hbm);
            BitBlt(mem, 0, 0, w, h, screen, r.left, r.top, SRCCOPY | CAPTUREBLT);
            SelectObject(mem, old);
            out = png_from_bitmap(hbm);
            DeleteObject(hbm);
        }
        DeleteDC(mem);
        ReleaseDC(0, screen);
        out
    }
}
