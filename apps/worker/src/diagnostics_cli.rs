use std::{
    collections::BTreeSet,
    env,
    ffi::{c_void, OsStr, OsString},
    fs,
    io::{self, Read, Write},
    os::windows::{ffi::OsStringExt, fs::MetadataExt},
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::workspace;

type Handle = *mut c_void;
const WORKSPACE_MAGIC: &[u8; 8] = b"XPLWSP01";
const WORKSPACE_VERSION: u32 = 1;
const FLAG_DIRECTORY: u8 = 1;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const ATTACH_PARENT_PROCESS: u32 = u32::MAX;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn AttachConsole(process_id: u32) -> i32;
}

pub fn run(arguments: &[OsString]) -> io::Result<i32> {
    unsafe { let _ = AttachConsole(ATTACH_PARENT_PROCESS); }
    match run_inner(arguments) {
        Ok(code) => Ok(code),
        Err(error) => {
            err(&format!("[ERROR] diagnostic failed: {error}"));
            err(&format!("[ERROR] detail: {error:?}"));
            if let Some(path) = save_fatal(arguments, &error) {
                err(&format!("[ERROR] fatal report: {}", path.display()));
            }
            Ok(1)
        }
    }
}

fn run_inner(arguments: &[OsString]) -> io::Result<i32> {
    if !arguments.iter().any(|value| is_debug(value)) {
        err("[ERROR] --test-folder requires --debug.");
        err("Usage: xplorer.exe --debug --test-folder \"C:\\path\\to\\folder\"");
        return Ok(64);
    }

    let requested = parse_folder(arguments).ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "--test-folder is missing its folder path")
    })?;
    let folder = PathBuf::from(requested).canonicalize()?;
    if !folder.is_dir() {
        err("[ERROR] requested path is not a directory");
        return Ok(66);
    }

    out("");
    out("Xplorer folder diagnostic");
    out("=========================");
    out(&format!("Folder: {}", folder.display()));
    out(&format!("PID: {}", std::process::id()));
    out("");

    out("[1/5] Direct filesystem scan");
    let direct_start = Instant::now();
    let direct = scan_direct(&folder)?;
    let direct_ms = ms(direct_start);
    out(&format!("[OK] {} files, {} folders ({direct_ms:.3} ms)", direct.files.len(), direct.folders.len()));

    out("[2/5] Recursive filesystem count");
    let recursive_start = Instant::now();
    let recursive = scan_recursive(&folder)?;
    let recursive_ms = ms(recursive_start);
    out(&format!("[OK] {} files, {} folders ({recursive_ms:.3} ms)", recursive.files, recursive.folders));

    let local = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is unavailable"))?;
    let index_dir = PathBuf::from(&local).join("Xplorer").join("Index");
    let log_dir = PathBuf::from(local).join("Xplorer").join("Logs");
    fs::create_dir_all(&index_dir)?;
    fs::create_dir_all(&log_dir)?;

    out("[3/5] Rebuild hot workspace index");
    let hint = index_dir.join("workspace.hint");
    let temp = index_dir.join(format!("workspace.hint.debug.{}.tmp", std::process::id()));
    fs::write(&temp, folder.as_os_str().to_string_lossy().as_bytes())?;
    let _ = fs::remove_file(&hint);
    fs::rename(&temp, &hint)?;
    let rebuild_start = Instant::now();
    let rebuilt = workspace::refresh_hot_workspace(&index_dir, None)?;
    let rebuild_ms = ms(rebuild_start);
    out(&format!("[OK] rebuilt={rebuilt} ({rebuild_ms:.3} ms)"));

    out("[4/5] Decode workspace.xwidx");
    let index_path = index_dir.join("workspace.xwidx");
    let decode_start = Instant::now();
    let index = decode_index(&index_path)?;
    let decode_ms = ms(decode_start);
    out(&format!("[OK] {} cached records ({decode_ms:.3} ms)", index.records));

    out("[5/5] Compare disk and index");
    let missing: Vec<_> = direct.names.difference(&index.direct_names).cloned().collect();
    let extra: Vec<_> = index.direct_names.difference(&direct.names).cloned().collect();
    let root_ok = index.root.eq_ignore_ascii_case(folder.to_string_lossy().as_ref());
    let pass = root_ok && missing.is_empty() && extra.is_empty();
    out(if pass { "[OK] direct children match" } else { "[ERROR] disk/index mismatch" });

    let mut warnings = direct.warnings.clone();
    warnings.extend(recursive.warnings.clone());
    let report = report(
        &folder, &index_path, rebuilt, &direct, &recursive, &index,
        &missing, &extra, &warnings, pass, direct_ms, recursive_ms, rebuild_ms, decode_ms,
    );
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let log_path = log_dir.join(format!("debug-folder-{stamp}.log"));
    fs::write(&log_path, report.as_bytes())?;

    out("");
    out(&report);
    out(&format!("Report saved to: {}", log_path.display()));
    out(&format!("Exit result: {}", if pass { "PASS (0)" } else { "FAIL (2)" }));
    out("");
    Ok(if pass { 0 } else { 2 })
}

#[derive(Default, Clone)]
struct DirectScan {
    names: BTreeSet<String>,
    files: Vec<String>,
    folders: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Default, Clone)]
struct RecursiveScan {
    files: u64,
    folders: u64,
    skipped_reparse: u64,
    warnings: Vec<String>,
}

struct IndexScan {
    root: String,
    timestamp: u64,
    records: u64,
    files: u64,
    folders: u64,
    direct_files: u64,
    direct_folders: u64,
    direct_names: BTreeSet<String>,
}

fn scan_direct(folder: &Path) -> io::Result<DirectScan> {
    let mut scan = DirectScan::default();
    for entry in fs::read_dir(folder)? {
        let entry = match entry { Ok(v) => v, Err(e) => { scan.warnings.push(format!("read_dir entry: {e}")); continue; } };
        let name = entry.file_name().to_string_lossy().into_owned();
        scan.names.insert(name.to_ascii_lowercase());
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => scan.folders.push(name),
            Ok(_) => scan.files.push(name),
            Err(e) => { scan.warnings.push(format!("type '{}': {e}", entry.path().display())); scan.files.push(name); }
        }
    }
    scan.files.sort_by_key(|v| v.to_ascii_lowercase());
    scan.folders.sort_by_key(|v| v.to_ascii_lowercase());
    Ok(scan)
}

fn scan_recursive(root: &Path) -> io::Result<RecursiveScan> {
    let mut scan = RecursiveScan::default();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(e) => { scan.warnings.push(format!("enumerate '{}': {e}", dir.display())); continue; }
        };
        for entry in entries {
            let entry = match entry { Ok(v) => v, Err(e) => { scan.warnings.push(format!("entry in '{}': {e}", dir.display())); continue; } };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(v) => v,
                Err(e) => { scan.warnings.push(format!("metadata '{}': {e}", path.display())); continue; }
            };
            if metadata.is_dir() {
                scan.folders += 1;
                if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 { scan.skipped_reparse += 1; }
                else { stack.push(path); }
            } else { scan.files += 1; }
        }
    }
    Ok(scan)
}

fn decode_index(path: &Path) -> io::Result<IndexScan> {
    let mut bytes = Vec::new();
    fs::File::open(path)?.read_to_end(&mut bytes)?;
    let mut cursor = 0usize;
    if take(&bytes, &mut cursor, 8)? != WORKSPACE_MAGIC { return Err(invalid("workspace magic mismatch")); }
    let version = u32_at(&bytes, &mut cursor)?;
    if version != WORKSPACE_VERSION { return Err(invalid(&format!("unsupported workspace version {version}"))); }
    let timestamp = u64_at(&bytes, &mut cursor)?;
    let root_units = u32_at(&bytes, &mut cursor)? as usize;
    let root = utf16_at(&bytes, &mut cursor, root_units)?;
    let mut result = IndexScan { root, timestamp, records: 0, files: 0, folders: 0, direct_files: 0, direct_folders: 0, direct_names: BTreeSet::new() };
    while cursor < bytes.len() {
        let start = cursor;
        let length = u32_at(&bytes, &mut cursor)? as usize;
        if length < 32 || start.checked_add(length).filter(|v| *v <= bytes.len()).is_none() { return Err(invalid("bad workspace record length")); }
        let flags = take(&bytes, &mut cursor, 4)?[0];
        let _attributes = u32_at(&bytes, &mut cursor)?;
        let _size = u64_at(&bytes, &mut cursor)?;
        let _last_write = u64_at(&bytes, &mut cursor)?;
        let units = u32_at(&bytes, &mut cursor)? as usize;
        let relative = utf16_at(&bytes, &mut cursor, units)?;
        if cursor != start + length { return Err(invalid("workspace record size mismatch")); }
        result.records += 1;
        let directory = flags & FLAG_DIRECTORY != 0;
        if directory { result.folders += 1; } else { result.files += 1; }
        let relative = PathBuf::from(relative);
        if relative.components().count() == 1 {
            if directory { result.direct_folders += 1; } else { result.direct_files += 1; }
            if let Some(name) = relative.file_name() { result.direct_names.insert(name.to_string_lossy().to_ascii_lowercase()); }
        }
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn report(
    folder: &Path, index_path: &Path, rebuilt: bool, direct: &DirectScan, recursive: &RecursiveScan,
    index: &IndexScan, missing: &[String], extra: &[String], warnings: &[String], pass: bool,
    direct_ms: f64, recursive_ms: f64, rebuild_ms: f64, decode_ms: f64,
) -> String {
    let mut r = String::new();
    line(&mut r, "Xplorer folder diagnostic report");
    line(&mut r, "================================");
    line(&mut r, &format!("Result: {}", if pass { "PASS" } else { "FAIL" }));
    line(&mut r, &format!("Folder: {}", folder.display()));
    line(&mut r, &format!("Executable: {}", env::current_exe().map(|v| v.display().to_string()).unwrap_or_else(|_| "<unknown>".into())));
    line(&mut r, &format!("PID: {}", std::process::id()));
    line(&mut r, "");
    line(&mut r, "INDEX STATUS");
    line(&mut r, "------------");
    line(&mut r, "Indexed: YES");
    line(&mut r, &format!("Index file: {}", index_path.display()));
    line(&mut r, &format!("Index version: {WORKSPACE_VERSION}"));
    line(&mut r, &format!("Index timestamp: {}", index.timestamp));
    line(&mut r, &format!("Index root: {}", index.root));
    line(&mut r, &format!("Snapshot rebuilt for test: {rebuilt}"));
    line(&mut r, &format!("Indexed direct files: {}", index.direct_files));
    line(&mut r, &format!("Indexed direct folders: {}", index.direct_folders));
    line(&mut r, &format!("Indexed cached files (depth <= 3): {}", index.files));
    line(&mut r, &format!("Indexed cached folders (depth <= 3): {}", index.folders));
    line(&mut r, &format!("Index matches direct children: {}", if pass { "YES" } else { "NO" }));
    line(&mut r, "");
    line(&mut r, "FILESYSTEM COUNTS");
    line(&mut r, "-----------------");
    line(&mut r, &format!("Files in this folder: {}", direct.files.len()));
    line(&mut r, &format!("Folders in this folder: {}", direct.folders.len()));
    line(&mut r, &format!("Files IN TOTAL: {}", recursive.files));
    line(&mut r, &format!("Folders IN TOTAL: {}", recursive.folders));
    line(&mut r, &format!("Reparse folders skipped: {}", recursive.skipped_reparse));
    line(&mut r, "");
    line(&mut r, "INDEX COMPARISON");
    line(&mut r, "----------------");
    line(&mut r, &format!("Missing from index: {}", missing.len()));
    for value in missing { line(&mut r, &format!("  - {value}")); }
    line(&mut r, &format!("Extra in index: {}", extra.len()));
    for value in extra { line(&mut r, &format!("  - {value}")); }
    line(&mut r, "");
    line(&mut r, "TIMING");
    line(&mut r, "------");
    line(&mut r, &format!("Direct scan: {direct_ms:.3} ms"));
    line(&mut r, &format!("Recursive scan: {recursive_ms:.3} ms"));
    line(&mut r, &format!("Index rebuild: {rebuild_ms:.3} ms"));
    line(&mut r, &format!("Index decode: {decode_ms:.3} ms"));
    line(&mut r, "");
    line(&mut r, &format!("FILES ({})", direct.files.len()));
    line(&mut r, "-----");
    if direct.files.is_empty() { line(&mut r, "  <none>"); } else { for value in &direct.files { line(&mut r, &format!("  - {value}")); } }
    line(&mut r, "");
    line(&mut r, &format!("FOLDERS ({})", direct.folders.len()));
    line(&mut r, "-------");
    if direct.folders.is_empty() { line(&mut r, "  <none>"); } else { for value in &direct.folders { line(&mut r, &format!("  - {value}\\")); } }
    line(&mut r, "");
    line(&mut r, &format!("WARNINGS / ERRORS ({})", warnings.len()));
    line(&mut r, "-------------------");
    if warnings.is_empty() { line(&mut r, "  <none>"); } else { for value in warnings { line(&mut r, &format!("  [WARN] {value}")); } }
    r
}

fn save_fatal(arguments: &[OsString], error: &io::Error) -> Option<PathBuf> {
    let local = env::var_os("LOCALAPPDATA")?;
    let dir = PathBuf::from(local).join("Xplorer").join("Logs");
    fs::create_dir_all(&dir).ok()?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let path = dir.join(format!("debug-folder-fatal-{stamp}.log"));
    let args = arguments.iter().map(|v| v.to_string_lossy()).collect::<Vec<_>>().join(" ");
    fs::write(&path, format!("Xplorer diagnostic FATAL\r\nArguments: {args}\r\nError: {error}\r\nDebug: {error:?}\r\n")).ok()?;
    Some(path)
}

fn parse_folder(arguments: &[OsString]) -> Option<OsString> {
    for (i, arg) in arguments.iter().enumerate() {
        let text = arg.to_string_lossy();
        if text.eq_ignore_ascii_case("--test-folder") { return arguments.get(i + 1).cloned(); }
        if let Some((key, value)) = text.split_once('=') {
            if key.eq_ignore_ascii_case("--test-folder") && !value.is_empty() { return Some(OsString::from(value)); }
        }
    }
    None
}

fn is_debug(value: &OsStr) -> bool {
    matches!(value.to_string_lossy().to_ascii_lowercase().as_str(), "--debug" | "-debug" | "--diagnose")
}

fn take<'a>(bytes: &'a [u8], cursor: &mut usize, count: usize) -> io::Result<&'a [u8]> {
    let end = cursor.checked_add(count).ok_or_else(|| invalid("index cursor overflow"))?;
    if end > bytes.len() { return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "workspace index ended early")); }
    let value = &bytes[*cursor..end]; *cursor = end; Ok(value)
}
fn u32_at(bytes: &[u8], cursor: &mut usize) -> io::Result<u32> { Ok(u32::from_le_bytes(take(bytes, cursor, 4)?.try_into().unwrap())) }
fn u64_at(bytes: &[u8], cursor: &mut usize) -> io::Result<u64> { Ok(u64::from_le_bytes(take(bytes, cursor, 8)?.try_into().unwrap())) }
fn utf16_at(bytes: &[u8], cursor: &mut usize, units: usize) -> io::Result<String> {
    let raw = take(bytes, cursor, units.checked_mul(2).ok_or_else(|| invalid("UTF-16 length overflow"))?)?;
    let wide = raw.chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect::<Vec<_>>();
    Ok(OsString::from_wide(&wide).to_string_lossy().into_owned())
}
fn invalid(message: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidData, message.to_string()) }
fn ms(start: Instant) -> f64 { start.elapsed().as_secs_f64() * 1000.0 }
fn line(output: &mut String, value: &str) { output.push_str(value); output.push_str("\r\n"); }
fn out(value: &str) { let mut s = io::stdout().lock(); let _ = writeln!(s, "{value}"); let _ = s.flush(); }
fn err(value: &str) { let mut s = io::stderr().lock(); let _ = writeln!(s, "{value}"); let _ = s.flush(); }
