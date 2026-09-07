use std::{
    collections::BTreeSet,
    env,
    ffi::{OsStr, OsString},
    fs,
    io::{self, Read, Write},
    os::windows::{ffi::OsStringExt, fs::MetadataExt},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::workspace;

const WORKSPACE_MAGIC: &[u8; 8] = b"XPLWSP01";
const WORKSPACE_VERSION: u32 = 1;
const FLAG_DIRECTORY: u8 = 1;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
const PROTECTED_REINDEX_WAIT: Duration = Duration::from_secs(8);

#[link(name = "kernel32")]
unsafe extern "system" {
    fn AttachConsole(process_id: u32) -> i32;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResultState {
    Pass,
    PassWithWarnings,
    CacheMiss,
    Fail,
}

impl ResultState {
    fn label(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::PassWithWarnings => "PASS_WITH_WARNINGS",
            Self::CacheMiss => "CACHE_MISS",
            Self::Fail => "FAIL",
        }
    }

    fn code(self) -> i32 {
        if self == Self::Fail { 2 } else { 0 }
    }
}

#[derive(Default)]
struct DirectScan {
    names: BTreeSet<String>,
    files: Vec<String>,
    folders: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Default)]
struct RecursiveScan {
    files: u64,
    folders: u64,
    reparse_skipped: u64,
    warnings: Vec<String>,
}

struct WorkspaceIndex {
    root: String,
    timestamp: u64,
    records: u64,
    files: u64,
    folders: u64,
    direct_files: u64,
    direct_folders: u64,
    direct_names: BTreeSet<String>,
}

struct IndexBackend {
    data_dir: PathBuf,
    control_dir: PathBuf,
    kind: &'static str,
}

pub fn has_test_folder(arguments: &[OsString]) -> bool {
    arguments.iter().any(|argument| {
        let value = argument.to_string_lossy();
        value.eq_ignore_ascii_case("--test-folder")
            || value.to_ascii_lowercase().starts_with("--test-folder=")
    })
}

pub fn run(arguments: &[OsString]) -> io::Result<i32> {
    unsafe { let _ = AttachConsole(ATTACH_PARENT_PROCESS); }
    match run_inner(arguments) {
        Ok(code) => Ok(code),
        Err(error) => {
            err(&format!("[ERROR] diagnostic failed: {error}"));
            err(&format!("[ERROR] detail: {error:?}"));
            Ok(1)
        }
    }
}

fn run_inner(arguments: &[OsString]) -> io::Result<i32> {
    if !arguments.iter().any(|value| is_debug(value)) {
        err("[ERROR] --test-folder requires --debug or -debug.");
        return Ok(64);
    }

    let requested = parse_folder(arguments)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "--test-folder is missing its folder path"))?;
    let folder = PathBuf::from(requested).canonicalize()?;
    if !folder.is_dir() {
        err("[ERROR] requested path is not a directory");
        return Ok(66);
    }

    let reindex = arguments.iter().any(|value| is_reindex(value));
    let local = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is unavailable"))?;
    let user_data = PathBuf::from(&local).join("Xplorer");
    let backend = resolve_index_backend(&user_data);
    let log_dir = user_data.join("Logs");
    fs::create_dir_all(&log_dir)?;
    let index_path = backend.data_dir.join("workspace.xwidx");

    out("");
    out("Xplorer folder diagnostic");
    out("=========================");
    out(&format!("Folder: {}", folder.display()));
    out(&format!("PID: {}", std::process::id()));
    out(&format!("Mode: {}", if reindex { "READ + EXPLICIT REINDEX" } else { "READ-ONLY" }));
    out(&format!("Index backend: {}", backend.kind));
    out("");

    out("[1/5] Direct filesystem scan");
    let start = Instant::now();
    let direct = scan_direct(&folder)?;
    let direct_ms = elapsed_ms(start);
    out(&format!("[OK] {} files, {} folders ({direct_ms:.3} ms)", direct.files.len(), direct.folders.len()));

    out("[2/5] Recursive filesystem count (debug-only; normal viewport does not recurse)");
    let start = Instant::now();
    let recursive = scan_recursive(&folder);
    let recursive_ms = elapsed_ms(start);
    out(&format!("[OK] {} files, {} folders ({recursive_ms:.3} ms)", recursive.files, recursive.folders));

    let mut rebuild_ms = None;
    let mut rebuilt = false;
    if reindex {
        fs::create_dir_all(&backend.control_dir)?;
        out(if backend.kind == "PROTECTED-BGW" {
            "[3/5] Delegate hot workspace reindex to protected BGW"
        } else {
            "[3/5] Explicit local hot workspace reindex"
        });

        let previous_timestamp = decode_index(&index_path).ok().map(|value| value.timestamp);
        write_workspace_hint(&backend.control_dir, &folder)?;
        let start = Instant::now();
        if backend.kind == "PROTECTED-BGW" {
            rebuilt = wait_for_bg_worker(&index_path, &folder, previous_timestamp)?;
        } else {
            rebuilt = workspace::refresh_hot_workspace(&backend.control_dir, &backend.data_dir, None)?;
        }
        rebuild_ms = Some(elapsed_ms(start));
        out(&format!(
            "[{}] refreshed={} ({:.3} ms)",
            if rebuilt { "OK" } else { "WARN" },
            rebuilt,
            rebuild_ms.unwrap_or_default()
        ));
    } else {
        out("[3/5] Inspect existing hot workspace index (read-only)");
        out(if index_path.is_file() {
            "[OK] workspace.xwidx exists; no hint written and no reindex requested"
        } else {
            "[INFO] workspace.xwidx is missing; requested folder is a cache miss"
        });
    }

    out("[4/5] Decode workspace.xwidx");
    let start = Instant::now();
    let index_exists = index_path.is_file();
    let (index, decode_error) = if index_exists {
        match decode_index(&index_path) {
            Ok(index) => {
                out(&format!("[OK] {} cached records ({:.3} ms)", index.records, elapsed_ms(start)));
                (Some(index), None)
            }
            Err(error) => {
                out(&format!("[ERROR] index decode failed ({:.3} ms): {error}", elapsed_ms(start)));
                (None, Some(error.to_string()))
            }
        }
    } else {
        out("[INFO] decode skipped because no hot workspace cache exists");
        (None, None)
    };
    let decode_ms = elapsed_ms(start);

    out("[5/5] Compare disk and hot workspace index");
    let root_matches = index.as_ref().is_some_and(|value| same_path(&value.root, &folder.to_string_lossy()));
    let mut missing = Vec::new();
    let mut extra = Vec::new();
    if let Some(index) = &index {
        if root_matches {
            missing = direct.names.difference(&index.direct_names).cloned().collect();
            extra = index.direct_names.difference(&direct.names).cloned().collect();
            out(if missing.is_empty() && extra.is_empty() {
                "[OK] direct children match existing index"
            } else {
                "[ERROR] matching hot index differs from disk"
            });
        } else {
            out("[INFO] hot workspace belongs to another folder; CACHE_MISS, not a folder failure");
        }
    } else if decode_error.is_none() {
        out("[INFO] no hot workspace snapshot covers this folder");
    }

    let mut warnings = direct.warnings.clone();
    warnings.extend(recursive.warnings.clone());
    if let Some(error) = &decode_error {
        warnings.push(format!("workspace.xwidx decode: {error}"));
    }
    if reindex && !rebuilt {
        warnings.push(if backend.kind == "PROTECTED-BGW" {
            format!("protected BGW did not publish the requested hot workspace within {} seconds", PROTECTED_REINDEX_WAIT.as_secs())
        } else {
            "local worker refresh did not produce a new workspace snapshot".to_string()
        });
    }

    let state = if decode_error.is_some()
        || (root_matches && (!missing.is_empty() || !extra.is_empty()))
        || (reindex && !root_matches)
    {
        ResultState::Fail
    } else if !root_matches {
        ResultState::CacheMiss
    } else if warnings.is_empty() {
        ResultState::Pass
    } else {
        ResultState::PassWithWarnings
    };

    let report = build_report(
        &folder,
        &backend,
        &index_path,
        index_exists,
        reindex,
        rebuilt,
        &direct,
        direct_ms,
        recursive_ms,
        rebuild_ms,
        decode_ms,
        &recursive,
        index.as_ref(),
        root_matches,
        &missing,
        &extra,
        &warnings,
        state,
    );
    let log_path = log_dir.join(format!("debug-folder-{}.log", unix_now()));
    fs::write(&log_path, report.as_bytes())?;

    out("");
    out(&report);
    out(&format!("Report saved to: {}", log_path.display()));
    out(&format!("Exit result: {} ({})", state.label(), state.code()));
    out("");
    Ok(state.code())
}

fn resolve_index_backend(user_data: &Path) -> IndexBackend {
    let local_index = user_data.join("Index");
    let control_dir = user_data.join("Control");
    let pointer = control_dir.join("protected-index.path");

    if let Ok(value) = fs::read_to_string(&pointer) {
        let candidate = PathBuf::from(value.trim());
        if let Some(program_data) = env::var_os("PROGRAMDATA") {
            let protected_root = PathBuf::from(program_data).join("Xplorer").join("Index");
            if candidate.is_absolute()
                && candidate.starts_with(&protected_root)
                && candidate.join("provisioned.v1").is_file()
            {
                return IndexBackend {
                    data_dir: candidate,
                    control_dir,
                    kind: "PROTECTED-BGW",
                };
            }
        }
    }

    IndexBackend {
        data_dir: local_index,
        control_dir,
        kind: "PER-USER-BGW",
    }
}

fn write_workspace_hint(control_dir: &Path, folder: &Path) -> io::Result<()> {
    fs::create_dir_all(control_dir)?;
    let hint = control_dir.join("workspace.hint");
    let temp = control_dir.join(format!("workspace.hint.debug.{}.tmp", std::process::id()));
    fs::write(&temp, folder.as_os_str().to_string_lossy().as_bytes())?;
    let _ = fs::remove_file(&hint);
    fs::rename(temp, hint)
}

fn wait_for_bg_worker(
    index_path: &Path,
    folder: &Path,
    previous_timestamp: Option<u64>,
) -> io::Result<bool> {
    let deadline = Instant::now() + PROTECTED_REINDEX_WAIT;
    while Instant::now() < deadline {
        if let Ok(index) = decode_index(index_path) {
            if same_path(&index.root, &folder.to_string_lossy())
                && previous_timestamp.is_none_or(|previous| index.timestamp > previous)
            {
                return Ok(true);
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    Ok(false)
}

#[allow(clippy::too_many_arguments)]
fn build_report(
    folder: &Path,
    backend: &IndexBackend,
    index_path: &Path,
    index_exists: bool,
    reindex: bool,
    rebuilt: bool,
    direct: &DirectScan,
    direct_ms: f64,
    recursive_ms: f64,
    rebuild_ms: Option<f64>,
    decode_ms: f64,
    recursive: &RecursiveScan,
    index: Option<&WorkspaceIndex>,
    root_matches: bool,
    missing: &[String],
    extra: &[String],
    warnings: &[String],
    state: ResultState,
) -> String {
    let mut text = String::new();
    line(&mut text, "Xplorer folder diagnostic report");
    line(&mut text, "================================");
    line(&mut text, &format!("Result: {}", state.label()));
    line(&mut text, &format!("Folder: {}", folder.display()));
    line(&mut text, &format!("Executable: {}", env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "<unknown>".into())));
    line(&mut text, &format!("PID: {}", std::process::id()));
    line(&mut text, &format!("Diagnostic mode: {}", if reindex { "READ + EXPLICIT REINDEX" } else { "READ-ONLY" }));

    section(&mut text, "INDEX BACKEND");
    line(&mut text, &format!("Worker/index mode: {}", backend.kind));
    line(&mut text, &format!("Index store: {}", backend.data_dir.display()));
    line(&mut text, &format!("Control channel: {}", backend.control_dir.display()));
    line(&mut text, "USN file-reference resolution: ENABLED in this worker build");

    section(&mut text, "INDEX STATUS");
    line(&mut text, &format!("Index file exists: {}", yes(index_exists)));
    line(&mut text, &format!("Index file: {}", index_path.display()));
    line(&mut text, &format!("Reindex requested: {}", yes(reindex)));
    line(&mut text, &format!("Snapshot refreshed: {}", yes(rebuilt)));
    if let Some(index) = index {
        line(&mut text, &format!("Index version: {WORKSPACE_VERSION}"));
        line(&mut text, &format!("Index timestamp: {}", index.timestamp));
        line(&mut text, &format!("Index age: {} seconds", unix_now().saturating_sub(index.timestamp)));
        line(&mut text, &format!("Index root: {}", index.root));
        line(&mut text, &format!("Indexed for requested folder: {}", yes(root_matches)));
        line(&mut text, &format!("Indexed direct files: {}", index.direct_files));
        line(&mut text, &format!("Indexed direct folders: {}", index.direct_folders));
        line(&mut text, &format!("Indexed cached files (depth <= 3): {}", index.files));
        line(&mut text, &format!("Indexed cached folders (depth <= 3): {}", index.folders));
        line(&mut text, &format!("Index matches direct children: {}", if !root_matches { "N/A (CACHE_MISS)" } else if missing.is_empty() && extra.is_empty() { "YES" } else { "NO" }));
    } else {
        line(&mut text, "Indexed for requested folder: NO");
        line(&mut text, &format!("Index state: {}", if index_exists { "UNREADABLE/CORRUPT" } else { "CACHE_MISS" }));
    }

    section(&mut text, "DATASET SOURCE");
    if root_matches {
        line(&mut text, &format!("Viewport source candidate: {}", if reindex { "INDEX-REFRESHED" } else { "INDEX" }));
        line(&mut text, "Hot workspace cache: HIT");
        line(&mut text, "BGW refresh required: NO");
    } else {
        line(&mut text, "Viewport source candidate: DISK-TEMP");
        line(&mut text, "Hot workspace cache: MISS");
        line(&mut text, if reindex {
            if backend.kind == "PROTECTED-BGW" {
                "BGW/index action: workspace request delegated through the user control channel; debug process did not write ProgramData"
            } else {
                "BGW/index action: explicit local hot-cache refresh requested by this diagnostic"
            }
        } else {
            "BGW/index action: normal Xplorer would queue workspace.hint; read-only diagnostic did not mutate the cache"
        });
    }

    section(&mut text, "FILESYSTEM COUNTS");
    line(&mut text, &format!("Files in this folder: {}", direct.files.len()));
    line(&mut text, &format!("Folders in this folder: {}", direct.folders.len()));
    line(&mut text, &format!("Files IN TOTAL: {}", recursive.files));
    line(&mut text, &format!("Folders IN TOTAL: {}", recursive.folders));
    line(&mut text, &format!("Reparse folders skipped: {}", recursive.reparse_skipped));
    line(&mut text, "Recursive totals are debug-only; normal Xplorer navigation performs no recursive walk.");

    section(&mut text, "INDEX COMPARISON");
    if !root_matches { line(&mut text, "Comparison: SKIPPED (hot cache does not cover requested folder)"); }
    line(&mut text, &format!("Missing from index: {}", missing.len()));
    for item in missing { line(&mut text, &format!("  - {item}")); }
    line(&mut text, &format!("Extra in index: {}", extra.len()));
    for item in extra { line(&mut text, &format!("  - {item}")); }

    section(&mut text, "TIMING");
    line(&mut text, &format!("Direct scan: {direct_ms:.3} ms"));
    line(&mut text, &format!("Recursive scan: {recursive_ms:.3} ms"));
    line(&mut text, &format!("Index refresh/delegation: {}", rebuild_ms.map(|v| format!("{v:.3} ms")).unwrap_or_else(|| "NOT RUN".into())));
    line(&mut text, &format!("Index decode: {decode_ms:.3} ms"));

    section(&mut text, &format!("FILES ({})", direct.files.len()));
    list(&mut text, &direct.files, false);
    section(&mut text, &format!("FOLDERS ({})", direct.folders.len()));
    list(&mut text, &direct.folders, true);
    section(&mut text, &format!("WARNINGS / ERRORS ({})", warnings.len()));
    if warnings.is_empty() { line(&mut text, "  <none>"); }
    else { for warning in warnings { line(&mut text, &format!("  [WARN] {warning}")); } }
    text
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
            Err(error) => { scan.warnings.push(format!("type '{}': {error}", entry.path().display())); scan.files.push(name); }
        }
    }
    scan.files.sort_by_key(|v| v.to_ascii_lowercase());
    scan.folders.sort_by_key(|v| v.to_ascii_lowercase());
    Ok(scan)
}

fn scan_recursive(root: &Path) -> RecursiveScan {
    let mut scan = RecursiveScan::default();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(v) => v,
            Err(e) => { scan.warnings.push(format!("enumerate '{}': {e}", directory.display())); continue; }
        };
        for entry in entries {
            let entry = match entry { Ok(v) => v, Err(e) => { scan.warnings.push(format!("entry in '{}': {e}", directory.display())); continue; } };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(v) => v,
                Err(e) => { scan.warnings.push(format!("metadata '{}': {e}", path.display())); continue; }
            };
            if metadata.is_dir() {
                scan.folders += 1;
                if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 { scan.reparse_skipped += 1; }
                else { stack.push(path); }
            } else { scan.files += 1; }
        }
    }
    scan
}

fn decode_index(path: &Path) -> io::Result<WorkspaceIndex> {
    let mut bytes = Vec::new();
    fs::File::open(path)?.read_to_end(&mut bytes)?;
    let mut cursor = 0usize;
    if take(&bytes, &mut cursor, 8)? != WORKSPACE_MAGIC { return Err(invalid("workspace magic mismatch")); }
    let version = u32_at(&bytes, &mut cursor)?;
    if version != WORKSPACE_VERSION { return Err(invalid(&format!("unsupported workspace version {version}"))); }
    let timestamp = u64_at(&bytes, &mut cursor)?;
    let root_units = u32_at(&bytes, &mut cursor)? as usize;
    let root = utf16_at(&bytes, &mut cursor, root_units)?;
    let mut result = WorkspaceIndex { root, timestamp, records: 0, files: 0, folders: 0, direct_files: 0, direct_folders: 0, direct_names: BTreeSet::new() };
    while cursor < bytes.len() {
        let start = cursor;
        let length = u32_at(&bytes, &mut cursor)? as usize;
        let end = start.checked_add(length).ok_or_else(|| invalid("workspace record length overflow"))?;
        if length < 32 || end > bytes.len() { return Err(invalid("bad workspace record length")); }
        let flags = take(&bytes, &mut cursor, 4)?[0];
        let _attributes = u32_at(&bytes, &mut cursor)?;
        let _size = u64_at(&bytes, &mut cursor)?;
        let _last_write = u64_at(&bytes, &mut cursor)?;
        let units = u32_at(&bytes, &mut cursor)? as usize;
        let relative = utf16_at(&bytes, &mut cursor, units)?;
        if cursor != start + length { return Err(invalid("workspace record size mismatch")); }
        result.records += 1;
        let is_dir = flags & FLAG_DIRECTORY != 0;
        if is_dir { result.folders += 1; } else { result.files += 1; }
        let relative = PathBuf::from(relative);
        if relative.components().count() == 1 {
            if is_dir { result.direct_folders += 1; } else { result.direct_files += 1; }
            if let Some(name) = relative.file_name() { result.direct_names.insert(name.to_string_lossy().to_ascii_lowercase()); }
        }
    }
    Ok(result)
}

fn parse_folder(arguments: &[OsString]) -> Option<OsString> {
    for (index, argument) in arguments.iter().enumerate() {
        let text = argument.to_string_lossy();
        if text.eq_ignore_ascii_case("--test-folder") { return arguments.get(index + 1).cloned(); }
        if let Some((key, value)) = text.split_once('=') {
            if key.eq_ignore_ascii_case("--test-folder") && !value.is_empty() { return Some(OsString::from(value)); }
        }
    }
    None
}

fn is_debug(value: &OsStr) -> bool {
    matches!(value.to_string_lossy().to_ascii_lowercase().as_str(), "--debug" | "-debug" | "--diagnose")
}
fn is_reindex(value: &OsStr) -> bool {
    matches!(value.to_string_lossy().to_ascii_lowercase().as_str(), "--reindex" | "--rebuild-index")
}
fn same_path(left: &str, right: &str) -> bool { normalize_path(left).eq_ignore_ascii_case(&normalize_path(right)) }
fn normalize_path(value: &str) -> String { value.strip_prefix(r"\\?\").unwrap_or(value).trim_end_matches(['\\', '/']).replace('/', "\\") }
fn elapsed_ms(start: Instant) -> f64 { start.elapsed().as_secs_f64() * 1000.0 }
fn unix_now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn yes(value: bool) -> &'static str { if value { "YES" } else { "NO" } }
fn invalid(message: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidData, message.to_string()) }
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
fn section(text: &mut String, title: &str) { line(text, ""); line(text, title); line(text, &"-".repeat(title.len().min(48))); }
fn list(text: &mut String, items: &[String], folder: bool) {
    if items.is_empty() { line(text, "  <none>"); }
    else { for item in items { line(text, &format!("  - {item}{}", if folder { "\\" } else { "" })); } }
}
fn line(text: &mut String, value: &str) { text.push_str(value); text.push_str("\r\n"); }
fn out(value: &str) { let mut stdout = io::stdout().lock(); let _ = writeln!(stdout, "{value}"); let _ = stdout.flush(); }
fn err(value: &str) { let mut stderr = io::stderr().lock(); let _ = writeln!(stderr, "{value}"); let _ = stderr.flush(); }
